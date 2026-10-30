import { randomId, FONT_FAMILY, getLineHeight } from "@fcboard/common";

import type { FcboardElement } from "@fcboard/element/types";
import type { FcboardElementSkeleton } from "@fcboard/element/transform";

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
  color?: string;
  insertion: Insertion;
  groupIds: readonly string[];
};
export type InsertionWritingTarget = WritingPart & {
  key: string;
  stamp: string;
  index: number;
};

export const boardWritingParts = (
  elements: readonly FcboardElement[],
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
            color: element.strokeColor,
            groupIds: element.groupIds,
          },
        ]
      : [];
  });

export const documentWritingParts = (
  strokes: readonly InkStroke[],
): WritingPart[] =>
  strokes.flatMap((stroke) => {
    // Cell handwriting is content, not another table/node boundary. In particular,
    // never spread an arbitrarily long handwritten path into Math.min/max here.
    if (!stroke.insertion || stroke.insertion.inkCell !== undefined) {
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
        color: stroke.color,
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
    const runs = parts
      .filter((item) => ownsText({ insertion: part.insertion, index }, item))
      .map((item, position) => {
        const text = item.text || "";
        const source = item.insertion.labelText;
        return {
          text:
            typeof item.insertion.labelPart === "number" &&
            typeof source === "string" &&
            source.trim() === text.trim()
              ? source
              : (position ? " " : "") + text,
          color: item.color || "#333333",
        };
      });
    const text = runs
      .map((run) => run.text)
      .join("")
      .trim()
      .replace(/\s+/g, " ");
    const textRuns = [...(part.insertion.textRuns || [])];
    textRuns[index] = runs;
    return [
      {
        ...part,
        insertion: { ...part.insertion, textRuns },
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
          runs,
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
): FcboardElementSkeleton | undefined => {
  const text = [target.text?.trim(), input.trim()]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");
  if (!input.trim() || text.length > 4000) {
    return;
  }
  const alphabet = target.insertion.kind === "fourline";
  const nativeNode = !!target.insertion.nodeStyles;
  const fontFamily = alphabet
    ? FONT_FAMILY.FactoryHandwriting
    : FONT_FAMILY.Helvetica;
  const inset = alphabet
    ? target.width * 0.104
    : Math.min(nativeNode ? 30 : 8, target.width * 0.1);
  const top = target.y + target.height * (alphabet ? 0.13 : 0.1);
  const left = target.x + inset;
  const fontSize =
    target.height *
    (alphabet || nativeNode ? 0.66 / getLineHeight(fontFamily) : 20 / 48);
  const layout = layoutBoardText(
    text,
    fontSize,
    fontFamily,
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
  const textRuns = [...(target.insertion.textRuns || [])];
  textRuns[target.index] = [
    ...(target.text
      ? target.insertion.textRuns?.[target.index] || [
          { text: target.text, color: target.color || color },
        ]
      : []),
    { text: (target.text ? " " : "") + input.trim(), color },
  ];
  return {
    ...layout,
    id: randomId(),
    type: "text",
    x,
    y,
    angle: target.angle as FcboardElement["angle"],
    groupIds: [...target.groupIds],
    strokeColor: color,
    customData: {
      fcGenerated: true,
      fcRecognizedSource: sourceIds,
      fcInsertion: {
        ...target.insertion,
        textRuns,
        origin: { x, y },
        textIndex: target.index,
      },
    },
  };
};
