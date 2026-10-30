import { getFontString, getLineHeight, randomId } from "@fcboard/common";
import { measureText } from "@fcboard/element/textMeasurements";

import type { FcboardElementSkeleton } from "@fcboard/element/transform";

import type { InsertionTextRun } from "./insertObjects";

/** HNodeObject/HAlphabetObject concatenate colored words into one layout.
 * Editable scene text has one color, so keep its measured line fragments and their source order. */
export const insertionLabelParts = (
  shape: FcboardElementSkeleton,
  runs?: readonly InsertionTextRun[],
): FcboardElementSkeleton[] => {
  if (shape.type !== "text" || !runs?.length) {
    return [shape];
  }
  const parts = runs.map((run) => ({ ...run, text: run.text }));
  const source = parts
    .map((run) => run.text)
    .join("")
    .trim()
    .replace(/\s+/g, " ");
  if (source !== shape.originalText || !source) {
    return [shape];
  }
  if (parts.every((part) => part.color === parts[0].color)) {
    return [{ ...shape, strokeColor: parts[0].color }];
  }
  const colors: string[] = [];
  let previousSpace = true;
  for (const part of parts) {
    for (let index = 0; index < part.text.length; index++) {
      const character = part.text[index];
      const space = /\s/.test(character);
      if (!space || !previousSpace) {
        colors.push(part.color);
      }
      previousSpace = space;
    }
  }
  const fontSize = shape.fontSize || 20;
  const fontFamily = shape.fontFamily || 2;
  const lineHeight = shape.lineHeight || getLineHeight(fontFamily);
  const font = getFontString({ fontSize, fontFamily });
  const result: FcboardElementSkeleton[] = [];
  let cursor = 0;
  for (const [row, line] of shape.text.split("\n").entries()) {
    let column = 0;
    const before = cursor;
    while (source[cursor] === " " && line[0] !== " ") {
      cursor++;
    }
    let pending = source.slice(before, cursor);
    while (column < line.length) {
      let end = column + 1;
      const color = colors[cursor] || shape.strokeColor || "#333333";
      while (end < line.length && colors[cursor + end - column] === color) {
        end++;
      }
      const text = line.slice(column, end);
      const metrics = measureText(text, font, lineHeight);
      result.push({
        ...shape,
        id: `${shape.id || randomId()}-run-${result.length}`,
        x:
          (shape.x || 0) +
          (column
            ? measureText(line.slice(0, column), font, lineHeight).width
            : 0),
        y: (shape.y || 0) + row * fontSize * lineHeight,
        width: metrics.width,
        height: metrics.height,
        text,
        originalText: text,
        strokeColor: color,
        customData: {
          ...shape.customData,
          fcInsertion: {
            ...shape.customData?.fcInsertion,
            labelPart: result.length,
            labelText: pending + source.slice(cursor, cursor + text.length),
          },
        },
      });
      pending = "";
      cursor += text.length;
      column = end;
    }
  }
  return result;
};
