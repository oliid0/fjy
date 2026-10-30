import { getCommonBounds, newFreeDrawElement } from "@fcboard/element";
import { pointFrom } from "@fcboard/math";

import { findContentPosition } from "./placement";
import {
  contentPosition,
  contentViewport,
  insertText,
  insertElements,
  drawPlot,
  selectedPlot,
} from "./board";
import { validatedPlot } from "./mathRecognition";
import {
  insertionDefaults,
  readInsertions,
  renderInsertion,
} from "./insertObjects";
import { sceneAPI } from "./test/scene";

const viewport = { left: 16, top: 16, right: 1264, bottom: 604 };
const overlaps = (a: readonly number[], b: readonly number[]) =>
  a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

it("right-aligns a vertical arithmetic result below the bar at the original handwriting size", () => {
  const api = sceneAPI();
  const source = [
    [
      [100, 100],
      [180, 140],
    ],
    [
      [110, 170],
      [180, 210],
    ],
    [
      [80, 225],
      [200, 225],
    ],
  ].map((points) =>
    newFreeDrawElement({
      type: "freedraw",
      x: points[0][0],
      y: points[0][1],
      points: points.map(([x, y]) =>
        pointFrom(x - points[0][0], y - points[0][1]),
      ),
      strokeColor: "#dc2626",
      simulatePressure: true,
    }),
  );
  api.updateScene({ elements: source });
  const ids = insertText(api, "168", undefined, undefined, source, "match", {
    mode: "column",
    sourceLines: 2,
  });
  const bounds = getCommonBounds(
    api.getSceneElements().filter((element) => ids.includes(element.id)),
  );
  expect(bounds[1]).toBeGreaterThan(225);
  expect(bounds[2]).toBeCloseTo(200);
  expect(bounds[3] - bounds[1]).toBeCloseTo(36);
});

it("inserts Chinese answers at 90% of measured handwriting without applying ink-glyph scaling twice", () => {
  const api = sceneAPI();
  const source = newFreeDrawElement({
    type: "freedraw",
    x: 200,
    y: 180,
    points: [pointFrom(0, 0), pointFrom(60, 40)],
    strokeColor: "#dc2626",
    simulatePressure: true,
  });
  api.updateScene({ elements: [source] });
  const ids = insertText(
    api,
    "牛顿第一定律",
    undefined,
    undefined,
    [source],
    "match",
  );
  const answer = api
    .getSceneElements()
    .find((element) => ids.includes(element.id));
  expect(answer).toMatchObject({
    type: "text",
    fontSize: 36,
    strokeColor: "#dc2626",
  });
  expect(answer!.y).toBeGreaterThanOrEqual(220);
});

it("keeps answer text legible near an edge by using nearby empty space before shrinking", () => {
  const api = sceneAPI();
  const ids = insertElements(api, [
    { type: "text", text: "Question", fontSize: 40, x: 1400, y: 720 },
  ]);
  const source = api
    .getSceneElements()
    .filter((element) => ids.includes(element.id));
  const answer = insertText(
    api,
    "Answer with several lines of explanation to show near the question.",
    undefined,
    undefined,
    source,
    "text",
  );
  const result = api
    .getSceneElements()
    .filter((element) => answer.includes(element.id));
  expect(result[0]).toMatchObject({ type: "text", fontSize: 40 });
  const bounds = getCommonBounds(result);
  const viewport = contentViewport(api);
  expect(bounds[0]).toBeGreaterThanOrEqual(viewport.left);
  expect(bounds[2]).toBeLessThanOrEqual(viewport.right);
  expect(bounds[3]).toBeLessThanOrEqual(viewport.bottom);
  expect(overlaps(bounds, getCommonBounds(source))).toBe(false);
});

