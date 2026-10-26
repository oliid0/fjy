import { fireEvent, screen } from "@testing-library/react";
import {
  Excalidraw,
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import { act, render } from "@excalidraw/excalidraw/tests/test-utils";
import { Keyboard } from "@excalidraw/excalidraw/tests/helpers/ui";
import { t } from "@excalidraw/excalidraw/i18n";

import type {
  ExcalidrawImperativeAPI,
  UIOptions,
} from "@excalidraw/excalidraw/types";

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
  let api!: ExcalidrawImperativeAPI;
  const view = await render(
    <Excalidraw
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
  vi.useRealTimers();
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
    const source = convertToExcalidrawElements([
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
      <SettingsNavigation initialPage="pen">
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
      <SettingsNavigation>
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
