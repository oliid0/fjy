import { fireEvent, screen } from "@testing-library/react";
import {
  Fcboard,
  CaptureUpdateAction,
  convertToFcboardElements,
} from "@fcboard/fcboard";

import { t } from "@fcboard/fcboard/i18n";
import { clearAppStateForLocalStorage } from "@fcboard/fcboard/appState";
import { restoreAppState } from "@fcboard/fcboard/data/restore";

import { Keyboard } from "@fcboard/fcboard/tests/helpers/ui";
import { act, render } from "@fcboard/fcboard/tests/test-utils";

import type { FcboardImperativeAPI, UIOptions } from "@fcboard/fcboard/types";

import { render as renderSettings } from "./test/render";
import { BoardSettings } from "./BoardSettings";
import { SettingsNavigation } from "./SettingsNavigation";
import { classroomCommands, executeBoardCommand } from "./commands";
import { registerCanvasCommands } from "./canvasCommands";
import {
  canvasConfigurationSnapshot,
  readCanvasConfiguration,
} from "./canvasConfiguration";
import { runBoardCommands } from "./agent";
import * as ai from "./ai";

const setup = async (device?: UIOptions["inkProfile"]) => {
  let api!: FcboardImperativeAPI;
  const view = await render(
    <Fcboard
      handleKeyboardGlobally
      UIOptions={{ unifiedToolbar: true, inkProfile: device }}
      onMount={({ excalidrawAPI }) => {
        api = excalidrawAPI;
      }}
    />,
  );
  const stop = registerCanvasCommands(api, () => device);
  act(() => api.updateScene({ appState: { width: 1600, height: 900 } }));
  return {
    api,
    view,
    stop,
    close: () => {
      stop();
      view.unmount();
    },
  };
};
const configure = async (args: Record<string, unknown>) => {
  let operation!: Promise<unknown>;
  act(() => {
    operation = classroomCommands.execute({ name: "canvas.configure", args });
  });
  return operation;
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const contact = (
  node: Element,
  type: string,
  properties: Record<string, number | string> = {},
) =>
  fireEvent(
    node,
    Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
      pointerId: 7,
      pointerType: "touch",
      ...properties,
    }),
  );

it.each([1, 2, 3])(
  "calibrates physical contact sizes at density %s, persists the actual preferences, and restores factory values",
  async (dpr) => {
    vi.stubGlobal("devicePixelRatio", dpr);
    const device = {
      hardPenWidth: 4 / dpr,
      brushPenWidth: 15 / dpr,
      eraserSize: 150 / dpr,
      palmThreshold: 60 / dpr,
      fineThreshold: 8 / dpr,
      thickThreshold: 24 / dpr,
      factoryThresholds: { palm: 120, fine: 12, thick: 40 },
    };
    const { api, close } = await setup(device);
    const panel = renderSettings(
      <SettingsNavigation initialPage="touch">
        <BoardSettings api={api} device={device} />
      </SettingsNavigation>,
    );
    try {
      const area = screen.getByRole("group", {
        name: t("fcboard.factorySettings.area"),
      });
      const palm = screen.getByRole("textbox", {
        name: t("fcboard.factorySettings.eraser_label"),
      });
      expect(Number((palm as HTMLInputElement).value)).toBeCloseTo(90);
      contact(area, "pointerdown", { width: 60 / dpr, height: 40 / dpr });
      expect(api.getAppState().palmEraserThreshold).toBeUndefined();
      // ThresholdView records DOWN; larger MOVE / UP contacts must not replace it.
      contact(area, "pointermove", { width: 100 / dpr, height: 80 / dpr });
      contact(area, "pointerup", { width: 100 / dpr, height: 80 / dpr });
      expect(api.getAppState().palmEraserThreshold).toBeCloseTo(80 / 3 / dpr);
      expect(Number((palm as HTMLInputElement).value)).toBeCloseTo(40);

      fireEvent.click(
        screen.getByRole("checkbox", {
          name: t("fcboard.factorySettings.fine_label"),
        }),
      );
      contact(area, "pointerdown", {
        pointerType: "pen",
        width: 10 / dpr,
        height: 12 / dpr,
      });
      contact(area, "pointerup");
      expect(api.getAppState().whiteboardFineThreshold).toBeCloseTo(8 / dpr);
      const thick = screen.getByRole("textbox", {
        name: t("fcboard.factorySettings.thick_label"),
      });
      fireEvent.change(thick, { target: { value: "42.5" } });
      expect(api.getAppState().whiteboardThickThreshold).toBeCloseTo(34 / dpr);
      await configure({ toolbarText: false });
      const saved = clearAppStateForLocalStorage(api.getAppState());
      expect(restoreAppState(saved, null)).toMatchObject({
        palmEraserThreshold: api.getAppState().palmEraserThreshold,
        whiteboardFineThreshold: api.getAppState().whiteboardFineThreshold,
        whiteboardThickThreshold: api.getAppState().whiteboardThickThreshold,
        whiteboardToolbarText: false,
      });

      fireEvent.click(screen.getByRole("button", { name: t("fcboard.reset") }));
      expect(api.getAppState().palmEraserThreshold).toBeCloseTo(80 / dpr);
      expect(api.getAppState().whiteboardFineThreshold).toBeCloseTo(9.6 / dpr);
      expect(api.getAppState().whiteboardThickThreshold).toBeCloseTo(32 / dpr);
      expect(Number((palm as HTMLInputElement).value)).toBeCloseTo(120);
    } finally {
      panel.unmount();
      close();
    }
  },
);

