import { Fcboard } from "@fcboard/fcboard";

import * as StaticScene from "@fcboard/fcboard/renderer/staticScene";

import { Keyboard } from "@fcboard/fcboard/tests/helpers/ui";
import { act, fireEvent, render } from "@fcboard/fcboard/tests/test-utils";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { LiveTableWriting } from "./liveTableWriting";
import {
  insertionDefaults,
  renderInsertion,
  readInsertions,
} from "./insertObjects";

let api: FcboardImperativeAPI;
let view: Awaited<ReturnType<typeof render>>;
let release: () => void;
let canvas: Element;
const pointer = (type: string, x: number, y: number, id = 1) => {
  fireEvent(
    canvas,
    Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
      clientX: x,
      clientY: y,
      pointerId: id,
      pointerType: "pen",
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      pressure: 0.7,
      width: 1,
      height: 1,
    }),
  );
  act(() => vi.advanceTimersToNextFrame());
};
const table = (index = 0) => readInsertions(api)[index];
beforeEach(async () => {
  view = await render(
    <Fcboard
      handleKeyboardGlobally
      UIOptions={{ unifiedToolbar: true }}
      onFcboardAPI={(value) => {
        api = value;
      }}
    />,
  );
  const live = new LiveTableWriting(api);
  const stops = [
    api.onInkProgress(live.progress),
    api.onInkCommit(live.commit),
  ];
  release = () => {
    stops.forEach((stop) => stop());
    live.clear();
  };
  await act(async () => {
    await renderInsertion(
      api,
      insertionDefaults("table", { x: 100, y: 100 }),
      true,
      { exact: true },
    );
  });
  act(() => api.setActiveTool({ type: "freedraw" }));
  canvas = view.container.querySelector("canvas.interactive")!;
  vi.useFakeTimers({
    toFake: ["requestAnimationFrame", "cancelAnimationFrame"],
  });
});
afterEach(() => {
  fireEvent(window, new Event("blur"));
  release();
  view.unmount();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("expands the visible cell before release, keeps its largest extent, and undoes ink plus geometry once", () => {
  pointer("pointerdown", 125, 125);
  pointer("pointermove", 300, 190);
  expect(table().columnWidths).toEqual([220, 120, 120]);
  expect(table().rowHeights).toEqual([110, 60, 60]);
  pointer("pointermove", 180, 135);
  expect(table().width).toBe(460);
  pointer("pointerup", 180, 135);
  const ink = api
    .getSceneElements()
    .find((element) => element.type === "freedraw")!;
  expect(ink.customData?.fcInsertion.inkCell).toBe(0);
  expect(ink.points).toContainEqual([175, 65]);
  Keyboard.undo();
  expect(table().width).toBe(360);
  expect(api.getSceneElements().some((element) => element.id === ink.id)).toBe(
    false,
  );
  Keyboard.redo();
  expect(table().width).toBe(460);
  expect(api.getSceneElements().some((element) => element.id === ink.id)).toBe(
    true,
  );
});

it.each(["pointercancel", "lostpointercapture", "blur"])(
  "restores live table growth and its moved neighbors on %s",
  (event) => {
    const original = JSON.stringify(api.getSceneElements());
    pointer("pointerdown", 125, 125);
    pointer("pointermove", 350, 215);
    expect(table().width).toBe(510);
    if (event === "blur") {
      fireEvent(window, new Event(event));
    } else {
      pointer(event, 350, 215);
    }
    expect(table().width).toBe(360);
    expect(JSON.stringify(api.getSceneElements())).toBe(original);
  },
);

it("does not capture another still-writing table in the completed pointer's undo entry", async () => {
  await act(async () => {
    await renderInsertion(
      api,
      insertionDefaults("table", { x: 700, y: 100 }),
      true,
      { exact: true },
    );
  });
  pointer("pointerdown", 125, 125, 1);
  pointer("pointermove", 350, 215, 1);
  pointer("pointerdown", 725, 125, 2);
  pointer("pointermove", 950, 215, 2);
  expect(readInsertions(api).map((item) => item.width)).toEqual([510, 510]);
  pointer("pointerup", 350, 215, 1);
  expect(readInsertions(api).map((item) => item.width)).toEqual([510, 510]);
  pointer("pointercancel", 950, 215, 2);
  expect(readInsertions(api).map((item) => item.width)).toEqual([510, 360]);
  Keyboard.undo();
  expect(readInsertions(api).map((item) => item.width)).toEqual([360, 360]);
  Keyboard.redo();
  expect(readInsertions(api).map((item) => item.width)).toEqual([510, 360]);
});

it("pins a second pen to the displayed cell and keeps both completed contacts independently undoable", () => {
  pointer("pointerdown", 125, 125, 1);
  pointer("pointermove", 350, 150, 1);
  expect(table().columnWidths).toEqual([270, 120, 120]);
  pointer("pointerdown", 400, 125, 2);
  pointer("pointermove", 500, 150, 2);
  expect(table().columnWidths).toEqual([270, 150, 120]);
  pointer("pointerup", 350, 150, 1);
  expect(table().columnWidths).toEqual([270, 150, 120]);
  pointer("pointerup", 500, 150, 2);
  const strokes = api
    .getSceneElements()
    .filter((item) => item.type === "freedraw");
  expect(strokes.map((item) => item.customData?.fcInsertion.inkCell)).toEqual([
    0, 1,
  ]);
  expect(strokes.map((item) => item.x)).toEqual([125, 400]);
  Keyboard.undo();
  expect(table().columnWidths).toEqual([270, 120, 120]);
  Keyboard.undo();
  expect(table().width).toBe(360);
  expect(api.getSceneElements().some((item) => item.type === "freedraw")).toBe(
    false,
  );
  Keyboard.redo();
  Keyboard.redo();
  expect(table().columnWidths).toEqual([270, 150, 120]);
});

it("moves completed neighboring ink during writing, restores it on cancel, and captures it with the completed expansion", () => {
  pointer("pointerdown", 245, 185);
  pointer("pointerup", 265, 195);
  const neighbor = api
    .getSceneElements()
    .find((item) => item.type === "freedraw")!;
  pointer("pointerdown", 125, 125);
  pointer("pointermove", 350, 215);
  const moved = () =>
    api.getSceneElements().find((item) => item.id === neighbor.id)!;
  expect([moved().x, moved().y]).toEqual([395, 260]);
  pointer("pointercancel", 350, 215);
  expect([moved().x, moved().y]).toEqual([245, 185]);
  pointer("pointerdown", 125, 125);
  pointer("pointerup", 350, 215);
  expect([moved().x, moved().y]).toEqual([395, 260]);
  Keyboard.undo();
  expect(table().width).toBe(360);
  expect([moved().x, moved().y]).toEqual([245, 185]);
  expect(
    api.getSceneElements().filter((item) => item.type === "freedraw"),
  ).toHaveLength(1);
});

it("keeps ordinary cell writing on the ink overlay without republishing a static table for every sample", () => {
  const paint = vi.spyOn(StaticScene, "renderStaticScene");
  pointer("pointerdown", 125, 125);
  const before = paint.mock.calls.length;
  for (let index = 1; index <= 40; index++) {
    pointer("pointermove", 125 + index, 125 + index / 5);
  }
  expect(paint.mock.calls.length).toBe(before);
  expect(table().width).toBe(360);
  pointer("pointerup", 165, 133);
  expect(table().width).toBe(360);
});

it("never restores an old table after replacing the page during a live stroke", () => {
  pointer("pointerdown", 125, 125);
  pointer("pointermove", 350, 215);
  act(() => api.updateScene({ elements: [] }));
  pointer("pointercancel", 350, 215);
  expect(api.getSceneElements()).toHaveLength(0);
});

it("restores legacy positional table IDs and layer order when live writing is cancelled", () => {
  const original = api
    .getSceneElements()
    .map((element, index) => ({ ...element, id: `${table().id}-${index}` }));
  act(() => api.updateScene({ elements: original }));
  const before = JSON.stringify(api.getSceneElements());
  pointer("pointerdown", 125, 125);
  pointer("pointermove", 350, 215);
  expect(table().width).toBe(510);
  pointer("pointercancel", 350, 215);
  expect(JSON.stringify(api.getSceneElements())).toBe(before);
});