it.each([
  [390, 844, 1],
  [800, 600, 1],
  [3080, 1240, 0.5],
  [3080, 1240, 2],
])(
  "writes in an empty visible center and avoids the first writing at %s×%s / %s",
  (width, height, zoom) => {
    const api = sceneAPI();
    vi.spyOn(api, "getAppState").mockReturnValue({
      ...api.getAppState(),
      width,
      height,
      zoom: { value: zoom as never },
      scrollX: -100,
      scrollY: -50,
    });
    const viewport = contentViewport(api);
    const write = () =>
      insertText(api, "1+1=2", undefined, undefined, undefined, "handwritten", {
        mode: "center",
      });
    const bounds = (ids: string[]) =>
      getCommonBounds(
        api.getSceneElements().filter((element) => ids.includes(element.id)),
      );
    const first = bounds(write());
    expect((first[0] + first[2]) / 2).toBeCloseTo(
      (viewport.left + viewport.right) / 2,
    );
    expect((first[1] + first[3]) / 2).toBeCloseTo(
      (viewport.top + viewport.bottom) / 2,
    );
    const second = bounds(write());
    expect(overlaps(first, second)).toBe(false);
    for (const box of [first, second]) {
      expect(box[0]).toBeGreaterThanOrEqual(viewport.left);
      expect(box[1]).toBeGreaterThanOrEqual(viewport.top);
      expect(box[2]).toBeLessThanOrEqual(viewport.right);
      expect(box[3]).toBeLessThanOrEqual(viewport.bottom);
    }
  },
);

it.each([
  [800, 600, 1],
  [3080, 1240, 0.5],
  [3080, 1240, 2],
])(
  "fits editable function axes, labels and curves inside %s×%s at zoom %s",
  (width, height, zoom) => {
    const api = sceneAPI();
    vi.spyOn(api, "getAppState").mockReturnValue({
      ...api.getAppState(),
      width,
      height,
      zoom: { value: zoom as never },
    });
    const plot = validatedPlot({ expression: "2*x+1", relation: ">=" });
    const ids = drawPlot(api, plot, { x: 2000, y: 1800 });
    const objects = api
      .getSceneElements()
      .filter((element) => ids.includes(element.id));
    const [left, top, right, bottom] = getCommonBounds(objects);
    expect(left).toBeGreaterThanOrEqual(16 / zoom - 0.01);
    expect(top).toBeGreaterThanOrEqual(16 / zoom - 0.01);
    expect(right).toBeLessThanOrEqual((width - 16) / zoom + 0.01);
    expect(bottom).toBeLessThanOrEqual((height - 84) / zoom + 0.01);
    expect(objects.some((object) => object.backgroundColor === "#2563eb")).toBe(
      true,
    );
    vi.spyOn(api, "getAppState").mockReturnValue({
      ...api.getAppState(),
      selectedElementIds: { [ids[0]]: true },
    });
    expect(selectedPlot(api)?.plot).toEqual(plot);
  },
);

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

it("preserves the question and reports a full visible board instead of inserting invisible text", () => {
  const api = sceneAPI();
  insertElements(api, [
    { type: "rectangle", x: 0, y: 0, width: 1600, height: 900 },
  ]);
  const original = [...api.getSceneElements()];
  api.scrollToContent = vi.fn();
  expect(() =>
    insertText(api, "Answer", undefined, undefined, original, "text"),
  ).toThrow();
  expect(api.getSceneElements()).toEqual(original);
  expect(api.scrollToContent).not.toHaveBeenCalled();
});

it("keeps the selected text alignment and size when inserting the next answer", () => {
  const api = sceneAPI();
  insertElements(api, [
    {
      type: "text",
      text: "课程笔记",
      x: 120,
      y: 100,
      fontSize: 40,
      strokeColor: "#dc2626",
      textAlign: "center",
    },
  ]);
  const source = api
    .getSceneElements()
    .filter(
      (element) => element.type === "text" && element.text === "课程笔记",
    );
  const ids = insertText(api, "已统一样式", undefined, undefined, source);
  const answer = api
    .getSceneElements()
    .find((element) => ids.includes(element.id));
  expect(answer).toMatchObject({
    type: "text",
    fontSize: 40,
    strokeColor: "#dc2626",
    textAlign: "center",
  });
});

