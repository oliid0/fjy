import { getCommonBounds, newFreeDrawElement } from "@fcboard/element";
import { pointFrom } from "@fcboard/math";

import {
  insertionDefaults,
  readInsertions,
  renderInsertion,
} from "./insertObjects";
import {
  growBoardTableWriting,
  growDocumentTableWriting,
  shrinkBoardErasure,
  shrinkDocumentErasure,
} from "./insertionWritingTables";
import { shapeInk } from "./documents";
import { classroomCommands } from "./commands";
import { sceneAPI } from "./test/scene";

const ink = (x: number, y: number, dx: number, dy: number) =>
  newFreeDrawElement({
    type: "freedraw",
    x,
    y,
    points: [pointFrom(0, 0), pointFrom(dx, dy)],
    simulatePressure: true,
    customData: { fcInk: { version: 2, pen: "hard" } },
  });

it("keeps the grid and other cells stationary for handwriting inside the cell, including its inner margin", async () => {
  const api = sceneAPI();
  await renderInsertion(
    api,
    insertionDefaults("table", { x: 100, y: 100 }),
    true,
    { exact: true },
  );
  const original = api.getSceneElements();
  const writing = ink(102, 102, 116, 56);
  const scene = growBoardTableWriting([...original, writing]);
  for (const element of original) {
    expect(scene.find((item) => item.id === element.id)).toBe(element);
  }
  api.updateScene({ elements: scene });
  const table = readInsertions(api)[0];
  expect(table.position).toEqual({ x: 100, y: 100 });
  expect(table.width).toBe(360);
  expect(table.height).toBe(180);
  expect(
    scene.find((item) => item.id === writing.id)?.customData?.fcInsertion
      .inkCell,
  ).toBe(0);
  let document: ReturnType<typeof shapeInk>[] = [];
  const stop = classroomCommands.register(
    "document.insertion",
    "@internal",
    ({ shapes }) => {
      document = (shapes as Parameters<typeof shapeInk>[0][]).map((shape) =>
        shapeInk(shape, "insertion"),
      );
    },
  );
  try {
    await renderInsertion(api, table, true, { exact: true });
  } finally {
    stop();
  }
  expect(document.length).toBeGreaterThan(0);
  const next = growDocumentTableWriting([...document, shapeInk(writing, "")]);
  for (const stroke of document) {
    expect(next.find((item) => item.id === stroke.id)).toBe(stroke);
  }
  expect(next.find((item) => item.id === writing.id)?.insertion?.inkCell).toBe(
    0,
  );
});

it("grows only the contacted column and row, retains raw ink and moves later cells", async () => {
  const api = sceneAPI();
  await renderInsertion(api, insertionDefaults("table", { x: 100, y: 100 }));
  const neighbor = ink(245, 185, 20, 10);
  let scene = growBoardTableWriting([...api.getSceneElements(), neighbor]);
  const writing = ink(210, 150, 40, 20);
  scene = growBoardTableWriting([...scene, writing]);
  const kept = scene.find((element) => element.id === writing.id)!;
  expect(kept.type).toBe("freedraw");
  expect(getCommonBounds([kept])).toEqual(getCommonBounds([writing]));
  const shifted = scene.find((element) => element.id === neighbor.id)!;
  expect(shifted.x).toBe(295);
  expect(shifted.y).toBe(215);
  expect(kept.customData?.fcInsertion.inkCell).toBe(0);
  expect(shifted.customData?.fcInsertion.inkCell).toBe(4);
  expect(kept.groupIds).toEqual(shifted.groupIds);
  api.updateScene({ elements: scene });
  const table = readInsertions(api)[0];
  expect(table.columnWidths).toEqual([170, 120, 120]);
  expect(table.rowHeights).toEqual([90, 60, 60]);
  expect(table.width).toBe(410);
  expect(table.height).toBe(210);
  await renderInsertion(api, JSON.parse(JSON.stringify(table)));
  expect(
    api.getSceneElements().some((element) => element.id === writing.id),
  ).toBe(true);
  expect(
    api.getSceneElements().some((element) => element.id === neighbor.id),
  ).toBe(true);
  expect(growBoardTableWriting(api.getSceneElements())).toBe(
    api.getSceneElements(),
  );
});

it("grows upwards and leftwards without moving the contacted cell's handwriting", async () => {
  const api = sceneAPI();
  await renderInsertion(api, insertionDefaults("table", { x: 100, y: 100 }));
  const preceding = ink(125, 125, 20, 10);
  const attached = growBoardTableWriting([
    ...api.getSceneElements(),
    preceding,
  ]);
  const writing = ink(245, 185, -55, -40);
  const scene = growBoardTableWriting([...attached, writing]);
  const moved = scene.find((element) => element.id === preceding.id)!;
  expect(moved.x).toBe(75);
  expect(moved.y).toBe(90);
  expect(
    getCommonBounds([scene.find((element) => element.id === writing.id)!]),
  ).toEqual(getCommonBounds([writing]));
  api.updateScene({ elements: scene });
  expect(readInsertions(api)[0].position).toEqual({ x: 50, y: 65 });
  expect(readInsertions(api)[0].columnWidths).toEqual([120, 170, 120]);
  expect(readInsertions(api)[0].rowHeights).toEqual([60, 95, 60]);
});

