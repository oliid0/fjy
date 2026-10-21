import { eraseStroke } from "@excalidraw/excalidraw/eraser/stroke";

import { handwritingElements, handwritingText } from "./handwriting";

const write = (text: string) =>
  handwritingElements(text, {
    x: 100,
    y: 100,
    height: 60,
    color: "#ff0000",
    width: 3,
    opacity: 100,
    maxWidth: 500,
  })!;

it("writes the numeric answer as real editable ink and preserves its style and semantic text", () => {
  const ink = write("64");
  expect(ink.length).toBeGreaterThan(1);
  expect(
    ink.every(
      (element) =>
        element.type === "freedraw" &&
        element.strokeColor === "#ff0000" &&
        element.strokeWidth === 3,
    ),
  ).toBe(true);
  expect(new Set(ink.map((element) => element.groupIds[0])).size).toBe(1);
  expect(handwritingText(ink)).toEqual(["64"]);
  expect(
    handwritingText(ink.map((element) => ({ ...element, x: element.x + 300 }))),
  ).toEqual(["64"]);
});

it("partially erases an answer instead of deleting it and stops reporting stale text", () => {
  const original = write("2")[0];
  const point = original.points[Math.floor(original.points.length / 2)];
  const center = { x: original.x + point[0], y: original.y + point[1] };
  const cut = eraseStroke(original, center, center, 8, 10)!;
  expect(cut).not.toBeNull();
  expect(cut.length).toBeGreaterThan(0);
  expect(handwritingText(cut)).toEqual([]);
  expect(handwritingText([original])).toEqual(["2"]);
});

it("wraps long answers and falls back to editable handwriting fonts for unsupported characters", () => {
  const ink = handwritingElements("1234567890", {
    x: 0,
    y: 0,
    height: 24,
    color: "#000",
    width: 2,
    opacity: 100,
    maxWidth: 60,
  })!;
  expect(Math.max(...ink.map((element) => element.y))).toBeGreaterThan(30);
  expect(
    handwritingElements("牛顿定律", {
      x: 0,
      y: 0,
      height: 24,
      color: "#000",
      width: 2,
      opacity: 100,
      maxWidth: 500,
    }),
  ).toBeNull();
});
