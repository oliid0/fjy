import { getLineHeight } from "@fcboard/common";

import type { FcboardElementSkeleton } from "@fcboard/element/transform";

import { insertionLabelParts } from "./insertionLabels";

const shape = (text: string, originalText = text): FcboardElementSkeleton => ({
  type: "text",
  id: "label",
  text,
  originalText,
  x: 100,
  y: 200,
  fontSize: 20,
  fontFamily: 2,
  lineHeight: getLineHeight(2),
});

it("keeps every colored fragment editable with a unique ID and joins wrapped words without introducing spaces inside them", () => {
  const parts = insertionLabelParts(shape("Unbro\nken word", "Unbroken word"), [
    { text: "Unbroken", color: "#ff0000" },
    { text: " word", color: "#0000ff" },
  ]);
  expect(parts).toHaveLength(3);
  expect(parts.map((part) => part.type === "text" && part.text)).toEqual([
    "Unbro",
    "ken",
    " word",
  ]);
  expect(new Set(parts.map((part) => part.id)).size).toBe(3);
  expect(
    parts.map((part) => part.customData?.fcInsertion.labelText).join(""),
  ).toBe("Unbroken word");
  expect(parts[0].x).toBe(100);
  expect(parts[1].y).toBe(223);
  expect(parts[2].strokeColor).toBe("#0000ff");
});

it("preserves emoji and repeated-space color boundaries in UTF-16 editor offsets", () => {
  const parts = insertionLabelParts(shape("A😀B blue"), [
    { text: " A😀B  ", color: "#ff0000" },
    { text: "blue", color: "#0000ff" },
  ]);
  expect(parts.map((part) => part.type === "text" && part.text)).toEqual([
    "A😀B ",
    "blue",
  ]);
  expect(parts.map((part) => part.strokeColor)).toEqual(["#ff0000", "#0000ff"]);
  expect(
    parts.map((part) => part.customData?.fcInsertion.labelText).join(""),
  ).toBe("A😀B blue");
});

it("keeps one text object for a single color and rejects stale rich labels after an explicit text edit", () => {
  const original = shape("Edited");
  expect(
    insertionLabelParts(original, [{ text: "Old", color: "#ff0000" }]),
  ).toEqual([original]);
  expect(
    insertionLabelParts(original, [{ text: "Edited", color: "#ff0000" }]),
  ).toEqual([{ ...original, strokeColor: "#ff0000" }]);
});
