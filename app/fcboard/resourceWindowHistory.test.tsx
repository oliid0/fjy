import { Fcboard } from "@fcboard/fcboard";

import { t } from "@fcboard/fcboard/i18n";

import {
  render,
  act,
  fireEvent,
  screen,
  mockBoundingClientRect,
  restoreOriginalGetBoundingClientRect,
} from "@fcboard/fcboard/tests/test-utils";
import { API } from "@fcboard/fcboard/tests/helpers/api";
import { Keyboard } from "@fcboard/fcboard/tests/helpers/ui";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { registerCanvasCommands } from "./canvasCommands";

import { classroomCommands } from "./commands";
import { interactiveResource } from "./test/interactiveResource";

const pointer = (node: Element, type: string, x: number, y: number) =>
  fireEvent(
    node,
    Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
      pointerId: 7,
      pointerType: "touch",
      clientX: x,
      clientY: y,
      button: 0,
    }),
  );

it("moves and resizes a real lesson as single undoable edits while retaining its live iframe", async () => {
  let api!: FcboardImperativeAPI;
  mockBoundingClientRect({ width: 1600, height: 900 });
  await render(
    <Fcboard
      handleKeyboardGlobally
      UIOptions={{ unifiedToolbar: true }}
      onMount={({ excalidrawAPI }) => {
        api = excalidrawAPI;
      }}
    />,
  );
  const stop = registerCanvasCommands(api);
  try {
    await act(async () => {
      await classroomCommands.execute({
        name: "canvas.resource",
        args: { resource: interactiveResource },
      });
    });
    const original = api
      .getSceneElements()
      .find((item) => item.type === "iframe")!;
    const frame = screen.getByTitle(interactiveResource.title);
    const drag = screen.getByRole("button", {
      name: interactiveResource.title,
    });
    let history = API.getUndoStack().length;
    pointer(drag, "pointerdown", 100, 100);
    pointer(drag, "pointermove", 124, 116);
    pointer(drag, "pointerup", 124, 116);
    expect(api.getSceneElements()[0].x).toBeCloseTo(original.x + 24);
    expect(api.getSceneElements()[0].y).toBeCloseTo(original.y + 16);
    expect(API.getUndoStack()).toHaveLength(history + 1);
    expect(screen.getByTitle(interactiveResource.title)).toBe(frame);
    Keyboard.undo();
    expect(api.getSceneElements()[0].x).toBe(original.x);
    expect(api.getSceneElements()[0].y).toBe(original.y);
    expect(screen.getByTitle(interactiveResource.title)).toBe(frame);
    const sizing = screen.getByRole("button", { name: t("fcboard.size") });
    history = API.getUndoStack().length;
    pointer(sizing, "pointerdown", 100, 100);
    pointer(sizing, "pointermove", 124, 116);
    pointer(sizing, "pointerup", 124, 116);
    expect(api.getSceneElements()[0].width).toBeCloseTo(original.width + 24);
    expect(API.getUndoStack()).toHaveLength(history + 1);
    Keyboard.undo();
    expect(api.getSceneElements()[0].width).toBe(original.width);
    expect(screen.getByTitle(interactiveResource.title)).toBe(frame);
  } finally {
    stop();
    restoreOriginalGetBoundingClientRect();
  }
});