it("ignores cancelled, mouse, invalid and wrong-pointer samples without altering calibration", async () => {
  const { api, close } = await setup();
  const panel = renderSettings(
    <SettingsNavigation initialPage="touch">
      <BoardSettings api={api} />
    </SettingsNavigation>,
  );
  try {
    const area = screen.getByRole("group", {
      name: t("fcboard.factorySettings.area"),
    });
    for (const invalid of [
      { pointerType: "mouse", width: 100, height: 100 },
      { pointerType: "touch", width: 0, height: 100 },
      { pointerType: "touch", width: NaN, height: 100 },
    ]) {
      contact(area, "pointerdown", invalid);
      contact(area, "pointerup");
    }
    for (const end of ["pointercancel", "lostpointercapture"]) {
      contact(area, "pointerdown", { width: 50, height: 60 });
      contact(area, end);
      contact(area, "pointerup");
    }
    contact(area, "pointerdown", { width: 50, height: 60 });
    contact(area, "pointerup", { pointerId: 99 });
    expect(api.getAppState().palmEraserThreshold).toBeUndefined();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: t("fcboard.factorySettings.thick_label"),
      }),
    );
    contact(area, "pointerup");
    expect(api.getAppState().whiteboardThickThreshold).toBeUndefined();
    expect(api.getAppState().palmEraserThreshold).toBeUndefined();
    // A fresh gesture still works after the cancelled calibration.
    contact(area, "pointerdown", { width: 15, height: 20 });
    contact(area, "pointerup");
    expect(api.getAppState().whiteboardThickThreshold).toBe(12);
  } finally {
    panel.unmount();
    close();
  }
});

it("clears manual overrides when factory properties are unavailable and keeps the device defaults", async () => {
  const device = {
    hardPenWidth: 4,
    brushPenWidth: 15,
    eraserSize: 150,
    palmThreshold: 40,
    fineThreshold: 4,
    thickThreshold: 12,
  };
  const { api, close } = await setup(device);
  await configure({ palmThreshold: 60, fineThreshold: 8, thickThreshold: 18 });
  const panel = renderSettings(
    <SettingsNavigation initialPage="touch">
      <BoardSettings api={api} device={device} />
    </SettingsNavigation>,
  );
  try {
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.reset") }));
    expect(api.getAppState().palmEraserThreshold).toBeUndefined();
    expect(api.getAppState().whiteboardFineThreshold).toBeUndefined();
    expect(api.getAppState().whiteboardThickThreshold).toBeUndefined();
    expect(
      canvasConfigurationSnapshot(api.getAppState(), device),
    ).toMatchObject({
      eraser: { palmThreshold: 40 },
      pen: { fineThreshold: 4, thickThreshold: 12 },
    });
  } finally {
    panel.unmount();
    close();
  }
});

