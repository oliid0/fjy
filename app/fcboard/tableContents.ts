import { randomId } from "@fcboard/common";
import { newElementWith } from "@fcboard/element";

import type { FcboardElement } from "@fcboard/element/types";

import {
  mindMapNodes,
  readSceneInsertions,
  readDocumentInsertions,
} from "./insertObjects";

import type { InsertObject } from "./insertObjects";
import type { InkStroke } from "./documents";

type Owner = InsertObject & {
  origin: { x: number; y: number };
  textIndex?: number;
};
const cellIndex = (owner: Owner, next: InsertObject, index: number) => {
  const row = Math.floor(index / owner.columns);
  const column = index % owner.columns;
  return row < next.rows && column < next.columns
    ? row * next.columns + column
    : undefined;
};

/** Removing a native table edge does not delete the handwriting that lay there.
 * Keep such content on the surface; it no longer belongs to the smaller table. */
export const carryBoardTableContents = (
  scene: readonly FcboardElement[],
  next: InsertObject,
) => {
  const body = scene.find(
    (element) =>
      element.type === "rectangle" &&
      element.customData?.fcInsertion?.id === next.id &&
      element.customData.fcInsertion.inkCell === undefined,
  );
  const previous = body && { x: body.x, y: body.y };
  return scene.flatMap((element) => {
    const owner = element.customData?.fcInsertion as Owner | undefined;
    if (!owner || owner.id !== next.id || owner.kind !== "table") {
      return [];
    }
    const raw = owner.inkCell !== undefined;
    const index = raw ? owner.inkCell : owner.textIndex;
    if (index === undefined) {
      return [];
    }
    const cell = cellIndex(owner, next, index);
    if (!raw && cell !== undefined) {
      return [];
    }
    const x = element.x + next.position.x - (previous || owner.position).x;
    const y = element.y + next.position.y - (previous || owner.position).y;
    if (cell === undefined) {
      const { fcInsertion, ...customData } = element.customData!;
      return [
        newElementWith(element, {
          ...(raw ? {} : { id: randomId(), index: null }),
          x,
          y,
          customData,
          groupIds: element.groupIds.filter((id) => id !== next.id),
        }),
      ];
    }
    return [
      newElementWith(element, {
        x,
        y,
        customData: {
          ...element.customData,
          fcInsertion: { ...next, inkCell: cell, origin: { x, y } },
        },
      }),
    ];
  });
};

export const carryDocumentTableContents = (
  strokes: readonly InkStroke[],
  next: InsertObject,
) => {
  const body = strokes.find(
    (stroke) =>
      stroke.insertion?.id === next.id &&
      stroke.insertion.inkCell === undefined &&
      !stroke.text &&
      stroke.points.length === 5,
  );
  const previous = body && { x: body.points[0][0], y: body.points[0][1] };
  return strokes.flatMap((stroke): InkStroke[] => {
    const owner = stroke.insertion;
    if (!owner || owner.id !== next.id || owner.kind !== "table") {
      return [];
    }
    const raw = owner.inkCell !== undefined;
    const index = raw ? owner.inkCell : owner.textIndex;
    if (index === undefined) {
      return [];
    }
    const cell = cellIndex(owner, next, index);
    if (!raw && cell !== undefined) {
      return [];
    }
    const dx = next.position.x - (previous || owner.position).x;
    const dy = next.position.y - (previous || owner.position).y;
    return [
      {
        ...stroke,
        ...(raw ? {} : { id: randomId() }),
        points: stroke.points.map(([x, y]) => [x + dx, y + dy]),
        anchor: stroke.anchor
          ? { x: stroke.anchor.x + dx, y: stroke.anchor.y + dy }
          : undefined,
        insertion:
          cell === undefined
            ? undefined
            : {
                ...next,
                inkCell: cell,
                origin: { x: owner.origin.x + dx, y: owner.origin.y + dy },
              },
      },
    ];
  });
};

/** HNodeObject owns its strokes. Node edits transform that handwriting with
 * the node; adding/removing branches preserves the other nodes' ownership. */
const insertionShift = (
  previous: InsertObject,
  next: InsertObject,
  index: number,
) => {
  let cell = index;
  let dx = next.position.x - previous.position.x;
  let dy = next.position.y - previous.position.y;
  if (next.kind === "mindmap") {
    const before = mindMapNodes(previous);
    const after = mindMapNodes(next);
    const old = before[index];
    if (!old) {
      return;
    }
    if (before.length !== after.length) {
      cell = after.findIndex(
        (node) =>
          Math.abs(node.x - old.x) < 0.001 && Math.abs(node.y - old.y) < 0.001,
      );
    }
    if (!after[cell]) {
      return;
    }
    dx += after[cell].x - old.x;
    dy += after[cell].y - old.y;
  }
  return { cell, dx, dy };
};
export const carryBoardInsertionContents = (
  scene: readonly FcboardElement[],
  next: InsertObject,
) => {
  const members = scene.filter(
    (element) => element.customData?.fcInsertion?.id === next.id,
  );
  const previous = readSceneInsertions(members)[0];
  return members.flatMap((element) => {
    const owner = element.customData!.fcInsertion as Owner;
    if (owner.inkCell === undefined) {
      return [];
    }
    const shift = insertionShift(previous || owner, next, owner.inkCell);
    if (!shift) {
      return [];
    }
    const x = element.x + shift.dx;
    const y = element.y + shift.dy;
    return [
      newElementWith(element, {
        x,
        y,
        customData: {
          ...element.customData,
          fcInsertion: { ...next, inkCell: shift.cell, origin: { x, y } },
        },
      }),
    ];
  });
};
export const carryDocumentInsertionContents = (
  strokes: readonly InkStroke[],
  next: InsertObject,
) => {
  const members = strokes.filter((stroke) => stroke.insertion?.id === next.id);
  const previous = readDocumentInsertions(members)[0];
  return members.flatMap((stroke): InkStroke[] => {
    const owner = stroke.insertion!;
    if (owner.inkCell === undefined) {
      return [];
    }
    const shift = insertionShift(previous || owner, next, owner.inkCell);
    if (!shift) {
      return [];
    }
    const origin = {
      x: owner.origin.x + shift.dx,
      y: owner.origin.y + shift.dy,
    };
    return [
      {
        ...stroke,
        points: stroke.points.map(([x, y]): [number, number] => [
          x + shift.dx,
          y + shift.dy,
        ]),
        anchor: stroke.anchor
          ? { x: stroke.anchor.x + shift.dx, y: stroke.anchor.y + shift.dy }
          : undefined,
        insertion: { ...next, inkCell: shift.cell, origin },
      },
    ];
  });
};