it.each([0.5, 1, 2])(
  "fits long Chinese/English answers into a 3080×1240 visible board at zoom %s",
  (zoom) => {
    const api = sceneAPI();
    const state = api.getAppState();
    vi.spyOn(api, "getAppState").mockReturnValue({
      ...state,
      width: 3080,
      height: 1240,
      zoom: { value: zoom as typeof state.zoom.value },
      scrollX: -300,
      scrollY: -100,
    });
    const source = newFreeDrawElement({
      type: "freedraw",
      x: 400,
      y: 200,
      points: [pointFrom(0, 0), pointFrom(80 / zoom, 32 / zoom)],
      strokeColor: "#ff0000",
      strokeWidth: 2 / zoom,
      simulatePressure: true,
    });
    api.updateScene({ elements: [source] });
    const ids = insertText(
      api,
      "牛顿第二定律 F=ma。".repeat(100) + " VeryLongEnglishWord".repeat(100),
      undefined,
      undefined,
      [source],
      "text",
    );
    const answer = api
      .getSceneElements()
      .filter((element) => ids.includes(element.id));
    const [left, top, right, bottom] = getCommonBounds(answer);
    expect(left).toBeGreaterThanOrEqual(300 + 16 / zoom);
    expect(top).toBeGreaterThan(200 + 32 / zoom);
    expect(right).toBeLessThanOrEqual(300 + (3080 - 16) / zoom);
    expect(bottom).toBeLessThanOrEqual(100 + (1240 - 84) / zoom);
    expect(answer[0].type === "text" && answer[0].fontSize).toBeLessThanOrEqual(
      32 / zoom,
    );
    expect(answer[0].type === "text" && answer[0].text).toContain("\n");
  },
);

it("puts a short handwritten calculation result after the equation, with matching height and colour", () => {
  const api = sceneAPI();
  const source = newFreeDrawElement({
    type: "freedraw",
    x: 100,
    y: 100,
    points: [pointFrom(0, 0), pointFrom(160, 40)],
    strokeColor: "#ff0000",
    strokeWidth: 2,
    simulatePressure: true,
  });
  api.updateScene({ elements: [source] });
  const ids = insertText(api, "2", undefined, undefined, [source], "match", {
    mode: "inline",
  });
  const ink = api
    .getSceneElements()
    .filter((element) => ids.includes(element.id));
  const [left, top, , bottom] = getCommonBounds(ink);
  expect(left).toBeGreaterThan(260);
  expect(top).toBeCloseTo(100);
  expect(bottom - top).toBeLessThanOrEqual(44);
  expect(
    ink.every(
      (element) =>
        element.type === "freedraw" && element.strokeColor === "#ff0000",
    ),
  ).toBe(true);
});

it.each([0.5, 1, 2])(
  "keeps 207 after the equals sign at 90%% of the handwritten height at zoom %s",
  (zoom) => {
    const api = sceneAPI();
    vi.spyOn(api, "getAppState").mockReturnValue({
      ...api.getAppState(),
      width: 1600,
      height: 900,
      zoom: { value: zoom as never },
    });
    const source = newFreeDrawElement({
      type: "freedraw",
      x: 100 / zoom,
      y: 100 / zoom,
      points: [pointFrom(0, 0), pointFrom(800 / zoom, 120 / zoom)],
      strokeColor: "#ffffff",
      simulatePressure: true,
    });
    api.updateScene({ elements: [source] });
    const ids = insertText(
      api,
      "207",
      undefined,
      undefined,
      [source],
      "match",
      {
        mode: "inline",
      },
    );
    const [left, top, right, bottom] = getCommonBounds(
      api.getSceneElements().filter((element) => ids.includes(element.id)),
    );
    expect(left).toBeGreaterThan(900 / zoom);
    expect(top).toBeCloseTo(100 / zoom);
    expect(right).toBeLessThanOrEqual(contentViewport(api).right);
    expect(bottom - top).toBeCloseTo((120 * 0.9) / zoom);
  },
);

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
  root.className = "fcboard";
  root.dataset.fcboardId = api.id;
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

it("places a function beside its source rather than at the old distant lower-right origin", () => {
  const api = sceneAPI();
  insertElements(api, [{ type: "text", text: "y=x+1", x: 200, y: 300 }]);
  const source = api.getSceneElements().at(-1)!;
  const [left, top, right, bottom] = getCommonBounds([source]);
  const ids = drawPlot(
    api,
    validatedPlot({ expression: "x+1" }),
    { x: 1800, y: 1600 },
    [],
    undefined,
    true,
    { left, top, right, bottom },
  );
  const graph = getCommonBounds(
    api.getSceneElements().filter((element) => ids.includes(element.id)),
  );
  expect(overlaps(graph, [left, top, right, bottom])).toBe(false);
  const gapX = Math.max(0, graph[0] - right, left - graph[2]);
  const gapY = Math.max(0, graph[1] - bottom, top - graph[3]);
  expect(Math.hypot(gapX, gapY)).toBeLessThanOrEqual(12);
  expect(graph[2]).toBeLessThanOrEqual(1584);
  expect(graph[3]).toBeLessThanOrEqual(816);
});
