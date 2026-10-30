import { convertToFcboardElements } from "@fcboard/fcboard";
import { duplicateElement } from "@fcboard/element/duplicate";

import {
  boardWritingParts,
  documentWritingParts,
  insertionWritingAt,
  insertionWritingTargets,
  insertionWritingText,
  insertionWritingTextIds,
} from "./insertionWriting";
import {
  insertionDefaults,
  insertionShapes,
  readInsertions,
  renderInsertion,
} from "./insertObjects";
import { shapeInk } from "./documents";
import { sceneAPI } from "./test/scene";

it("starts with the factory root and three empty child writing surfaces", async () => {
  const api = sceneAPI();
  await renderInsertion(api, insertionDefaults("mindmap", { x: 100, y: 100 }));
  const parts = boardWritingParts(api.getSceneElements());
  const targets = insertionWritingTargets(parts);
  expect(targets.map((target) => target.index)).toEqual([0, 1, 2, 3]);
  expect(targets.every((target) => !target.text)).toBe(true);
  expect(
    api.getSceneElements().filter((item) => item.type === "line"),
  ).toHaveLength(3);
});

it.each(["fourline", "mindmap"] as const)(
  "uses the moved, resized %s surface for hit testing and editable text layout",
  async (kind) => {
    const api = sceneAPI();
    await renderInsertion(api, insertionDefaults(kind, { x: 100, y: 100 }));
    const body = api
      .getSceneElements()
      .find((item) => item.type === "rectangle")!;
    const moved = {
      ...body,
      x: 400,
      y: 180,
      width: 280,
      height: 100,
      angle: (Math.PI / 2) as typeof body.angle,
    };
    const targets = insertionWritingTargets(boardWritingParts([moved]));
    const target = insertionWritingAt(targets, [540, 230])!;
    expect(target).toBeTruthy();
    expect(insertionWritingAt(targets, [405, 185])).toBeUndefined();
    const text = insertionWritingText(
      target,
      "Writing in the visible object",
      "#e03131",
      ["ink"],
    );
    expect(text?.type).toBe("text");
    if (text?.type !== "text") {
      throw new Error("Text did not fit");
    }
    expect(text.angle).toBe(moved.angle);
    expect(text.strokeColor).toBe("#e03131");
    expect(text.customData?.fcInsertion.textIndex).toBe(target.index);
    expect(text.groupIds).toEqual(body.groupIds);
    const elements = convertToFcboardElements([text], {
      regenerateIds: false,
    });
    const combined = boardWritingParts([moved, ...elements]);
    const next = insertionWritingTargets(combined)[0];
    expect(next.text).toBe("Writing in the visible object");
    expect(next.stamp).not.toBe(target.stamp);
    expect(insertionWritingTextIds(next, combined)).toEqual([text.id]);
  },
);

it("uses the same targets and keeps handwriting text and color after JSON persistence and rerender", async () => {
  const api = sceneAPI();
  await renderInsertion(api, insertionDefaults("fourline", { x: 100, y: 100 }));
  const original = api
    .getSceneElements()
    .filter((item) => item.customData?.fcInsertion);
  const board = insertionWritingTargets(boardWritingParts(original))[0];
  const document = insertionWritingTargets(
    documentWritingParts(
      original.flatMap((shape) =>
        shape.type === "rectangle"
          ? [
              shapeInk(
                {
                  type: "rectangle",
                  id: shape.id,
                  x: shape.x,
                  y: shape.y,
                  width: shape.width,
                  height: shape.height,
                  customData: shape.customData,
                },
                "insertion",
              ),
            ]
          : [],
      ),
    ),
  )[0];
  expect([document.x, document.y, document.width, document.height]).toEqual([
    board.x,
    board.y,
    board.width,
    board.height,
  ]);
  const text = insertionWritingText(board, "Hello world", "#e03131", ["ink"])!;
  api.updateScene({
    elements: [...original, ...convertToFcboardElements([text])],
  });
  const value = JSON.parse(JSON.stringify(readInsertions(api)[0]));
  expect(value.text).toBe("Hello world");
  expect(value.textColors).toEqual(["#e03131"]);
  const shapes = insertionShapes(value);
  expect(shapes.find((shape) => shape.type === "text")?.strokeColor).toBe(
    "#e03131",
  );
});

it("appends recognized words without turning wrapped node text into extra nodes", async () => {
  const api = sceneAPI();
  await renderInsertion(api, insertionDefaults("mindmap", { x: 100, y: 100 }));
  const all = api.getSceneElements();
  const target = insertionWritingTargets(boardWritingParts(all))[2];
  const label = insertionWritingText(target, "Newton's second law", "#e03131", [
    "first",
  ])!;
  expect(label.type === "text" && label.text).toContain("\n");
  api.updateScene({
    elements: [...all, ...convertToFcboardElements([label])],
  });
  const current = insertionWritingTargets(
    boardWritingParts(api.getSceneElements()),
  ).find((item) => item.key === target.key)!;
  const next = insertionWritingText(current, "F = ma", "#e03131", ["second"])!;
  expect(next.type === "text" && next.originalText).toContain("law F = ma");
  const saved = readInsertions(api)[0];
  expect(saved.outline.split("\n")).toHaveLength(4);
  expect(
    insertionShapes(JSON.parse(JSON.stringify(saved))).filter(
      (shape) => shape.type === "rectangle",
    ),
  ).toHaveLength(4);
  expect(insertionWritingText(target, "", "#000", [])).toBeUndefined();
  expect(
    insertionWritingText(target, "a".repeat(4001), "#000", []),
  ).toBeUndefined();
});

it("keeps copied writing surfaces and their text owned by the copied group", async () => {
  const api = sceneAPI();
  await renderInsertion(api, {
    ...insertionDefaults("fourline", { x: 100, y: 100 }),
    text: "Hello",
  });
  const original = api
    .getSceneElements()
    .filter((item) => item.customData?.fcInsertion);
  const groups = new Map();
  const copied = original.map((item) => ({
    ...duplicateElement(null, groups, item),
    x: item.x + 400,
  }));
  api.updateScene({ elements: [...original, ...copied] });
  const parts = boardWritingParts(api.getSceneElements());
  const [first, second] = insertionWritingTargets(parts);
  expect(first.insertion.id).not.toBe(second.insertion.id);
  expect(second.groupIds[0]).toBe(second.insertion.id);
  expect(insertionWritingTextIds(second, parts)).toEqual(
    copied.filter((item) => item.type === "text").map((item) => item.id),
  );
  expect(
    insertionWritingTextIds(second, parts).some((id) =>
      original.some((item) => item.id === id),
    ),
  ).toBe(false);
  expect(readInsertions(api)).toHaveLength(2);
  expect(original[0].customData?.fcInsertion.id).toBe(first.insertion.id);
});
