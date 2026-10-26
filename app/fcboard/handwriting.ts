import { t } from "@excalidraw/excalidraw/i18n";
import {
  getCommonBounds,
  hashString,
  newFreeDrawElement,
} from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import type {
  ExcalidrawElement,
  ExcalidrawFreeDrawElement,
} from "@excalidraw/element/types";

import data from "./handwriting/glyphs.json";

type Glyph = { advance: number; strokes: number[][][] };
const glyphs: Record<string, Glyph> = data.glyphs;
const signature = (element: ExcalidrawFreeDrawElement) =>
  hashString(JSON.stringify(element.points));

export const inkLines = (elements: readonly ExcalidrawElement[]) => {
  const rows: { left: number; top: number; right: number; bottom: number }[] =
    [];
  const strokes = elements
    .filter((element) => element.type === "freedraw" && element.points.length)
    .map((element) => ({
      bounds: getCommonBounds([element]),
      gap: Math.max(2, element.strokeWidth * 2),
    }))
    .filter(({ bounds }) => bounds.every(Number.isFinite))
    .sort((a, b) => a.bounds[1] - b.bounds[1]);
  for (const {
    bounds: [left, top, right, bottom],
    gap,
  } of strokes) {
    const previous = rows[rows.length - 1];
    if (previous && top <= previous.bottom + gap) {
      previous.left = Math.min(previous.left, left);
      previous.right = Math.max(previous.right, right);
      previous.bottom = Math.max(previous.bottom, bottom);
    } else {
      rows.push({ left, top, right, bottom });
    }
  }
  return rows;
};

export const inkLineHeight = (
  elements: readonly ExcalidrawElement[],
  unit = 1,
) => {
  const heights = inkLines(elements)
    .map((row) => row.bottom - row.top)
    .filter((height) => height > 0)
    .sort((a, b) => a - b);
  return Math.max(
    2 * unit,
    heights[Math.floor(heights.length / 2)] || 24 * unit,
  );
};

const normalizedHandwriting = (text: string) =>
  text.replace(/−/g, "-").replace(/×/g, "x");
export const supportsHandwriting = (text: string) => {
  const value = normalizedHandwriting(text);
  return (
    value.length <= 1200 &&
    Array.from(value).every(
      (character) => /\s/.test(character) || !!glyphs[character],
    )
  );
};

/** Single-stroke glyphs become ordinary factory ink, including local erasure and editable grouping. */
export const handwritingElements = (
  text: string,
  options: {
    x: number;
    y: number;
    height: number;
    color: string;
    width: number;
    opacity: number;
    maxWidth: number;
    source?: readonly ExcalidrawElement[];
    customData?: Record<string, unknown>;
  },
): ExcalidrawFreeDrawElement[] | null => {
  if (
    ![
      options.x,
      options.y,
      options.height,
      options.width,
      options.maxWidth,
    ].every(Number.isFinite)
  ) {
    throw new Error(
      t("fcboard.invalid_writing_area_circle_an_area_containing_writing_again"),
    );
  }
  const value = normalizedHandwriting(text);
  if (!supportsHandwriting(value)) {
    return null;
  }
  const source = options.source?.find(
    (element): element is ExcalidrawFreeDrawElement =>
      element.type === "freedraw",
  );
  let xy = 0;
  let yy = 0;
  for (const ink of options.source || []) {
    if (ink.type !== "freedraw") {
      continue;
    }
    for (let index = 1; index < ink.points.length; index++) {
      const dx = ink.points[index][0] - ink.points[index - 1][0];
      const dy = ink.points[index][1] - ink.points[index - 1][1];
      if (
        Math.abs(dy) > Math.abs(dx) * 2 &&
        Math.abs(dy) > ink.strokeWidth * 2
      ) {
        xy += dx * dy;
        yy += dy * dy;
      }
    }
  }
  const slant = yy ? Math.max(-0.35, Math.min(0.35, xy / yy)) : 0;
  const scale = Math.max(0.1, options.height) / 21;
  const group = crypto.randomUUID();
  const result: ExcalidrawFreeDrawElement[] = [];
  let x = 0;
  let y = 0;
  for (const character of value) {
    if (character === "\n") {
      x = 0;
      y += 32 * scale;
      continue;
    }
    if (/\s/.test(character)) {
      x += 10 * scale;
      continue;
    }
    const glyph = glyphs[character];
    if (x && x + glyph.advance * scale > options.maxWidth) {
      x = 0;
      y += 32 * scale;
    }
    const originX = x;
    const originY = y;
    for (const stroke of glyph.strokes) {
      if (!stroke.length) {
        continue;
      }
      const nodes = stroke.map(([a, b]) => [
        originX + a * scale + slant * (b - 1) * scale,
        originY + (b - 1) * scale,
      ]);
      const first = nodes[0];
      const pen = source?.customData?.fcInk?.pen || "hard";
      const element = newFreeDrawElement({
        type: "freedraw",
        x: options.x + first[0],
        y: options.y + first[1],
        points: nodes.map(([a, b]) => pointFrom(a - first[0], b - first[1])),
        strokeColor: options.color,
        strokeWidth: options.width,
        opacity: options.opacity,
        strokeStyle: source?.strokeStyle || "solid",
        simulatePressure: true,
        groupIds: [group],
        customData: {
          ...options.customData,
          fcGenerated: true,
          fcWrittenText: text,
          fcWrittenGroup: group,
          fcInk: {
            version: pen === "brush" ? 3 : 2,
            pen,
            unit:
              source?.customData?.fcInk?.unit ||
              1 / (window.devicePixelRatio || 1),
            centerline: pen !== "brush",
            variation: source?.customData?.fcInk?.variation,
            ...(source?.customData?.fcInk?.rainbow
              ? { rainbow: source.customData.fcInk.rainbow }
              : {}),
          },
        },
      });
      element.customData!.fcWrittenHash = signature(element);
      result.push(element);
    }
    x += glyph.advance * scale;
  }
  for (const element of result) {
    element.customData!.fcWrittenCount = result.length;
  }
  return result.length ? result : null;
};

/** Edited or partially erased groups must be re-read visually, not reported as their old text. */
export const handwritingText = (elements: readonly ExcalidrawElement[]) => {
  const groups = new Map<string, ExcalidrawFreeDrawElement[]>();
  for (const element of elements) {
    if (
      !element.isDeleted &&
      element.type === "freedraw" &&
      element.customData?.fcWrittenGroup
    ) {
      const id = String(element.customData.fcWrittenGroup);
      const group = groups.get(id) || [];
      group.push(element);
      groups.set(id, group);
    }
  }
  return Array.from(groups.values()).flatMap((group) => {
    const first = group[0].customData!;
    return group.length === first.fcWrittenCount &&
      group.every(
        (element) => signature(element) === element.customData?.fcWrittenHash,
      )
      ? [String(first.fcWrittenText)]
      : [];
  });
};
