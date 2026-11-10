import {
  act,
  fireEvent,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { Fcboard } from "@fcboard/fcboard";
import { t } from "@fcboard/fcboard/i18n";
import { render as renderEditor } from "@fcboard/fcboard/tests/test-utils";

import { render } from "./test/render";
import { SplitBoard } from "./SplitBoard";
import { BottomBarActions } from "./BottomBarActions";
import { classroomCommands } from "./commands";
import * as boardFile from "./boardFile";

const command = async (args: Record<string, unknown> = {}) => {
  let result: unknown;
  await act(async () => {
    result = await classroomCommands.execute({ name: "tools.split", args });
  });
  return result;
};
const panes = () =>
  Array.from(
    document.querySelectorAll<HTMLCanvasElement>(".fc-split-pane canvas"),
  );
const pane = (number: number) =>
  within(screen.getByLabelText(t("fcboard.split_pane", { number })));
const pointer = (
  node: Element,
  type: string,
  id: number,
  x: number,
  y = 60,
  extras: Record<string, unknown> = {},
) =>
  fireEvent(
    node,
    Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
      pointerId: id,
      clientX: x,
      clientY: y,
      button: 0,
      pointerType: "pen",
      ...extras,
    }),
  );
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(
    HTMLCanvasElement.prototype,
    "getBoundingClientRect",
  ).mockReturnValue({ width: 300, height: 500, left: 0, top: 0 } as DOMRect);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("toggles the original anchored split launcher on every real toolbar tap and enters each actual layout", async () => {
  const release = classroomCommands.register("ui.invoke", "@internal", (args) =>
    classroomCommands.execute({
      name: String(args.command),
      args: args.args as Record<string, unknown>,
    }),
  );
  try {
    await renderEditor(
      <div className="app">
        <div className="fc-classroom">
          <Fcboard UIOptions={{ unifiedToolbar: true }}>
            <BottomBarActions />
          </Fcboard>
          <SplitBoard />
        </div>
      </div>,
    );
    const button = within(
      screen.getByRole("toolbar", { name: t("fcboard.whiteboard_toolbar") }),
    ).getByRole("button", { name: t("fcboard.split_screen") });
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    fireEvent.pointerDown(document.body);
    expect(button).toHaveAttribute("aria-expanded", "false");
    for (const count of [2, 3, 4]) {
      fireEvent.click(button);
      fireEvent.click(
        screen.getByRole("button", {
          name: t("fcboard.split_count", { count }),
        }),
      );
      await waitFor(() => {
        expect(panes()).toHaveLength(count);
        expect(document.querySelector(".fc-split-launcher")).toBeNull();
      });
      await command({ open: false });
    }
  } finally {
    release();
  }
});

