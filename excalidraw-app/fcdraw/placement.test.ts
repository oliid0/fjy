import { getCommonBounds } from "@excalidraw/element";

import { findContentPosition } from "./placement";
import { contentPosition, insertText, insertElements } from "./board";
import {
  insertionDefaults,
  readInsertions,
  renderInsertion,
} from "./insertObjects";
import { sceneAPI } from "./test/scene";

const viewport = { left: 16, top: 16, right: 1264, bottom: 604 };
const overlaps = (a: readonly number[], b: readonly number[]) =>
  a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

it("keeps new content near its question while avoiding occupied space", () => {
  const question = { left: 80, top: 80, right: 320, bottom: 220 };
  const answer = { left: 340, top: 80, right: 640, bottom: 240 };
  const position = findContentPosition(
    { x: 340, y: 80 },
    { width: 280, height: 120 },
    viewport,
    [question, answer],
    16,
  );
  const bounds = [position.x, position.y, position.x + 280, position.y + 120];
  expect(
    overlaps(bounds, [
      question.left,
      question.top,
      question.right,
      question.bottom,
    ]),
  ).toBe(false);
  expect(
    overlaps(bounds, [answer.left, answer.top, answer.right, answer.bottom]),
  ).toBe(false);
  expect(position.y + 120).toBeLessThanOrEqual(viewport.bottom);
});

it("uses an empty area below a full viewport instead of covering the question", () => {
  const position = findContentPosition(
    { x: 400, y: 200 },
    { width: 400, height: 300 },
    viewport,
    [viewport],
    16,
  );
  expect(position.y).toBeGreaterThanOrEqual(viewport.bottom + 16);
});

it("does not jump to distant offscreen objects when the visible board is full", () => {
  const position = findContentPosition(
    { x: 400, y: 200 },
    { width: 400, height: 300 },
    viewport,
    [viewport, { left: 100, right: 800, top: 100000, bottom: 100500 }],
    16,
  );
  expect(position.y).toBe(viewport.bottom + 16);
});

it("reveals appended content with the existing viewport API while preserving the written question", () => {
  const api = sceneAPI();
  insertElements(api, [
    { type: "rectangle", x: 0, y: 0, width: 1600, height: 900 },
  ]);
  const original = [...api.getSceneElements()];
  api.scrollToContent = vi.fn();
  const ids = insertText(api, "Answer", undefined, undefined, original, "text");
  const answer = getCommonBounds(
    api.getSceneElements().filter((element) => ids.includes(element.id)),
  );
  expect(answer[1]).toBeGreaterThanOrEqual(900);
  expect(
    api.getSceneElements().filter((element) => !ids.includes(element.id)),
  ).toEqual(original);
  expect(api.scrollToContent).toHaveBeenCalledWith(
    expect.any(Array),
    expect.objectContaining({
      fitToContent: true,
      minZoom: 0.5,
      maxZoom: 1,
      animate: true,
    }),
  );
});

it("reserves the toolbar and converts viewport limits through the current zoom and scroll", () => {
  const api = sceneAPI();
  const state = api.getAppState();
  vi.spyOn(api, "getAppState").mockReturnValue({
    ...state,
    scrollX: -300,
    scrollY: -200,
    zoom: { value: 2 as typeof state.zoom.value },
  });
  const position = contentPosition(
    api,
    { x: 1090, y: 610 },
    { width: 200, height: 100 },
  );
  expect(position.x).toBeGreaterThanOrEqual(308);
  expect(position.x + 200).toBeLessThanOrEqual(1092);
  expect(position.y + 100).toBeLessThanOrEqual(608);
});

it("uses the actual toolbar bounds for an offset or resized board", () => {
  const api = sceneAPI();
  api.id = "placement-test";
  const state = api.getAppState();
  vi.spyOn(api, "getAppState").mockReturnValue({ ...state, offsetTop: 100 });
  const root = document.createElement("div");
  root.className = "excalidraw";
  root.dataset.excalidrawId = api.id;
  const toolbar = document.createElement("div");
  toolbar.className = "fc-unified-toolbar";
  vi.spyOn(toolbar, "getBoundingClientRect").mockReturnValue({
    top: 800,
    bottom: 900,
    left: 0,
    right: 1600,
    width: 1600,
    height: 100,
    x: 0,
    y: 800,
    toJSON: () => ({}),
  });
  root.append(toolbar);
  document.body.append(root);
  try {
    const position = contentPosition(
      api,
      { x: 300, y: 850 },
      { width: 200, height: 100 },
    );
    expect(position.y + 100).toBeLessThanOrEqual(684);
  } finally {
    root.remove();
  }
});

it("places repeated tables without overlapping and keeps edited object coordinates stable", async () => {
  const api = sceneAPI();
  const first = insertionDefaults("table", { x: 100, y: 100 });
  await renderInsertion(api, first);
  const second = insertionDefaults("table", { x: 100, y: 100 });
  await renderInsertion(api, second);
  const bounds = (id: string) =>
    getCommonBounds(
      api
        .getSceneElements()
        .filter((element) => element.customData?.fcInsertion?.id === id),
    );
  expect(overlaps(bounds(first.id), bounds(second.id))).toBe(false);
  const before = bounds(first.id);
  await renderInsertion(api, {
    ...readInsertions(api).find((object) => object.id === first.id)!,
    cells: ["edited"],
  });
  expect(bounds(first.id)).toEqual(before);
});

it("uses measured multi-line answer bounds for subsequent answers", () => {
  const api = sceneAPI();
  const source = api.getSceneElements();
  const write = () =>
    insertText(
      api,
      "First line\nSecond line\nThird line",
      { x: 160, y: 100 },
      undefined,
      source,
      "text",
    );
  const first = write();
  const second = write();
  const bounds = (ids: string[]) =>
    getCommonBounds(
      api.getSceneElements().filter((element) => ids.includes(element.id)),
    );
  expect(overlaps(bounds(first), bounds(second))).toBe(false);
});
