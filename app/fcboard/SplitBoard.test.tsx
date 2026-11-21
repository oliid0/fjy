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
  node: Element | Window,
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

it("enters writing directly and resizes two panes without losing independent ink", async () => {
  render(<SplitBoard />);
  expect(await command()).toMatchObject({
    open: true,
    count: 2,
    configuring: false,
  });
  expect(
    screen.queryByRole("button", { name: t("buttons.confirm") }),
  ).toBeNull();
  pointer(panes()[0], "pointerdown", 1, 20);
  pointer(panes()[0], "pointerup", 1, 120);
  const board = screen.getByRole("dialog", { name: t("fcboard.split_screen") });
  vi.spyOn(board, "getBoundingClientRect").mockReturnValue(
    new DOMRect(100, 0, 1000, 600),
  );
  const divider = screen.getByRole("separator", {
    name: t("fcboard.split_resize"),
  });
  pointer(divider, "pointerdown", 3, 600);
  pointer(window, "pointermove", 3, 800);
  expect(divider).toHaveAttribute("aria-valuenow", "70");
  pointer(window, "pointerup", 3, 850);
  expect(divider).toHaveAttribute("aria-valuenow", "75");
  pointer(divider, "pointerdown", 4, 850);
  pointer(window, "pointermove", 4, 1100);
  expect(divider).toHaveAttribute("aria-valuenow", "85");
  pointer(window, "pointercancel", 4, 1100);
  expect(divider).toHaveAttribute("aria-valuenow", "75");
  fireEvent.keyDown(divider, { key: "Home" });
  expect(divider).toHaveAttribute("aria-valuenow", "50");
  expect(await command({ count: 3 })).toMatchObject({
    panes: [{ strokes: 1 }, { strokes: 0 }, { strokes: 0 }, { strokes: 0 }],
  });
  expect(screen.queryByRole("separator")).toBeNull();
});

