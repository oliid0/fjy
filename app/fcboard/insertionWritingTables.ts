import { convertToFcboardElements } from "@fcboard/fcboard";
import { newElementWith } from "@fcboard/element";

import type { FcboardElement } from "@fcboard/element/types";

import { boardInk } from "./digitalInk";
import { shapeInk } from "./documents";
import { boardWritingParts, documentWritingParts } from "./insertionWriting";
import {
  insertionShapes,
  insertionShapeId,
  tableTrackSizes,
  trackOffsets,
} from "./insertObjects";

import type { InkStroke } from "./documents";
import type { InsertObject } from "./insertObjects";

type Part = ReturnType<typeof boardWritingParts>[number];
export type TableWritingBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};
export type TableWritingContact = { tableId: string; cell: number };
export type TableWritingTarget = TableWritingContact & {
  bounds: TableWritingBounds;
};
type LiveWriting = {
  targets: ReadonlyMap<string, TableWritingTarget>;
  active: ReadonlySet<string>;
};

/** HTableObject grows the contacted cell, leaving its ink intact and moving later cells. */
const tableGrowth = (
  parts: readonly Part[],
  points: readonly (readonly number[])[],
  target?: TableWritingContact,
) => {
  const start = points[0];
  if (
    !start ||
    points.some((point) => !point.slice(0, 2).every(Number.isFinite))
  ) {
    return;
  }
  const body = [...parts]
    .reverse()
    .find(
      (part) =>
        part.rectangle &&
        part.insertion.kind === "table" &&
        part.insertion.inkCell === undefined &&
        !part.angle &&
        (target
          ? part.insertion.id === target.tableId
          : start[0] >= part.x &&
            start[0] <= part.x + part.width &&
            start[1] >= part.y &&
            start[1] <= part.y + part.height),
    );
  if (!body) {
    return;
  }
  const object: InsertObject = {
    ...body.insertion,
    position: { x: body.x, y: body.y },
    width: body.width,
    height: body.height,
    cells: [...body.insertion.cells],
  };
  for (const part of parts) {
    if (
      part.insertion.id === object.id &&
      part.text !== undefined &&
      part.insertion.textIndex !== undefined
    ) {
      object.cells[part.insertion.textIndex] = part.text;
    }
  }
  const columns = tableTrackSizes(
    object.columnWidths,
    object.columns,
    object.width,
  );
  const rows = tableTrackSizes(object.rowHeights, object.rows, object.height);
  const xs = trackOffsets(columns);
  const ys = trackOffsets(rows);
  const column = target
    ? target.cell % object.columns
    : Math.max(
        0,
        xs.findIndex((x, index) => index > 0 && start[0] <= body.x + x) - 1,
      );
  const row = target
    ? Math.floor(target.cell / object.columns)
    : Math.max(
        0,
        ys.findIndex((y, index) => index > 0 && start[1] <= body.y + y) - 1,
      );
  const cell = row * object.columns + column;
  if (column < 0 || column >= object.columns || row < 0 || row >= object.rows) {
    return;
  }
  const bounds = points.reduce(
    (box, point) => ({
      left: Math.min(box.left, point[0]),
      right: Math.max(box.right, point[0]),
      top: Math.min(box.top, point[1]),
      bottom: Math.max(box.bottom, point[1]),
    }),
    { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity },
  );
  const left = Math.max(0, body.x + xs[column] + 20 - bounds.left);
  const right = Math.max(0, bounds.right + 20 - body.x - xs[column + 1]);
  const top = Math.max(0, body.y + ys[row] + 20 - bounds.top);
  const bottom = Math.max(0, bounds.bottom + 20 - body.y - ys[row + 1]);
  // Use the model's scene-coordinate range, including tables extended beyond
  // the initial size picker. The original cell growth is not viewport-limited.
  if (
    object.width + left + right > 100000 ||
    object.height + top + bottom > 100000
  ) {
    return;
  }
  columns[column] += left + right;
  rows[row] += top + bottom;
  const next: InsertObject = {
    ...object,
    position: { x: body.x - left, y: body.y - top },
    width: object.width + left + right,
    height: object.height + top + bottom,
    columnWidths: columns,
    rowHeights: rows,
  };
  const shift = (index: number) => {
    const otherColumn = index % object.columns;
    const otherRow = Math.floor(index / object.columns);
    return {
      x: otherColumn < column ? -left : otherColumn > column ? right : 0,
      y: otherRow < row ? -top : otherRow > row ? bottom : 0,
    };
  };
  return { previous: object, object: next, cell, shift };
};

export const tableWritingContact = (
  parts: readonly Part[],
  point: readonly number[],
): TableWritingContact | undefined => {
  const growth = tableGrowth(parts, [point]);
  return growth ? { tableId: growth.object.id, cell: growth.cell } : undefined;
};

