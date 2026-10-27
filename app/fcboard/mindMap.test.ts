import { changeMindMapNode } from "./mindMap";
import {
  configureInsertion,
  insertionDefaults,
  insertionShapes,
  mindMapNodes,
  readInsertions,
  renderInsertion,
} from "./insertObjects";
import { sceneAPI } from "./test/scene";

it("adds a child after its parent's branch and preserves node positions and colors", () => {
  const original = configureInsertion(
    insertionDefaults("mindmap", { x: 100, y: 100 }),
    {
      outline: "Root\n  A\n    Leaf\n  B",
      textColors: ["red", "green", "blue", "white"],
    },
  );
  const next = changeMindMapNode(original, 1, "add")!;
  expect(next.outline.split("\n")).toEqual([
    "Root",
    "  A",
    "    Leaf",
    "    ",
    "  B",
  ]);
  expect(next.textColors).toEqual(["red", "green", "blue", "", "white"]);
  expect(mindMapNodes(next).map((node) => node.parent)).toEqual([
    -1, 0, 1, 1, 0,
  ]);
  expect(next.nodePositions?.[4]).toEqual(
    expect.objectContaining({
      x: mindMapNodes(original)[3].x,
      y: mindMapNodes(original)[3].y,
    }),
  );
});

it("deletes a node's descendants, clears only its own text, and deletes the whole map for the root", () => {
  const original = configureInsertion(
    insertionDefaults("mindmap", { x: 0, y: 0 }),
    { outline: "Root\n  A\n    Leaf\n  B" },
  );
  expect(changeMindMapNode(original, 1, "delete")?.outline).toBe("Root\n  B");
  expect(changeMindMapNode(original, 1, "clear")?.outline).toBe(
    "Root\n  \n    Leaf\n  B",
  );
  expect(changeMindMapNode(original, 0, "delete")).toBeUndefined();
});

it("moves one node and its connector, persists the actual geometry and preserves neighboring nodes", async () => {
  const api = sceneAPI();
  await renderInsertion(api, insertionDefaults("mindmap", { x: 100, y: 100 }));
  const original = readInsertions(api)[0];
  const nodes = mindMapNodes(original);
  const next = changeMindMapNode(original, 1, "move", {
    x: nodes[1].x + 50,
    y: nodes[1].y + 30,
  })!;
  const shapes = insertionShapes(next);
  expect(
    shapes.find(
      (shape) => shape.type === "rectangle" && shape.insertionText === 1,
    ),
  ).toMatchObject({ x: nodes[1].x + 50, y: nodes[1].y + 30 });
  expect(
    shapes.find(
      (shape) => shape.type === "rectangle" && shape.insertionText === 2,
    ),
  ).toMatchObject({ x: nodes[2].x, y: nodes[2].y });
  const link = shapes.find((shape) => shape.type === "line")!;
  expect(link.type === "line" && link.points?.at(-1)).toEqual([100, -46]);
  await renderInsertion(api, JSON.parse(JSON.stringify(next)));
  expect(readInsertions(api)[0].nodePositions).toEqual(next.nodePositions);
});
