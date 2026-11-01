import { convertToFcboardElements } from "@fcboard/fcboard";
import { newFreeDrawElement } from "@fcboard/element";
import { pointFrom } from "@fcboard/math";

import type { FcboardElementSkeleton } from "@fcboard/element/transform";

import { sceneAPI } from "./test/scene";
import { classroomCommands } from "./commands";
import {
  configureInsertion,
  insertionDefaults,
  insertionShapes,
  readInsertions,
  renderInsertion,
} from "./insertObjects";
import { shapeInk } from "./documents";

it("uses HAlphabetObject's native colors, 80px line insets, 50px corners and 4px lines", () => {
  const shapes = insertionShapes({
    ...insertionDefaults("fourline", { x: 0, y: 0 }),
    width: 384,
    height: 216,
    alphabetScale: 1,
  });
  expect(shapes[0]).toMatchObject({
    backgroundColor: "#0ed49f",
    width: 384,
    height: 216,
    roundness: { type: 3, value: 50 },
  });
  const lines = shapes.filter((shape) => shape.type === "line");
  expect(lines).toHaveLength(4);
  expect(lines.map((shape) => shape.y)).toEqual([43.2, 86.4, 129.6, 172.8]);
  expect(lines[0]).toMatchObject({
    x: 80,
    strokeWidth: 4,
    strokeColor: "#8aedd2",
    opacity: (200 / 255) * 100,
  });
  if (lines[0].type === "line") {
    expect(lines[0].points).toEqual([
      [0, 0],
      [224, 0],
    ]);
  }
});

it("grows four-line paper for a word without shrinking its handwriting and removes source ink atomically", async () => {
  const api = sceneAPI();
  const paper = {
    ...insertionDefaults("fourline", { x: 300, y: 200 }),
    width: 72,
    height: 144,
    alphabetScale: 1 / 3,
  };
  await renderInsertion(api, paper, true, { exact: true });
  const ink = newFreeDrawElement({
    type: "freedraw",
    x: 320,
    y: 230,
    points: [pointFrom(0, 0), pointFrom(20, 30)],
    simulatePressure: true,
  });
  api.updateScene({ elements: [...api.getSceneElements(), ink] });
  await renderInsertion(api, { ...paper, text: "Hello world" }, true, {
    select: false,
    removeIds: [ink.id],
  });
  expect(api.getSceneElements().some((element) => element.id === ink.id)).toBe(
    false,
  );
  const body = api
    .getSceneElements()
    .find(
      (element) =>
        element.customData?.fcInsertion?.id === paper.id &&
        element.type === "rectangle",
    )!;
  const word = api
    .getSceneElements()
    .find(
      (element) =>
        element.customData?.fcInsertion?.id === paper.id &&
        element.type === "text",
    )!;
  expect(word.type === "text" && word.text).toBe("Hello world");
  expect(body.width).toBeGreaterThan(paper.width);
  expect(word.height).toBeCloseTo(paper.height * 0.66);
  expect(word.x).toBeCloseTo(body.x + 80 / 3);
  expect(body.width).toBeCloseTo(320 / 3 + word.width);
  await renderInsertion(api, { ...readInsertions(api)[0], text: "" }, true, {
    select: false,
  });
  expect(readInsertions(api)[0].width).toBe(paper.width);
});

it("keeps edited table cells in their row when adding a column and uses one scene update", async () => {
  const api = sceneAPI();
  const object = configureInsertion(
    insertionDefaults("table", { x: 100, y: 100 }),
    { cells: ["姓名", "成绩", "备注", "小明", "95"] },
  );
  await renderInsertion(api, object);
  api.updateScene({
    elements: api
      .getSceneElements()
      .map((element) =>
        element.type === "text" && element.text === "95"
          ? { ...element, text: "96", originalText: "96" }
          : element,
      ),
  });
  const read = readInsertions(api)[0];
  expect(read.cells[4]).toBe("96");
  vi.mocked(api.updateScene).mockClear();
  await renderInsertion(api, configureInsertion(read, { columns: 4 }));
  expect(api.updateScene).toHaveBeenCalledTimes(1);
  const next = readInsertions(api)[0];
  expect(next.cells[4]).toBe("小明");
  expect(next.cells[5]).toBe("96");
  expect(
    api
      .getSceneElements()
      .filter(
        (element) => element.type === "text" && element.text === "学生的题目",
      ),
  ).toHaveLength(1);
});

it("makes a nested mind map with editable labels and preserves a label edit", async () => {
  const api = sceneAPI();
  const object = configureInsertion(
    insertionDefaults("mindmap", { x: 0, y: 0 }),
    { outline: "牛顿定律\n  第一定律\n    惯性\n  第二定律\n    F=ma" },
  );
  await renderInsertion(api, object);
  expect(
    api.getSceneElements().filter((element) => element.type === "rectangle"),
  ).toHaveLength(5);
  expect(
    api.getSceneElements().filter((element) => element.type === "line"),
  ).toHaveLength(4);
  api.updateScene({
    elements: api
      .getSceneElements()
      .map((element) =>
        element.type === "text" && element.text === "惯性"
          ? { ...element, text: "惯性与质量", originalText: "惯性与质量" }
          : element,
      ),
  });
  expect(readInsertions(api)[0].outline).toContain("    惯性与质量");
  expect(
    api
      .getSceneElements()
      .filter((element) => element.customData?.fcInsertion)
      .every((element) => element.groupIds.includes(object.id)),
  ).toBe(true);
});

it("inserts all courseware parts atomically and can read the same object from annotation metadata", async () => {
  const api = sceneAPI();
  let strokes: ReturnType<typeof shapeInk>[] = [];
  const save = vi.fn((args) => {
    strokes = (args.shapes as FcboardElementSkeleton[]).map((shape) =>
      shapeInk(shape, "insertion"),
    );
  });
  const stop = classroomCommands.register(
    "document.insertion",
    "@internal",
    save,
  );
  const context = classroomCommands.context("document", () => ({
    ink: strokes,
  }));
  try {
    const object = insertionDefaults("fourline", { x: 60, y: 80 });
    await renderInsertion(api, object);
    expect(save).toHaveBeenCalledTimes(1);
    expect(strokes).toHaveLength(5);
    expect(readInsertions(api)[0].id).toBe(object.id);
    expect(readInsertions(api)[0].position).toEqual({ x: 60, y: 80 });
    expect(api.getSceneElements()).toHaveLength(1);
  } finally {
    stop();
    context();
  }
});

it("validates an entire request before generating any object", () => {
  const object = insertionDefaults("table", { x: 0, y: 0 });
  expect(() => configureInsertion(object, { rows: 1.5 })).toThrow();
  expect(() => configureInsertion(object, { cells: [null] })).toThrow();
  expect(() => configureInsertion(object, { width: Infinity })).toThrow();
  expect(() => configureInsertion(object, { outline: " " })).toThrow();
  const roundtrip = convertToFcboardElements(insertionShapes(object));
  expect(roundtrip.filter((element) => element.type === "line")).toHaveLength(
    4,
  );
});