it("retains each hidden pane's independent color, width and ink through 4/2/3/4 layout and close/reopen", async () => {
  render(<SplitBoard />);
  await command({ count: 4 });
  fireEvent.click(
    pane(3).getByRole("button", { name: t("fcboard.split_orange") }),
  );
  fireEvent.click(
    pane(3).getByRole("button", {
      name: t("fcboard.split_pen_size", { size: 3 }),
    }),
  );
  pointer(panes()[2], "pointerdown", 3, 20);
  pointer(panes()[2], "pointerup", 3, 120);
  const hiddenCanvas = panes()[2];
  await command({ count: 2 });
  expect(hiddenCanvas.width).toBe(1);
  expect(hiddenCanvas.height).toBe(1);
  await command({ count: 3 });
  expect(
    pane(3).getByRole("button", { name: t("fcboard.split_orange") }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    pane(3).getByRole("button", {
      name: t("fcboard.split_pen_size", { size: 3 }),
    }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    pane(1).getByRole("button", { name: t("fcboard.split_white") }),
  ).toHaveAttribute("aria-pressed", "true");
  await command({ open: false });
  expect(await command({ count: 4 })).toMatchObject({
    panes: [{ strokes: 0 }, { strokes: 0 }, { strokes: 1 }, { strokes: 0 }],
  });
  pointer(panes()[2], "pointerdown", 4, 20);
  pointer(panes()[2], "pointerup", 4, 140);
  expect(panes()[2].getContext("2d")!.strokeStyle).toBe("#e95504");
  expect(panes()[2].getContext("2d")!.lineWidth).toBe(
    2.68 * (window.devicePixelRatio || 1),
  );
});

it("flushes a split stroke to the actual release point and reproduces that endpoint after resize", async () => {
  render(<SplitBoard />);
  await command({ count: 2 });
  const canvas = panes()[0];
  const context = canvas.getContext("2d")!;
  pointer(canvas, "pointerdown", 1, 20);
  pointer(canvas, "pointermove", 1, 80);
  pointer(canvas, "pointerup", 1, 160);
  expect(context.quadraticCurveTo).toHaveBeenLastCalledWith(160, 60, 160, 60);
  fireEvent(window, new Event("resize"));
  expect(context.quadraticCurveTo).toHaveBeenLastCalledWith(160, 60, 160, 60);
  expect(await command({ count: 2 })).toMatchObject({
    panes: [{ strokes: 1 }, { strokes: 0 }, { strokes: 0 }, { strokes: 0 }],
  });
});

it("accepts empty coalesced batches, keeps concurrent contacts independent, and ends cancelled capture without losing ink", async () => {
  render(<SplitBoard />);
  await command({ count: 2 });
  const canvas = panes()[0];
  const context = canvas.getContext("2d")!;
  pointer(canvas, "pointerdown", 1, 10);
  pointer(canvas, "pointerdown", 2, 100, 120);
  pointer(canvas, "pointermove", 1, 40, 60, { getCoalescedEvents: () => [] });
  pointer(canvas, "pointercancel", 1, 40);
  expect(context.quadraticCurveTo).toHaveBeenLastCalledWith(40, 60, 40, 60);
  pointer(canvas, "pointermove", 2, 160, 120, {
    getCoalescedEvents: () => [
      { clientX: 140, clientY: 120 },
      { clientX: 160, clientY: 120 },
    ],
  });
  pointer(canvas, "lostpointercapture", 2, 160, 120);
  expect(context.quadraticCurveTo).toHaveBeenLastCalledWith(160, 120, 160, 120);
  expect(await command({ count: 3 })).toMatchObject({
    panes: [{ strokes: 2 }, { strokes: 0 }, { strokes: 0 }, { strokes: 0 }],
  });
});

it("runs without ResizeObserver, handles retired pointer capture and releases backing stores on close", async () => {
  vi.stubGlobal("ResizeObserver", undefined);
  render(<SplitBoard />);
  await command({ count: 2 });
  const canvas = panes()[0];
  Object.defineProperty(canvas, "setPointerCapture", {
    value: () => {
      throw new DOMException("retired pointer");
    },
  });
  pointer(canvas, "pointerdown", 1, 20);
  pointer(canvas, "pointerup", 1, 100);
  fireEvent(window, new Event("resize"));
  expect(canvas.width).toBe(300 * (window.devicePixelRatio || 1));
  await command({ open: false });
  expect(canvas.width).toBe(1);
  expect(canvas.height).toBe(1);
  expect(await command({ count: 2 })).toMatchObject({
    panes: [{ strokes: 1 }, { strokes: 0 }, { strokes: 0 }, { strokes: 0 }],
  });
});

it("toggles and dismisses the anchored exit prompt without changing ink or allowing writes under the prompt", async () => {
  render(<SplitBoard />);
  await command({ count: 2 });
  const close = screen.getByRole("button", { name: t("buttons.close") });
  fireEvent.click(close);
  const prompt = () =>
    screen.queryByRole("dialog", { name: t("fcboard.split_exit_prompt") });
  expect(prompt()).toHaveClass("fc-split-exit-dialog");
  expect(prompt()?.closest(".MuiDialog-root")).toBeNull();
  fireEvent.click(close);
  expect(prompt()).toBeNull();
  fireEvent.click(close);
  pointer(panes()[0], "pointerdown", 1, 40);
  pointer(panes()[0], "pointerup", 1, 80);
  expect(prompt()).toBeNull();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(prompt()).not.toBeNull();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(prompt()).toBeNull();
  fireEvent.click(close);
  fireEvent.pointerDown(document.body);
  expect(prompt()).toBeNull();
  expect(await command({ count: 2 })).toMatchObject({
    panes: [{ strokes: 0 }, { strokes: 0 }, { strokes: 0 }, { strokes: 0 }],
  });
});

it("ignores obsolete exports after switching layouts and keeps a newer split session usable", async () => {
  let encode: BlobCallback | undefined;
  const save = vi.spyOn(boardFile, "savePageFiles").mockResolvedValue(true);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback) => {
      encode = callback;
    },
  );
  render(<SplitBoard />);
  await command({ count: 2 });
  fireEvent.click(screen.getByRole("button", { name: t("buttons.close") }));
  fireEvent.click(screen.getByRole("button", { name: t("buttons.save") }));
  expect(
    screen.getByRole("button", { name: t("buttons.save") }),
  ).toBeDisabled();
  await command({ count: 4 });
  expect(panes()).toHaveLength(4);
  await act(async () => encode?.(new Blob(["jpeg"], { type: "image/jpeg" })));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: t("buttons.close") }));
  expect(screen.getByRole("button", { name: t("buttons.save") })).toBeEnabled();
  expect(screen.queryByRole("alert")).toBeNull();
});
