import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { Fcboard } from "@fcboard/fcboard";

import { getDefaultAppState } from "@fcboard/fcboard/appState";
import { t } from "@fcboard/fcboard/i18n";
import * as blob from "@fcboard/fcboard/data/blob";
import * as background from "@fcboard/fcboard/whiteboardBackground";
import { Capacitor } from "@capacitor/core";

import { Keyboard } from "@fcboard/fcboard/tests/helpers/ui";
import { act, render as renderEditor } from "@fcboard/fcboard/tests/test-utils";

import type { AppState, FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { BackgroundSettings } from "./BackgroundSettings";
import { BoardSettings } from "./BoardSettings";
import { SettingsNavigation } from "./SettingsNavigation";
import { classroomCommands } from "./commands";
import * as boardFiles from "./boardFile";
import { render } from "./test/render";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const file = () =>
  new File(["image pixels"], "classroom.png", { type: "image/png" });

it("opens the native image browser for custom backgrounds, preserves cancel, and rejects a late choice after a surface change", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  const picker = vi
    .spyOn(boardFiles, "pickImageFile")
    .mockResolvedValueOnce(undefined);
  const change = vi.fn();
  const panel = render(
    <BackgroundSettings
      state={{
        ...getDefaultAppState(),
        width: 1600,
        height: 900,
        offsetTop: 0,
        offsetLeft: 0,
      }}
      onChange={change}
    />,
  );
  const custom = screen.getByRole("button", {
    name: t("fcboard.factorySettings.custom"),
  });
  fireEvent.click(custom);
  await waitFor(() => expect(picker).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(custom).toBeEnabled());
  expect(change).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
  let finish!: (image: File) => void;
  picker.mockImplementationOnce(
    (signal) =>
      new Promise((resolve, reject) => {
        finish = resolve;
        signal!.addEventListener(
          "abort",
          () =>
            reject(new DOMException("Visible surface changed", "AbortError")),
          { once: true },
        );
      }),
  );
  fireEvent.click(custom);
  expect(custom).toBeDisabled();
  act(() => classroomCommands.invalidate());
  await waitFor(() => expect(custom).toBeEnabled());
  finish(file());
  expect(change).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
  panel.unmount();
});

it("applies the native browser's selected image through the existing validated background pipeline", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  vi.spyOn(boardFiles, "pickImageFile").mockResolvedValue(file());
  vi.spyOn(blob, "resizeImageFile").mockImplementation(async (image) => image);
  vi.spyOn(background, "loadBackground").mockResolvedValue(new Image());
  const change = vi.fn();
  const panel = render(
    <BackgroundSettings
      state={{
        ...getDefaultAppState(),
        width: 1600,
        height: 900,
        offsetTop: 0,
        offsetLeft: 0,
      }}
      onChange={change}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.factorySettings.custom") }),
  );
  await waitFor(() =>
    expect(change).toHaveBeenCalledWith({
      backgroundImage: expect.stringMatching(/^data:image\/png;base64,/),
    }),
  );
  expect(blob.resizeImageFile).toHaveBeenCalledWith(expect.any(File), {
    maxWidthOrHeight: 1440,
  });
  panel.unmount();
});

it("converts an original BMP background to a supported static PNG before persisting it", async () => {
  const resize = vi.spyOn(blob, "resizeImageFile").mockResolvedValue(file());
  vi.spyOn(background, "loadBackground").mockResolvedValue(new Image());
  const change = vi.fn();
  const panel = render(
    <BackgroundSettings
      state={{
        ...getDefaultAppState(),
        width: 1600,
        height: 900,
        offsetTop: 0,
        offsetLeft: 0,
      }}
      onChange={change}
    />,
  );
  const image = new File(["BMP source"], "课堂.bmp", { type: "image/bmp" });
  fireEvent.change(panel.container.querySelector('input[type="file"]')!, {
    target: { files: [image] },
  });
  await waitFor(() =>
    expect(change).toHaveBeenCalledWith({
      backgroundImage: expect.stringMatching(/^data:image\/png;base64,/),
    }),
  );
  expect(resize).toHaveBeenCalledWith(image, {
    maxWidthOrHeight: 1440,
    outputType: "image/png",
  });
  panel.unmount();
});