it("applies background and calibrated preferences atomically, reads committed state, and shares tip profiles with the settings controls", async () => {
  const device = {
    hardPenWidth: 2,
    brushPenWidth: 7.5,
    eraserSize: 75,
    palmThreshold: 40,
    thickThreshold: 12,
    dualPen: true,
  };
  const { api, close } = await setup(device);
  let panel: ReturnType<typeof renderSettings> | undefined;
  try {
    const source = convertToFcboardElements([
      { type: "text", text: "Existing note", x: 100, y: 100 },
    ]);
    act(() => {
      api.updateScene({
        elements: source,
        appState: {
          currentItemStrokeColor: "#aa2222",
          currentItemStrokeWidth: 3,
          currentItemPenMode: "brush",
        },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    });
    const background = api.getAppState().viewBackgroundColor;
    const result = await configure({
      backgroundColor: "#123d32",
      backgroundPattern: 4,
      tip: "thick",
      dualPen: true,
      thickThreshold: 18,
      brushVariation: 11,
      palmEraser: false,
      palmThreshold: 42,
      eraserSize: 80,
      eraserMode: "object",
      multiStroke: false,
      toolbarReversed: true,
    });
    expect(result).toMatchObject({
      units: "CSS pixels",
      background: { available: true, color: "#123d32", pattern: 4 },
      pen: {
        tip: "thick",
        dualPen: true,
        thickThreshold: 18,
        brushVariation: 11,
      },
      eraser: { mode: "object", size: 80, palm: false, palmThreshold: 42 },
      touch: { multiStroke: false },
      toolbar: { reversed: true },
    });
    expect(api.getAppState().whiteboardBackground).toEqual({
      pattern: 4,
      width: api.getAppState().width / api.getAppState().zoom.value,
      height: api.getAppState().height / api.getAppState().zoom.value,
    });
    expect(api.getAppState().currentItemStrokeColor).toBe("#ffffff");
    expect(api.getSceneElements()).toEqual(source);
    Keyboard.undo();
    expect(api.getAppState().viewBackgroundColor).toBe(background);
    expect(api.getAppState().whiteboardBackground).toBeUndefined();
    expect(api.getSceneElements()).toEqual(source);
    Keyboard.redo();
    expect(api.getAppState().whiteboardBackground?.pattern).toBe(4);
    panel = renderSettings(
      <SettingsNavigation initialPage="recognition">
        <BoardSettings api={api} device={device} />
      </SettingsNavigation>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.fine_pen") }),
    );
    expect(api.getAppState()).toMatchObject({
      whiteboardPenTip: "fine",
      currentItemPenMode: "brush",
      currentItemStrokeWidth: 3,
      currentItemStrokeColor: "#aa2222",
    });
    await configure({ tip: "thick" });
    expect(
      screen.getByRole("button", { name: t("fcboard.thick_pen") }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(api.getAppState().currentItemStrokeColor).toBe("#ffffff");
  } finally {
    panel?.unmount();
    close();
  }
});

it("rejects a whole invalid batch before changing any preference or background", async () => {
  const { api, close } = await setup();
  const update = vi.spyOn(api, "updateScene");
  try {
    for (const args of [
      {},
      { backgroundPattern: 3, brushVariation: 51 },
      { backgroundPattern: 14 },
      { backgroundImage: "https://example.com/background.png" },
      { backgroundPattern: 1, backgroundImage: "data:image/png;base64,YQ==" },
      { backgroundColor: "red" },
      { dualPen: true },
      { tip: "unknown" },
      { palmEraser: "yes" },
      { eraserSize: NaN },
      { collaborators: {} },
    ]) {
      await expect(
        classroomCommands.execute({ name: "canvas.configure", args }),
      ).rejects.toThrow();
    }
    expect(update).not.toHaveBeenCalled();
    const result = await configure({ thickThreshold: 16, dualPen: true });
    expect(result).toMatchObject({
      pen: { thickThreshold: 16, dualPen: true, autoTipAvailable: true },
    });
  } finally {
    close();
  }
});

it("uses device defaults and refuses hidden-board changes while courseware is visible", async () => {
  const device = {
    hardPenWidth: 2,
    brushPenWidth: 7.5,
    eraserSize: 75,
    palmThreshold: 40,
    thickThreshold: 12,
    dualPen: true,
  };
  const { api, close } = await setup(device);
  const document = classroomCommands.context("document", () => ({
    configuration: canvasConfigurationSnapshot(api.getAppState(), device, true),
    id: "slides",
    name: "lesson.pdf",
    page: 1,
    ink: [],
    pen: {},
  }));
  let panel: ReturnType<typeof renderSettings> | undefined;
  try {
    const original = api.getAppState();
    const result = await classroomCommands.execute({ name: "canvas.inspect" });
    expect(result).toMatchObject({
      target: { kind: "document" },
      configuration: {
        background: { available: false },
        pen: { thickThreshold: 12, dualPen: true },
        eraser: { size: 75, palmThreshold: 40, modes: ["stroke", "object"] },
      },
    });
    for (const args of [
      { backgroundPattern: 3, palmEraser: false },
      { backgroundColor: "#123d32" },
      { multiStroke: true },
    ]) {
      await expect(
        classroomCommands.execute({ name: "canvas.configure", args }),
      ).rejects.toThrow();
    }
    expect(api.getAppState()).toBe(original);
    panel = renderSettings(
      <SettingsNavigation initialPage="background">
        <BoardSettings api={api} device={device} />
      </SettingsNavigation>,
    );
    expect(
      screen.queryByRole("group", { name: t("fcboard.background") }),
    ).toBeNull();
    expect(panel.container).toHaveTextContent(
      t(
        "fcboard.this_action_is_for_the_board_in_a_document_turn_pages_annotate_circle_undo_or_describe_what_to",
      ),
    );
    await configure({
      brushVariation: 7,
      palmEraser: false,
      eraserMode: "object",
    });
    expect(readCanvasConfiguration(api, device)).toMatchObject({
      pen: { brushVariation: 7 },
      eraser: { palm: false, mode: "object" },
    });
  } finally {
    panel?.unmount();
    document();
    close();
  }
});

it("does not report success if the host never commits, and releases the wait on cancellation or disposal", async () => {
  const { api, stop, close } = await setup();
  vi.spyOn(api, "updateScene").mockImplementation(() => {});
  vi.useFakeTimers();
  try {
    const controller = new AbortController();
    const pending = executeBoardCommand(
      { name: "canvas.configure", args: { palmEraser: false } },
      controller.signal,
    );
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await rejected;
    const timed = classroomCommands.execute({
      name: "canvas.configure",
      args: { brushVariation: 7 },
    });
    const failed = expect(timed).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(5000);
    await failed;
    expect(api.getAppState().palmEraser).not.toBe(false);
    const abandoned = classroomCommands.execute({
      name: "canvas.configure",
      args: { brushVariation: 8 },
    });
    const disposed = expect(abandoned).rejects.toMatchObject({
      name: "AbortError",
    });
    stop();
    await disposed;
  } finally {
    close();
  }
});

it("returns actual committed settings to the assistant before its next model decision", async () => {
  const { api, close } = await setup();
  const chat = vi.spyOn(ai, "chat").mockImplementation(async (messages) => {
    expect(String(messages.at(-1)?.content)).toContain('"brushVariation":9');
    expect(readCanvasConfiguration(api).pen.brushVariation).toBe(9);
    return '{"action":"done"}';
  });
  try {
    let task!: Promise<unknown>;
    act(() => {
      task = runBoardCommands(
        {
          action: "commands",
          continue: true,
          commands: [{ name: "canvas.configure", args: { brushVariation: 9 } }],
        },
        [],
        undefined,
        () => true,
      );
    });
    await act(async () => {
      await task;
    });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(api.getAppState().whiteboardBrushVariation).toBe(9);
  } finally {
    close();
  }
});
