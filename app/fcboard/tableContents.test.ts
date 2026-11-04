import { pointFrom } from "@fcboard/math";
import { newFreeDrawElement } from "@fcboard/element";

import type { convertToFcboardElements } from "@fcboard/fcboard";

import type { FcboardElement } from "@fcboard/element/types";

import {
  insertionDefaults,
  renderInsertion,
  readInsertions,
  mindMapNodes,
} from "./insertObjects";
import { changeMindMapNode } from "./mindMap";
import { carryDocumentInsertionContents } from "./tableContents";
import { shapeInk } from "./documents";
import { sceneAPI } from "./test/scene";

it("keeps raw handwriting with the same nodes through child insertion, branch deletion, node movement and clearing", async () => {
  const api = sceneAPI();
  const original = insertionDefaults("mindmap", { x: 100, y: 100 });
  await renderInsertion(api, original, true, { exact: true });
  const object = readInsertions(api)[0];
  const nodes = mindMapNodes(object);
  const raw = (index: number) => {
    const x = object.position.x + nodes[index].x + 20;
    const y = object.position.y + nodes[index].y + 20;
    return newFreeDrawElement({
      type: "freedraw",
      x,
      y,
      points: [pointFrom(0, 0), pointFrom(20, 10)],
      strokeColor: "#123456",
      simulatePressure: true,
      groupIds: [object.id],
      customData: {
        fcInsertion: { ...object, inkCell: index, origin: { x, y } },
      },
    });
  };
  const first = raw(1);
  const third = raw(3);
  api.updateScene({ elements: [...api.getSceneElements(), first, third] });
  await renderInsertion(
    api,
    changeMindMapNode(readInsertions(api)[0], 1, "add")!,
  );
  expect(
    api.getSceneElements().find((element) => element.id === third.id)
      ?.customData?.fcInsertion.inkCell,
  ).toBe(4);
  expect(
    api.getSceneElements().find((element) => element.id === third.id),
  ).toMatchObject({ x: third.x, y: third.y });
  await renderInsertion(
    api,
    changeMindMapNode(readInsertions(api)[0], 1, "delete")!,
  );
  expect(
    api.getSceneElements().some((element) => element.id === first.id),
  ).toBe(false);
  expect(
    api.getSceneElements().find((element) => element.id === third.id)
      ?.customData?.fcInsertion.inkCell,
  ).toBe(2);
  const current = readInsertions(api)[0];
  const node = mindMapNodes(current)[2];
  const moved = changeMindMapNode(current, 2, "move", {
    x: node.x + 50,
    y: node.y + 30,
  })!;
  await renderInsertion(api, moved);
  expect(
    api.getSceneElements().find((element) => element.id === third.id),
  ).toMatchObject({ x: third.x + 50, y: third.y + 30 });
  await renderInsertion(
    api,
    changeMindMapNode(readInsertions(api)[0], 2, "clear")!,
    true,
    { removeIds: [third.id] },
  );
  expect(
    api.getSceneElements().some((element) => element.id === third.id),
  ).toBe(false);
});

it.each(["fourline", "mindmap"] as const)(
  "translates %s raw ink from current geometry once after a prior whole-object move, with the same courseware result",
  async (kind) => {
    const api = sceneAPI();
    await renderInsertion(
      api,
      insertionDefaults(kind, { x: 200, y: 100 }),
      true,
      { exact: true },
    );
    const object = readInsertions(api)[0];
    const index = kind === "mindmap" ? 1 : 0;
    const node =
      kind === "mindmap" ? mindMapNodes(object)[index] : { x: 0, y: 0 };
    const x = object.position.x + node.x + 20;
    const y = object.position.y + node.y + 20;
    const raw = newFreeDrawElement({
      type: "freedraw",
      x,
      y,
      points: [pointFrom(0, 0), pointFrom(30, 10)],
      strokeColor: "#123456",
      simulatePressure: true,
      groupIds: [object.id],
      customData: {
        fcInsertion: { ...object, inkCell: index, origin: { x, y } },
      },
    });
    api.updateScene({
      elements: [...api.getSceneElements(), raw].map((element) => ({
        ...element,
        x: element.x + 100,
        y: element.y + 50,
      })),
    });
    const previous = readInsertions(api)[0];
    const target = {
      ...previous,
      position: { x: previous.position.x + 40, y: previous.position.y + 30 },
    };
    const strokes = api.getSceneElements().map((element: FcboardElement) =>
      shapeInk(
        {
          ...element,
          type: element.type === "freedraw" ? "line" : element.type,
        } as Parameters<typeof convertToFcboardElements>[0][number],
        "insertion",
      ),
    );
    const document = carryDocumentInsertionContents(strokes, target);
    await renderInsertion(api, target);
    const moved = api
      .getSceneElements()
      .find((element) => element.id === raw.id)!;
    expect(moved).toMatchObject({ x: x + 140, y: y + 80 });
    expect(document).toHaveLength(1);
    expect(document[0].points[0]).toEqual([moved.x, moved.y]);
  },
);