export const tableWritingNeedsGrowth = (
  parts: readonly Part[],
  target: TableWritingTarget,
) => {
  const { left, right, top, bottom } = target.bounds;
  const growth = tableGrowth(
    parts,
    [
      [left, top],
      [right, bottom],
    ],
    target,
  );
  return (
    !!growth &&
    (growth.previous.width !== growth.object.width ||
      growth.previous.height !== growth.object.height)
  );
};

const tableShapes = (object: InsertObject) =>
  insertionShapes(object).map(({ insertionText, ...shape }, index) => {
    const x = object.position.x + (shape.x || 0);
    const y = object.position.y + (shape.y || 0);
    return {
      ...shape,
      id: insertionShapeId(object, { ...shape, insertionText }, index),
      x,
      y,
      groupIds: [object.id],
      customData: {
        fcGenerated: true,
        fcInsertion: { ...object, origin: { x, y }, textIndex: insertionText },
      },
    };
  });

export const growBoardTableWriting = (
  input: readonly FcboardElement[],
  eligible?: ReadonlySet<string>,
  live?: LiveWriting,
) => {
  let scene = input;
  for (const source of input) {
    if (
      (eligible && !eligible.has(source.id)) ||
      source.type !== "freedraw" ||
      source.isDeleted ||
      source.customData?.fcInsertion ||
      source.customData?.fcGenerated ||
      source.customData?.fcQuestionInput
    ) {
      continue;
    }
    const target = live?.targets.get(source.id);
    const growth = tableGrowth(
      boardWritingParts(scene),
      target
        ? [
            [target.bounds.left, target.bounds.top],
            [target.bounds.right, target.bounds.bottom],
          ]
        : boardInk([source])[0] || [],
      target,
    );
    if (!growth) {
      continue;
    }
    const id = growth.object.id;
    const previous = new Map(scene.map((element) => [element.id, element]));
    const shapes = convertToFcboardElements(tableShapes(growth.object), {
      regenerateIds: false,
    }).map((element) => {
      const old = previous.get(element.id);
      return old
        ? { ...element, index: old.index, version: old.version + 1 }
        : element;
    });
    let replaced = false;
    scene = scene.flatMap((element) => {
      const owner = element.customData?.fcInsertion;
      const own = element.id === source.id;
      if (owner?.id !== id && !own) {
        return [element];
      }
      if (!own && owner?.inkCell === undefined) {
        if (replaced) {
          return [];
        }
        replaced = true;
        return shapes;
      }
      const cell = own ? growth.cell : owner.inkCell;
      const shift =
        own || live?.active.has(element.id)
          ? { x: 0, y: 0 }
          : growth.shift(cell);
      const x = element.x + shift.x;
      const y = element.y + shift.y;
      return [
        newElementWith(element, {
          x,
          y,
          groupIds: [id],
          customData: {
            ...element.customData,
            fcInsertion: {
              ...growth.object,
              inkCell: cell,
              origin: { x, y },
            },
          },
        }),
      ];
    });
  }
  return scene;
};

export const growDocumentTableWriting = (
  input: readonly InkStroke[],
  eligible?: ReadonlySet<string>,
  live?: LiveWriting,
) => {
  let strokes = input;
  for (const source of input) {
    if (
      (eligible && !eligible.has(source.id)) ||
      !source.fcInk ||
      source.insertion ||
      source.text ||
      source.image ||
      source.widget ||
      source.questionInput ||
      source.language ||
      source.lesson
    ) {
      continue;
    }
    const target = live?.targets.get(source.id);
    const growth = tableGrowth(
      documentWritingParts(strokes),
      target
        ? [
            [target.bounds.left, target.bounds.top],
            [target.bounds.right, target.bounds.bottom],
          ]
        : source.points,
      target,
    );
    if (!growth) {
      continue;
    }
    const id = growth.object.id;
    strokes = [
      ...strokes.flatMap((stroke) => {
        const owner = stroke.insertion;
        const own = stroke.id === source.id;
        if (owner?.id !== id && !own) {
          return [stroke];
        }
        if (!own && owner?.inkCell === undefined) {
          return [];
        }
        const cell = own ? growth.cell : owner!.inkCell!;
        const shift =
          own || live?.active.has(stroke.id)
            ? { x: 0, y: 0 }
            : growth.shift(cell);
        const points = stroke.points.map(([x, y]): [number, number] => [
          x + shift.x,
          y + shift.y,
        ]);
        const origin = { x: points[0][0], y: points[0][1] };
        return [
          {
            ...stroke,
            points,
            anchor: stroke.anchor
              ? { x: stroke.anchor.x + shift.x, y: stroke.anchor.y + shift.y }
              : undefined,
            insertion: { ...growth.object, inkCell: cell, origin },
          },
        ];
      }),
      ...tableShapes(growth.object).map((shape) =>
        shapeInk(shape, "insertion"),
      ),
    ];
  }
  return strokes;
};