it("uses exactly the three original colored pen images and one eraser with independent working tool selection", async () => {
  render(<SplitBoard />);
  await command();
  const tools = panes()[0].parentElement!.querySelector(".fc-split-penbar")!;
  const buttons = within(tools as HTMLElement).getAllByRole("button");
  expect(buttons).toHaveLength(4);
  expect(tools.querySelector("svg")).toBeNull();
  const names = [
    "split_black",
    "split_blue",
    "split_red",
    "split_large_eraser",
  ] as const;
  const images = ["ic_black_pen", "ic_blue_pen", "ic_red_pen", "ic_big_eraser"];
  const colors = ["#000000", "#0000ff", "#ff0000"];
  const context = panes()[0].getContext("2d")!;
  for (let index = 0; index < buttons.length; index++) {
    const button = pane(1).getByRole("button", {
      name: t(`fcboard.${names[index]}`),
    });
    expect(button.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringContaining(`${images[index]}.svg`),
    );
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(tools.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
    pointer(panes()[0], "pointerdown", index + 1, 20);
    expect(context.globalCompositeOperation).toBe(
      index === 3 ? "destination-out" : "source-over",
    );
    if (index < 3) {
      expect(context.strokeStyle).toBe(colors[index]);
    }
    pointer(panes()[0], "pointerup", index + 1, 80);
    expect(
      pane(2).getByRole("button", { name: t("fcboard.split_black") }),
    ).toHaveAttribute("aria-pressed", "true");
  }
});

it("retains each hidden pane's independent color and ink through 4/2/3/4 layout and close/reopen", async () => {
  render(<SplitBoard />);
  await command({ count: 4 });
  fireEvent.click(
    pane(3).getByRole("button", { name: t("fcboard.split_red") }),
  );

  pointer(panes()[2], "pointerdown", 3, 20);
  pointer(panes()[2], "pointerup", 3, 120);
  const hiddenCanvas = panes()[2];
  await command({ count: 2 });
  expect(hiddenCanvas.width).toBe(1);
  expect(hiddenCanvas.height).toBe(1);
  await command({ count: 3 });
  expect(
    pane(3).getByRole("button", { name: t("fcboard.split_red") }),
  ).toHaveAttribute("aria-pressed", "true");

  expect(
    pane(1).getByRole("button", { name: t("fcboard.split_black") }),
  ).toHaveAttribute("aria-pressed", "true");
  await command({ open: false });
  expect(await command({ count: 4 })).toMatchObject({
    panes: [{ strokes: 0 }, { strokes: 0 }, { strokes: 1 }, { strokes: 0 }],
  });
  pointer(panes()[2], "pointerdown", 4, 20);
  pointer(panes()[2], "pointerup", 4, 140);
  expect(panes()[2].getContext("2d")!.strokeStyle).toBe("#ff0000");
  expect(panes()[2].getContext("2d")!.lineWidth).toBe(
    2.01 * (window.devicePixelRatio || 1),
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

it("keeps coalesced bends and dispatch tails on move and release with one layout read per packet", async () => {
  render(<SplitBoard />);
  await command();
  const node = panes()[0];
  const context = node.getContext("2d")!;
  const bounds = vi.mocked(HTMLCanvasElement.prototype.getBoundingClientRect);
  pointer(node, "pointerdown", 1, 20);
  bounds.mockClear();
  pointer(node, "pointermove", 1, 100, 100, {
    getCoalescedEvents: () => [{ clientX: 60, clientY: 160 }],
  });
  expect(bounds).toHaveBeenCalledTimes(1);
  expect(context.quadraticCurveTo).toHaveBeenLastCalledWith(60, 160, 80, 130);
  bounds.mockClear();
  pointer(node, "pointerup", 1, 180, 60, {
    getCoalescedEvents: () => [{ clientX: 140, clientY: 20 }],
  });
  expect(bounds).toHaveBeenCalledTimes(1);
  const releasedBend = vi.mocked(context.quadraticCurveTo).mock.calls[2];
  expect(releasedBend.slice(0, 3)).toEqual([100, 100, 120]);
  expect(releasedBend[3]).toBeCloseTo(60);
  expect(context.quadraticCurveTo).toHaveBeenCalledWith(140, 20, 160, 40);
  expect(context.quadraticCurveTo).toHaveBeenLastCalledWith(180, 60, 180, 60);
  vi.mocked(context.quadraticCurveTo).mockClear();
  bounds.mockReturnValue(new DOMRect(0, 0, 600, 500));
  fireEvent(window, new Event("resize"));
  expect(context.quadraticCurveTo).toHaveBeenCalledWith(120, 160, 160, 130);
  expect(context.quadraticCurveTo).toHaveBeenCalledWith(280, 20, 320, 40);
});

it("keeps five elongated finger contacts as independent ink and erases the real palm rectangle", async () => {
  render(<SplitBoard />);
  await command();
  const node = panes()[0];
  const context = node.getContext("2d")!;
  const finger = { pointerType: "touch", width: 20, height: 80 };
  for (let id = 1; id <= 5; id++) {
    pointer(node, "pointerdown", id, id * 30, 60, finger);
    expect(context.globalCompositeOperation).toBe("source-over");
  }
  for (let id = 1; id <= 5; id++) {
    pointer(node, "pointerup", id, id * 30 + 10, 80, finger);
  }
  expect(await command()).toMatchObject({
    panes: [{ strokes: 5 }, { strokes: 0 }, { strokes: 0 }, { strokes: 0 }],
  });
  pointer(node, "pointerdown", 6, 150, 250, {
    pointerType: "touch",
    width: 70,
    height: 110,
  });
  expect(context.globalCompositeOperation).toBe("destination-out");
  expect(context.moveTo).toHaveBeenLastCalledWith(115, 195);
  expect(context.lineTo).toHaveBeenCalledWith(185, 305);
  pointer(node, "pointerup", 6, 160, 250);
  pointer(node, "pointerdown", 7, 80, 80, { button: 5, buttons: 32 });
  expect(context.globalCompositeOperation).toBe("destination-out");
  pointer(node, "pointerup", 7, 90, 80);
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
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.save") }));
  expect(
    screen.getByRole("button", { name: t("fcboard.save") }),
  ).toBeDisabled();
  await command({ count: 4 });
  expect(panes()).toHaveLength(4);
  await act(async () => encode?.(new Blob(["jpeg"], { type: "image/jpeg" })));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: t("buttons.close") }));
  expect(screen.getByRole("button", { name: t("fcboard.save") })).toBeEnabled();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("dismisses split save progress by an outside touch and cancels late encoding without losing ink", async () => {
  let encode!: BlobCallback;
  const save = vi.spyOn(boardFile, "savePageFiles").mockResolvedValue(true);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback) => {
      encode = callback;
    },
  );
  render(<SplitBoard />);
  await command();
  pointer(panes()[0], "pointerdown", 1, 20);
  pointer(panes()[0], "pointerup", 1, 120);
  fireEvent.click(screen.getByRole("button", { name: t("buttons.close") }));
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.save") }));
  fireEvent.pointerDown(document.body);
  expect(
    screen.queryByRole("dialog", { name: t("fcboard.split_exit_prompt") }),
  ).toBeNull();
  expect(panes()[0]).toHaveAttribute("aria-disabled", "false");
  await act(async () => encode(new Blob(["jpeg"], { type: "image/jpeg" })));
  expect(save).not.toHaveBeenCalled();
  expect(await command({ count: 2 })).toMatchObject({
    panes: [{ strokes: 1 }, { strokes: 0 }, { strokes: 0 }, { strokes: 0 }],
  });
});
