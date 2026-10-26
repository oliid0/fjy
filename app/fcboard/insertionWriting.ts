import { randomId } from "@excalidraw/common";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawElementSkeleton } from "@excalidraw/element/transform";

import { layoutBoardText } from "./textLayout";

import type { InkStroke } from "./documents";

type Insertion = NonNullable<InkStroke["insertion"]>;
type WritingPart = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  rectangle: boolean;
  text?: string;
  insertion: Insertion;
  groupIds: readonly string[];
};
export type InsertionWritingTarget = WritingPart & {
  key: string;
  stamp: string;
  index: number;
};

export const boardWritingParts = (
  elements: readonly ExcalidrawElement[],
): WritingPart[] =>
  elements.flatMap((element) => {
    const insertion = element.customData?.fcInsertion as Insertion | undefined;
    return !element.isDeleted &&
      insertion &&
      (element.type === "rectangle" || element.type === "text")
      ? [
          {
            id: element.id,
            x: element.x,
            y: element.y,
            width: element.width,
            height: element.height,
            angle: element.angle,
            rectangle: element.type === "rectangle",
            text:
              element.type === "text"
                ? element.originalText || element.text
                : undefined,
            insertion,
            groupIds: element.groupIds,
          },
        ]
      : [];
  });

export const documentWritingParts = (
  strokes: readonly InkStroke[],
): WritingPart[] =>
  strokes.flatMap((stroke) => {
    if (!stroke.insertion) {
      return [];
    }
    const xs = stroke.points.map(([x]) => x);
    const ys = stroke.points.map(([, y]) => y);
    return [
      {
        id: stroke.id,
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
        angle: 0,
        rectangle: !stroke.text && stroke.points.length === 5,
        text: stroke.originalText || stroke.text,
        insertion: stroke.insertion,
        groupIds: [stroke.insertion.id],
      },
    ];
  });

const ownsText = (
  target: Pick<InsertionWritingTarget, "insertion" | "index">,
  part: WritingPart,
) =>
  part.text !== undefined &&
  part.insertion.id === target.insertion.id &&
  part.insertion.textIndex === target.index;

export const insertionWritingTargets = (
  parts: readonly WritingPart[],
): InsertionWritingTarget[] =>
  parts.flatMap((part) => {
    if (
      !part.rectangle ||
      !["mindmap", "fourline"].includes(part.insertion.kind) ||
      !Number.isInteger(part.insertion.textIndex) ||
      part.width <= 0 ||
      part.height <= 0
    ) {
      return [];
    }
    const index = part.insertion.textIndex!;
    const text = parts
      .filter((item) => ownsText({ insertion: part.insertion, index }, item))
      .map((item) => item.text)
      .join(" ");
    return [
      {
        ...part,
        text,
        index,
        key: `${part.insertion.id}:${index}`,
        stamp: JSON.stringify([
          part.id,
          part.x,
          part.y,
          part.width,
          part.height,
          part.angle,
          text,
        ]),
      },
    ];
  });

/** HTool attaches ink by its initial contact, rather than by a loose stroke bounding box. */
export const insertionWritingAt = (
  targets: readonly InsertionWritingTarget[],
  point?: readonly number[],
) =>
  point &&
  [...targets].reverse().find((target) => {
    const cx = target.x + target.width / 2;
    const cy = target.y + target.height / 2;
    const dx = point[0] - cx;
    const dy = point[1] - cy;
    const x = cx + dx * Math.cos(target.angle) + dy * Math.sin(target.angle);
    const y = cy - dx * Math.sin(target.angle) + dy * Math.cos(target.angle);
    return (
      x >= target.x &&
      x <= target.x + target.width &&
      y >= target.y &&
      y <= target.y + target.height
    );
  });

export const insertionWritingTextIds = (
  target: InsertionWritingTarget,
  parts: readonly WritingPart[],
) => parts.filter((part) => ownsText(target, part)).map((part) => part.id);

/** Return one editable text object within the actual, possibly resized/rotated writing surface. */
export const insertionWritingText = (
  target: InsertionWritingTarget,
  input: string,
  color: string,
  sourceIds: string[],
): ExcalidrawElementSkeleton | undefined => {
  const text = [target.text?.trim(), input.trim()]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");
  if (!input.trim() || text.length > 4000) {
    return;
  }
  const alphabet = target.insertion.kind === "fourline";
  const inset = alphabet
    ? target.width * 0.104
    : Math.min(8, target.width * 0.1);
  const top = target.y + target.height * (alphabet ? 0.13 : 0.1);
  const left = target.x + inset;
  const fontSize = target.height * (alphabet ? 0.528 : 20 / 48);
  const layout = layoutBoardText(
    text,
    fontSize,
    2,
    {
      left,
      top,
      right: target.x + target.width - inset,
      bottom: target.y + target.height * 0.88,
    },
    [],
    { x: left, y: top },
    Math.max(1, fontSize),
    { mode: "replace" },
  );
  if (!layout) {
    return;
  }
  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;
  const dx = layout.x + layout.width / 2 - cx;
  const dy = -target.height / 25;
  const x =
    cx +
    dx * Math.cos(target.angle) -
    dy * Math.sin(target.angle) -
    layout.width / 2;
  const y =
    cy +
    dx * Math.sin(target.angle) +
    dy * Math.cos(target.angle) -
    layout.height / 2;
  return {
    ...layout,
    id: randomId(),
    type: "text",
    x,
    y,
    angle: target.angle as ExcalidrawElement["angle"],
    groupIds: [...target.groupIds],
    strokeColor: color,
    customData: {
      fcGenerated: true,
      fcRecognizedSource: sourceIds,
      fcInsertion: {
        ...target.insertion,
        origin: { x, y },
        textIndex: target.index,
      },
    },
  };
};