it("chooses a real custom background without creating an erasable object, and undoes it in one step", async () => {
  let api!: FcboardImperativeAPI;
  const editor = await renderEditor(
    <Fcboard
      handleKeyboardGlobally
      onMount={({ excalidrawAPI }) => {
        api = excalidrawAPI;
      }}
    />,
  );
  act(() => api.updateScene({ appState: { width: 1600, height: 900 } }));
  const panel = render(
    <SettingsNavigation initialPage="background">
      <BoardSettings api={api} />
    </SettingsNavigation>,
  );
  vi.spyOn(blob, "resizeImageFile").mockImplementation(async (image) => image);
  vi.spyOn(background, "loadBackground").mockResolvedValue(new Image());
  try {
    const input = panel.container.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [file()] } });
    await waitFor(() =>
      expect(api.getAppState().whiteboardBackground?.pattern).toBe(14),
    );
    const custom = api.getAppState().whiteboardBackground!.image;
    expect(custom).toMatch(/^data:image\/png;base64,/);
    expect(api.getSceneElements()).toHaveLength(0);
    Keyboard.undo();
    expect(api.getAppState().whiteboardBackground).toBeUndefined();
    Keyboard.redo();
    expect(api.getAppState().whiteboardBackground?.image).toBe(custom);
    fireEvent.click(
      screen.getByRole("button", {
        name: t("fcboard.background_pattern_number", { number: 3 }),
      }),
    );
    expect(api.getAppState().whiteboardBackground?.pattern).toBe(3);
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.factorySettings.custom") }),
    );
    expect(api.getAppState().whiteboardBackground?.image).toBe(custom);
    expect(api.getSceneElements()).toHaveLength(0);
  } finally {
    panel.unmount();
    editor.unmount();
  }
});

it("keeps the original fourteen pattern choices and applies the preset and custom colours", () => {
  const change = vi.fn();
  const Panel = () => {
    const [state, setState] = useState(getDefaultAppState() as AppState);
    return (
      <BackgroundSettings
        state={state}
        onChange={(input) => {
          change(input);
          if (input.backgroundColor) {
            setState({
              ...state,
              viewBackgroundColor: String(input.backgroundColor),
            });
          }
        }}
      />
    );
  };
  render(<Panel />);
  expect(
    document.querySelectorAll(".fc-background-picker button"),
  ).toHaveLength(14);
  fireEvent.click(
    screen.getByRole("button", { name: `${t("fcboard.background")} #253a35` }),
  );
  expect(change).toHaveBeenLastCalledWith({ backgroundColor: "#253a35" });
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.custom_colour") }),
  );
  const shade = screen.getByRole("slider", {
    name: t("fcboard.factorySettings.shade"),
  });
  fireEvent.change(shade, { target: { value: "255" } });
  expect(change).toHaveBeenLastCalledWith({ backgroundColor: "#000000" });
});

it("preserves the old background on decode failure and ignores a completed import after changing pages", async () => {
  const change = vi.fn();
  const panel = render(
    <BackgroundSettings
      state={getDefaultAppState() as AppState}
      onChange={change}
    />,
  );
  let finish!: (image: File) => void;
  vi.spyOn(blob, "resizeImageFile").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const load = vi
    .spyOn(background, "loadBackground")
    .mockResolvedValue(new Image());
  const input = panel.container.querySelector('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [file()] } });
  act(() => classroomCommands.invalidate());
  await act(async () => {
    finish(file());
  });
  await waitFor(() =>
    expect(panel.container.firstChild).toHaveAttribute("aria-busy", "false"),
  );
  expect(change).not.toHaveBeenCalled();
  load.mockRejectedValue(new Error("Cannot decode image"));
  fireEvent.change(input, { target: { files: [file()] } });
  await act(async () => {
    finish(file());
  });
  await screen.findByRole("alert");
  expect(change).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { files: [] } });
  expect(change).not.toHaveBeenCalled();
});
