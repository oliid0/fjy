import { Fcboard } from "../index";
import { getNormalizedZoom } from "../scene";
import { t } from "../i18n";

import { API } from "./helpers/api";
import { act, fireEvent, render, screen, cleanup } from "./test-utils";

// Exercise the real frame coalescer; the shared test setup otherwise runs it
// synchronously and cannot catch a second queued paint or a lost final sample.
vi.mock("@fcboard/common", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fcboard/common")>()),
}));

const { h } = window;
let callbacks: Map<number, FrameRequestCallback>;
let originalThrottling: boolean | undefined;
const frame = () =>
  act(() => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    pending.forEach((callback) => callback(performance.now()));
  });
const touch = (
  canvas: Element,
  type: string,
  id: number,
  x: number,
  y: number,
) => {
  fireEvent(
    canvas,
    Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
      clientX: x,
      clientY: y,
      pointerId: id,
      pointerType: "touch",
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      pressure: 0.5,
      width: 1,
      height: 1,
    }),
  );
};
const scale = () => screen.queryByLabelText(t("fcboard.zoom_level"));
const setup = async (zoom = 1) => {
  const view = await render(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  act(() => {
    API.setAppState({
      width: 1600,
      height: 900,
      scrollX: 0,
      scrollY: 0,
      zoom: { value: getNormalizedZoom(zoom) },
    });
    h.app.setActiveTool({ type: "hand" });
  });
  frame();
  return {
    ...view,
    canvas: view.container.querySelector("canvas.interactive")!,
  };
};
beforeEach(() => {
  callbacks = new Map();
  let id = 0;
  originalThrottling = window.EXCALIDRAW_THROTTLE_RENDER;
  window.EXCALIDRAW_THROTTLE_RENDER = true;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callbacks.set(++id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    callbacks.delete(id);
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.EXCALIDRAW_THROTTLE_RENDER = originalThrottling;
});

it("coalesces two-finger panning to the current frame, retains native scale focus, and resets only scale", async () => {
  const { canvas, container } = await setup();
  API.updateScene({
    elements: Array.from({ length: 100 }, (_, index) =>
      API.createElement({
        type: "rectangle",
        x: index * 3,
        y: 100,
        width: 20,
        height: 30,
      }),
    ),
  });
  frame();
  const elements = h.elements;
  const versions = elements.map((element) => element.version);
  const context = container
    .querySelector<HTMLCanvasElement>("canvas.static")!
    .getContext("2d")!;
  const paint = vi.spyOn(context, "fillRect");
  touch(canvas, "pointerdown", 1, 100, 100);
  expect(scale()).toBeNull();
  touch(canvas, "pointerdown", 2, 300, 100);
  for (let distance = 5; distance <= 50; distance += 5) {
    touch(canvas, "pointermove", 1, 100 + distance, 100 + distance * 0.4);
    touch(canvas, "pointermove", 2, 300 + distance, 100 + distance * 0.4);
  }
  expect(h.state.scrollX).toBe(0);
  const before = paint.mock.calls.length;
  frame();
  expect(h.state.zoom.value).toBe(1);
  expect(h.state.scrollX).toBeCloseTo(50);
  expect(h.state.scrollY).toBeCloseTo(20);
  expect(paint.mock.calls.length - before).toBe(1);
  touch(canvas, "pointermove", 2, 650, 120);
  frame();
  expect(h.state.zoom.value).toBe(2);
  // Actual midpoint is 400; original keeps the last translation center 250.
  expect(250 / h.state.zoom.value - h.state.scrollX).toBeCloseTo(200);
  touch(canvas, "pointerup", 1, 150, 120);
  touch(canvas, "pointerup", 2, 650, 120);
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.reset") }));
  expect(h.state.zoom.value).toBe(1);
  expect(h.state.scrollX).toBeCloseTo(50);
  expect(h.state.scrollY).toBeCloseTo(20);
  expect(scale()).toBeNull();
  expect(h.elements).toBe(elements);
  expect(h.elements.map((element) => element.version)).toEqual(versions);
});

it("renews the original one-second indicator timer even at the limit and stays hidden after reset", async () => {
  const { canvas } = await setup(2);
  vi.useFakeTimers();
  expect(scale()).toBeNull();
  touch(canvas, "pointerdown", 1, 100, 100);
  touch(canvas, "pointerdown", 2, 300, 100);
  expect(scale()).toHaveTextContent(t("fcboard.scale_tips", { value: 200 }));
  act(() => vi.advanceTimersByTime(900));
  touch(canvas, "pointermove", 2, 400, 100);
  frame();
  act(() => vi.advanceTimersByTime(900));
  expect(scale()).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(101));
  expect(scale()).toBeNull();
  touch(canvas, "pointermove", 2, 450, 100);
  frame();
  expect(scale()).toBeInTheDocument();
  touch(canvas, "pointerup", 1, 100, 100);
  touch(canvas, "pointerup", 2, 450, 100);
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.reset") }));
  frame();
  expect(scale()).toBeNull();
  act(() => vi.advanceTimersByTime(1200));
  expect(scale()).toBeNull();
});

it.each([0.5, 1, 2])(
  "keeps single-finger hand dragging one-to-one at zoom %s, including the release sample",
  async (zoom) => {
    const { canvas, container } = await setup(zoom);
    const context = container
      .querySelector<HTMLCanvasElement>("canvas.static")!
      .getContext("2d")!;
    const paint = vi.spyOn(context, "fillRect");
    touch(canvas, "pointerdown", 1, 100, 100);
    for (let x = 110; x <= 200; x += 10) {
      touch(canvas, "pointermove", 1, x, 120);
    }
    expect(h.state.scrollX).toBe(0);
    const before = paint.mock.calls.length;
    frame();
    expect(h.state.scrollX * zoom).toBeCloseTo(100);
    expect(h.state.scrollY * zoom).toBeCloseTo(20);
    expect(paint.mock.calls.length - before).toBe(1);
    touch(canvas, "pointerup", 1, 230, 130);
    expect(h.state.scrollX * zoom).toBeCloseTo(130);
    expect(h.state.scrollY * zoom).toBeCloseTo(30);
    expect(scale()).toBeNull();
    frame();
    expect(h.state.scrollX * zoom).toBeCloseTo(130);
    expect(h.elements).toHaveLength(0);
  },
);

it("flushes the last pinch before lift and starts the next handwriting stroke without waiting", async () => {
  const { canvas } = await setup();
  act(() => {
    API.setAppState({ multiStroke: false });
    h.app.setActiveTool({ type: "freedraw" });
  });
  touch(canvas, "pointerdown", 1, 100, 100);
  touch(canvas, "pointermove", 1, 110, 100);
  touch(canvas, "pointerdown", 2, 310, 100);
  touch(canvas, "pointermove", 2, 410, 100);
  // No frame has run; pointer release must flush the last transform once.
  touch(canvas, "pointerup", 2, 410, 100);
  touch(canvas, "pointerup", 1, 110, 100);
  expect(h.state.zoom.value).toBeCloseTo(1.5);
  expect(h.elements).toHaveLength(0);
  touch(canvas, "pointerdown", 3, 100, 300);
  touch(canvas, "pointermove", 3, 250, 300);
  touch(canvas, "pointerup", 3, 250, 300);
  expect(h.elements).toHaveLength(1);
  expect(h.elements[0].width).toBeCloseTo(100);
  frame();
  expect(h.state.zoom.value).toBeCloseTo(1.5);
  expect(h.elements).toHaveLength(1);
});

it("changes from an unpainted hand drag to multi-finger panning without a jump and restores the next drag", async () => {
  const { canvas } = await setup();
  touch(canvas, "pointerdown", 1, 100, 100);
  touch(canvas, "pointermove", 1, 150, 120);
  // Joining the second contact consumes the pending drag before rebasing.
  touch(canvas, "pointerdown", 2, 350, 120);
  expect(h.state.scrollX).toBeCloseTo(50);
  expect(h.state.scrollY).toBeCloseTo(20);
  expect(h.state.zoom.value).toBe(1);
  touch(canvas, "pointermove", 1, 200, 140);
  touch(canvas, "pointermove", 2, 400, 140);
  frame();
  expect(h.state.scrollX).toBeCloseTo(100);
  expect(h.state.scrollY).toBeCloseTo(40);
  expect(h.state.zoom.value).toBe(1);
  touch(canvas, "pointerup", 2, 400, 140);
  touch(canvas, "pointerup", 1, 200, 140);
  touch(canvas, "pointerdown", 3, 100, 100);
  touch(canvas, "pointermove", 3, 120, 110);
  touch(canvas, "pointerup", 3, 130, 115);
  expect(h.state.scrollX).toBeCloseTo(130);
  expect(h.state.scrollY).toBeCloseTo(55);
});

it("finishes a rapid lasso and immediately moves the selected object before any frame paints", async () => {
  const { canvas } = await setup();
  const object = API.createElement({
    type: "rectangle",
    x: 100,
    y: 100,
    width: 60,
    height: 40,
  });
  API.updateScene({ elements: [object] });
  act(() => h.app.setActiveTool({ type: "selection" }));
  touch(canvas, "pointerdown", 1, 70, 70);
  for (const [x, y] of [
    [190, 70],
    [190, 170],
    [70, 170],
  ]) {
    touch(canvas, "pointermove", 1, x, y);
  }
  touch(canvas, "pointerup", 1, 70, 70);
  expect(h.state.selectedElementIds).toEqual({ [object.id]: true });
  expect(h.state.whiteboardSelection?.elementIds).toEqual([object.id]);
  touch(canvas, "pointerdown", 2, 130, 120);
  touch(canvas, "pointermove", 2, 170, 150);
  touch(canvas, "pointerup", 2, 180, 160);
  expect(h.elements[0]).toMatchObject({ x: 150, y: 140 });
});
