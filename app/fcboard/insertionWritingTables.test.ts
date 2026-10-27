import { getCommonBounds, newFreeDrawElement } from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import {
  insertionDefaults,
  readInsertions,
  renderInsertion,
} from "./insertObjects";
import {
  growBoardTableWriting,
  growDocumentTableWriting,
} from "./insertionWritingTables";
import { shapeInk } from "./documents";
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

it("grows only the contacted column and row, retains raw ink and moves later cells", async () => {
  const api = sceneAPI();
  await renderInsertion(api, insertionDefaults("table", { x: 100, y: 100 }));
  const neighbor = ink(245, 185, 20, 10);
  let scene = growBoardTableWriting([...api.getSceneElements(), neighbor]);
  const writing = ink(125, 125, 225, 90);
  scene = growBoardTableWriting([...scene, writing]);
  const kept = scene.find((element) => element.id === writing.id)!;
  expect(kept.type).toBe("freedraw");
  expect(getCommonBounds([kept])).toEqual(getCommonBounds([writing]));
  const shifted = scene.find((element) => element.id === neighbor.id)!;
  expect(shifted.x).toBe(395);
  expect(shifted.y).toBe(260);
  expect(kept.customData?.fcInsertion.inkCell).toBe(0);
  expect(shifted.customData?.fcInsertion.inkCell).toBe(4);
  expect(kept.groupIds).toEqual(shifted.groupIds);
  api.updateScene({ elements: scene });
  const table = readInsertions(api)[0];
  expect(table.columnWidths).toEqual([270, 120, 120]);
  expect(table.rowHeights).toEqual([135, 60, 60]);
  expect(table.width).toBe(510);
  expect(table.height).toBe(255);
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
  const writing = ink(245, 185, -165, -115);
  const scene = growBoardTableWriting([...attached, writing]);
  const moved = scene.find((element) => element.id === preceding.id)!;
  expect(moved.x).toBe(-35);
  expect(moved.y).toBe(15);
  expect(
    getCommonBounds([scene.find((element) => element.id === writing.id)!]),
  ).toEqual(getCommonBounds([writing]));
  api.updateScene({ elements: scene });
  expect(readInsertions(api)[0].position).toEqual({ x: -60, y: -10 });
  expect(readInsertions(api)[0].columnWidths).toEqual([120, 280, 120]);
  expect(readInsertions(api)[0].rowHeights).toEqual([60, 170, 60]);
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
  const writing = shapeInk(ink(125, 125, 225, 90), "");
  const next = growDocumentTableWriting([...attached, writing]);
  expect(next.find((stroke) => stroke.id === writing.id)?.points).toEqual(
    writing.points,
  );
  expect(next.find((stroke) => stroke.id === neighbor.id)?.points).toEqual([
    [395, 260],
    [415, 270],
  ]);
  expect(
    next.find((stroke) => stroke.id === writing.id)?.insertion?.columnWidths,
  ).toEqual([270, 120, 120]);
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