it("uses the same cell expansion and raw trajectories on the document layer", async () => {
  const api = sceneAPI();
  await renderInsertion(api, insertionDefaults("table", { x: 100, y: 100 }));
  const shapes = api
    .getSceneElements()
    .filter((element) => element.customData?.fcInsertion);
  const strokes = shapes.flatMap((element) =>
    element.type === "rectangle" ||
    element.type === "line" ||
    element.type === "text"
      ? [shapeInk({ ...element, index: undefined }, "insertion")]
      : [],
  );
  const neighbor = shapeInk(ink(245, 185, 20, 10), "");
  const attached = growDocumentTableWriting([...strokes, neighbor]);
  const writing = shapeInk(ink(210, 150, 40, 20), "");
  const next = growDocumentTableWriting([...attached, writing]);
  expect(next.find((stroke) => stroke.id === writing.id)?.points).toEqual(
    writing.points,
  );
  expect(next.find((stroke) => stroke.id === neighbor.id)?.points).toEqual([
    [295, 215],
    [315, 225],
  ]);
  expect(
    next.find((stroke) => stroke.id === writing.id)?.insertion?.columnWidths,
  ).toEqual([170, 120, 120]);
  expect(next.some((stroke) => stroke.text)).toBe(false);
  expect(growDocumentTableWriting(next)).toBe(next);
});

it("does not attach old writing or a stroke that starts outside the table", async () => {
  const api = sceneAPI();
  await renderInsertion(api, insertionDefaults("table", { x: 100, y: 100 }));
  const old = ink(125, 125, 100, 100);
  const outside = ink(90, 90, 200, 100);
  const scene = [...api.getSceneElements(), old, outside];
  expect(growBoardTableWriting(scene, new Set([outside.id]))).toBe(scene);
});

it("expands a document table containing a long completed trajectory without treating its samples as table boundaries", async () => {
  const api = sceneAPI();
  await renderInsertion(api, insertionDefaults("table", { x: 100, y: 100 }));
  const shapes = api
    .getSceneElements()
    .flatMap((element) =>
      element.type === "rectangle" ||
      element.type === "line" ||
      element.type === "text"
        ? [shapeInk(element, "insertion")]
        : [],
    );
  const attached = growDocumentTableWriting([
    ...shapes,
    shapeInk(ink(245, 185, 20, 10), ""),
  ]);
  const neighbor = attached.find((stroke) => stroke.insertion?.inkCell === 4)!;
  const points = Array.from(
    { length: 150000 },
    (_, index): [number, number] => [245 + (index % 20), 185 + (index % 10)],
  );
  const writing = shapeInk(ink(210, 150, 40, 20), "");
  const next = growDocumentTableWriting(
    [
      ...attached.filter((stroke) => stroke.id !== neighbor.id),
      { ...neighbor, points },
      writing,
    ],
    new Set([writing.id]),
  );
  const moved = next.find((stroke) => stroke.id === neighbor.id)!;
  expect(moved.points).toHaveLength(150000);
  expect(moved.points.at(-1)).toEqual([314, 224]);
  expect(moved.insertion?.columnWidths).toEqual([170, 120, 120]);
  expect(next.find((stroke) => stroke.id === writing.id)?.points).toEqual(
    writing.points,
  );
});

it("leaves a continuous stroke crossing several rows/columns and the entire grid unchanged", async () => {
  const api = sceneAPI();
  await renderInsertion(
    api,
    insertionDefaults("table", { x: 100, y: 100 }),
    true,
    { exact: true },
  );
  const original = api.getSceneElements();
  const writing = ink(125, 125, 225, 90);
  const scene = [...original, writing];
  expect(growBoardTableWriting(scene)).toBe(scene);
  expect(writing.customData?.fcInsertion).toBeUndefined();
});
it("shrinks to remaining cell contents after erasure and restores empty tracks to their original sizes", async () => {
  const api = sceneAPI();
  await renderInsertion(
    api,
    insertionDefaults("table", { x: 100, y: 100 }),
    true,
    { exact: true },
  );
  const retained = ink(125, 125, 20, 15);
  const large = ink(210, 150, 40, 20);
  const expanded = growBoardTableWriting([
    ...api.getSceneElements(),
    retained,
    large,
  ]);
  const tableId = expanded.find((e) => e.customData?.fcInsertion)?.customData!
    .fcInsertion.id as string;
  const erased = expanded.filter((e) => e.id !== large.id);
  const contracted = shrinkBoardErasure(expanded, erased);
  api.updateScene({ elements: contracted });
  expect(readInsertions(api)[0]).toMatchObject({
    width: 360,
    height: 180,
    columnWidths: [120, 120, 120],
    rowHeights: [60, 60, 60],
  });
  expect(contracted.some((e) => e.id === retained.id)).toBe(true);
  const empty = shrinkBoardErasure(
    expanded,
    expanded.filter((e) => e.id !== large.id && e.id !== retained.id),
  );
  api.updateScene({ elements: empty });
  expect(readInsertions(api)[0]).toMatchObject({ width: 360, height: 180 });
  const before = expanded.flatMap((e) =>
    e.type === "rectangle" ||
    e.type === "line" ||
    e.type === "text" ||
    e.type === "freedraw"
      ? [shapeInk(e, "insertion")]
      : [],
  );
  const after = before.filter((s) => s.id !== large.id);
  const result = shrinkDocumentErasure(before, after);
  expect(
    result.find((s) => s.insertion?.id === tableId)?.insertion,
  ).toMatchObject({ width: 360, height: 180 });
  expect(result.some((s) => s.id === retained.id)).toBe(true);
});
