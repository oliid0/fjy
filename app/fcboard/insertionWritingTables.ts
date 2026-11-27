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
  // A continuous stroke spanning several cells is free writing across the
  // grid, not a request to enlarge the cell under its first point.
  if (
    bounds.right - bounds.left > columns[column] ||
    bounds.bottom - bounds.top > rows[row]
  ) {
    return;
  }
  // Keep a cell stationary while its ink fits. Add breathing room only after
  // the writing actually crosses an edge, rather than chasing every sample.
  const left =
    bounds.left < body.x + xs[column]
      ? body.x + xs[column] + 20 - bounds.left
      : 0;
  const right =
    bounds.right > body.x + xs[column + 1]
      ? bounds.right + 20 - body.x - xs[column + 1]
      : 0;
  const top =
    bounds.top < body.y + ys[row] ? body.y + ys[row] + 20 - bounds.top : 0;
  const bottom =
    bounds.bottom > body.y + ys[row + 1]
      ? bounds.bottom + 20 - body.y - ys[row + 1]
      : 0;
  // Use the model's scene-coordinate range, including tables extended beyond
  // the initial size picker. The original cell growth is not viewport-limited.
  if (
    object.width + left + right > 100000 ||
    object.height + top + bottom > 100000
  ) {
    return;
  }
  const baseColumnWidths = object.baseColumnWidths || [...columns];
  const baseRowHeights = object.baseRowHeights || [...rows];
  columns[column] += left + right;
  rows[row] += top + bottom;
  const next: InsertObject = {
    ...object,
    position: { x: body.x - left, y: body.y - top },
    width: object.width + left + right,
    height: object.height + top + bottom,
    columnWidths: columns,
    rowHeights: rows,
    baseColumnWidths,
    baseRowHeights,
  };
  const shift = (index: number) => {
    const otherColumn = index % object.columns;
    const otherRow = Math.floor(index / object.columns);
    return {
      x: otherColumn < column ? -left : otherColumn > column ? right : 0,
      y: otherRow < row ? -top : otherRow > row ? bottom : 0,
    };
  };
  return {
    previous: object,
    object: next,
    cell,
    shift,
    resized: !!(left || right || top || bottom),
  };
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
      source.customData?.fcGenerated
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
    const shapes = growth.resized
      ? convertToFcboardElements(tableShapes(growth.object), {
          regenerateIds: false,
        }).map((element) => {
          const old = previous.get(element.id);
          return old
            ? { ...element, index: old.index, version: old.version + 1 }
            : element;
        })
      : [];
    let replaced = false;
    scene = scene.flatMap((element) => {
      const owner = element.customData?.fcInsertion;
      const own = element.id === source.id;
      if (!growth.resized && !own) {
        return [element];
      }
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
      source.generated ||
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
        if (!growth.resized && !own) {
          return [stroke];
        }
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
      ...(growth.resized ? tableShapes(growth.object) : []).map((shape) =>
        shapeInk(shape, "insertion"),
      ),
    ];
  }
  return strokes;
};

type CellContent = { cell: number; bounds: TableWritingBounds };
type ErasedCells = Map<string, Set<number>>;
const recordErasedCell = (
  erased: ErasedCells,
  owner: InsertObject,
  cell: number,
) => {
  const cells = erased.get(owner.id) || new Set<number>();
  cells.add(cell);
  erased.set(owner.id, cells);
};
const shrinkLayout = (
  body: Part,
  contents: readonly CellContent[],
  parts: readonly Part[],
  erased: ReadonlySet<number>,
) => {
  const previous = body.insertion;
  const { baseColumnWidths, baseRowHeights } = previous;
  if (!baseColumnWidths || !baseRowHeights || body.angle) {
    return;
  }
  const columns = tableTrackSizes(
    previous.columnWidths,
    previous.columns,
    body.width,
  );
  const rows = tableTrackSizes(previous.rowHeights, previous.rows, body.height);
  const xs = trackOffsets(columns);
  const ys = trackOffsets(rows);
  const bounds = new Map<number, TableWritingBounds>();
  for (const content of contents) {
    if (content.cell < 0 || content.cell >= previous.rows * previous.columns) {
      continue;
    }
    const old = bounds.get(content.cell);
    bounds.set(
      content.cell,
      old
        ? {
            left: Math.min(old.left, content.bounds.left),
            right: Math.max(old.right, content.bounds.right),
            top: Math.min(old.top, content.bounds.top),
            bottom: Math.max(old.bottom, content.bounds.bottom),
          }
        : { ...content.bounds },
    );
  }
  const affectedColumns = new Set<number>();
  const affectedRows = new Set<number>();
  for (const cell of erased) {
    if (cell >= 0 && cell < previous.rows * previous.columns) {
      affectedColumns.add(cell % previous.columns);
      affectedRows.add(Math.floor(cell / previous.columns));
    }
  }
  const nextColumns = columns.map((size, index) =>
    affectedColumns.has(index) ? Math.min(size, baseColumnWidths[index]) : size,
  );
  const nextRows = rows.map((size, index) =>
    affectedRows.has(index) ? Math.min(size, baseRowHeights[index]) : size,
  );
  for (const [cell, box] of bounds) {
    const c = cell % previous.columns;
    const r = Math.floor(cell / previous.columns);
    const width = box.right - box.left;
    const height = box.bottom - box.top;
    const baseWidth = baseColumnWidths[c] || columns[c];
    const baseHeight = baseRowHeights[r] || rows[r];
    if (affectedColumns.has(c)) {
      nextColumns[c] = Math.min(
        columns[c],
        Math.max(nextColumns[c], width > baseWidth ? width + 20 : baseWidth),
      );
    }
    if (affectedRows.has(r)) {
      nextRows[r] = Math.min(
        rows[r],
        Math.max(nextRows[r], height > baseHeight ? height + 20 : baseHeight),
      );
    }
  }
  if (
    columns.every((v, i) => Math.abs(v - nextColumns[i]) < 0.5) &&
    rows.every((v, i) => Math.abs(v - nextRows[i]) < 0.5)
  ) {
    return;
  }
  const nextXs = trackOffsets(nextColumns);
  const nextYs = trackOffsets(nextRows);
  const object: InsertObject = {
    ...previous,
    position: { x: body.x, y: body.y },
    cells: Array.from(
      { length: previous.rows * previous.columns },
      (_, index) =>
        parts.find(
          (part) =>
            part.insertion.id === previous.id &&
            part.insertion.textIndex === index &&
            part.text !== undefined,
        )?.text || "",
    ),
    width: nextXs.at(-1)!,
    height: nextYs.at(-1)!,
    columnWidths: nextColumns,
    rowHeights: nextRows,
  };
  const shift = (cell: number) => {
    const c = cell % previous.columns;
    const r = Math.floor(cell / previous.columns);
    const box = bounds.get(cell);
    let x = nextXs[c] - xs[c];
    let y = nextYs[r] - ys[r];
    if (box) {
      const left = box.left - body.x - xs[c];
      const right = box.right - body.x - xs[c];
      const top = box.top - body.y - ys[r];
      const bottom = box.bottom - body.y - ys[r];
      x += Math.max(-left, Math.min(0, nextColumns[c] - right));
      y += Math.max(-top, Math.min(0, nextRows[r] - bottom));
    }
    return { x, y };
  };
  return { object, shift };
};
const pointBounds = (
  points: readonly (readonly number[])[],
): TableWritingBounds =>
  points.reduce(
    (box, [x, y]) => ({
      left: Math.min(box.left, x),
      right: Math.max(box.right, x),
      top: Math.min(box.top, y),
      bottom: Math.max(box.bottom, y),
    }),
    { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity },
  );

/** Reflow after erasure only. Writing never shrinks a grid under an active hand. */
export const shrinkBoardErasure = (
  before: readonly FcboardElement[],
  input: readonly FcboardElement[],
) => {
  const erased: ErasedCells = new Map();
  const after = new Map(input.map((element) => [element.id, element]));
  for (const old of before) {
    const owner = old.customData?.fcInsertion;
    const cell = owner?.inkCell ?? (old.type === "text" && owner?.textIndex);
    if (old.isDeleted || owner?.kind !== "table" || typeof cell !== "number") {
      continue;
    }
    const retained = after.get(old.id);
    if (
      !retained ||
      retained.isDeleted ||
      (old.type === "freedraw" &&
        retained.type === "freedraw" &&
        retained.points !== old.points)
    ) {
      recordErasedCell(erased, owner, cell);
    }
  }
  if (!erased.size) {
    return input;
  }
  let scene = input;
  for (const body of boardWritingParts(input).filter(
    (p) =>
      erased.has(p.insertion.id) &&
      p.insertion.kind === "table" &&
      p.rectangle &&
      p.insertion.inkCell === undefined,
  )) {
    const id = body.insertion.id;
    const members = scene.filter(
      (e) =>
        !e.isDeleted &&
        e.customData?.fcInsertion?.id === id &&
        e.customData.fcInsertion.inkCell !== undefined,
    );
    const contents: CellContent[] = members.map((e) => ({
      cell: e.customData!.fcInsertion.inkCell,
      bounds: pointBounds(
        boardInk([e])[0] || [
          [e.x, e.y],
          [e.x + e.width, e.y + e.height],
        ],
      ),
    }));
    for (const part of boardWritingParts(scene)) {
      if (
        part.insertion.id === id &&
        part.text?.trim() &&
        part.insertion.textIndex !== undefined
      ) {
        contents.push({
          cell: part.insertion.textIndex,
          bounds: {
            left: part.x,
            right: part.x + part.width,
            top: part.y,
            bottom: part.y + part.height,
          },
        });
      }
    }
    const plan = shrinkLayout(
      body,
      contents,
      boardWritingParts(scene),
      erased.get(id)!,
    );
    if (!plan) {
      continue;
    }
    const previous = new Map(scene.map((e) => [e.id, e]));
    const shapes = convertToFcboardElements(tableShapes(plan.object), {
      regenerateIds: false,
    }).map((e) => {
      const old = previous.get(e.id);
      return old ? { ...e, index: old.index, version: old.version + 1 } : e;
    });
    let replaced = false;
    scene = scene.flatMap((e) => {
      const owner = e.customData?.fcInsertion;
      if (e.isDeleted || owner?.id !== id) {
        return [e];
      }
      if (owner.inkCell === undefined) {
        if (replaced) {
          return [];
        }
        replaced = true;
        return shapes;
      }
      const shift = plan.shift(owner.inkCell);
      const x = e.x + shift.x;
      const y = e.y + shift.y;
      return [
        newElementWith(e, {
          x,
          y,
          customData: {
            ...e.customData,
            fcInsertion: {
              ...plan.object,
              inkCell: owner.inkCell,
              origin: { x, y },
            },
          },
        }),
      ];
    });
  }
  return scene;
};
const shrinkDocumentTables = (
  input: readonly InkStroke[],
  erased: ErasedCells,
) => {
  let strokes = input;
  for (const body of documentWritingParts(input).filter(
    (p) =>
      erased.has(p.insertion.id) &&
      p.insertion.kind === "table" &&
      p.rectangle &&
      p.insertion.inkCell === undefined,
  )) {
    const id = body.insertion.id;
    const contents: CellContent[] = strokes
      .filter(
        (s) => s.insertion?.id === id && s.insertion.inkCell !== undefined,
      )
      .map((s) => ({
        cell: s.insertion!.inkCell!,
        bounds: pointBounds(s.points),
      }));
    for (const part of documentWritingParts(strokes)) {
      if (
        part.insertion.id === id &&
        part.text?.trim() &&
        part.insertion.textIndex !== undefined
      ) {
        contents.push({
          cell: part.insertion.textIndex,
          bounds: {
            left: part.x,
            right: part.x + part.width,
            top: part.y,
            bottom: part.y + part.height,
          },
        });
      }
    }
    const plan = shrinkLayout(
      body,
      contents,
      documentWritingParts(strokes),
      erased.get(id)!,
    );
    if (!plan) {
      continue;
    }
    strokes = [
      ...strokes.flatMap((s) => {
        const owner = s.insertion;
        if (owner?.id !== id) {
          return [s];
        }
        if (owner.inkCell === undefined) {
          return [];
        }
        const shift = plan.shift(owner.inkCell);
        const points = s.points.map(([x, y]): [number, number] => [
          x + shift.x,
          y + shift.y,
        ]);
        return [
          {
            ...s,
            points,
            anchor: s.anchor
              ? { x: s.anchor.x + shift.x, y: s.anchor.y + shift.y }
              : undefined,
            insertion: {
              ...plan.object,
              inkCell: owner.inkCell,
              origin: { x: points[0][0], y: points[0][1] },
            },
          },
        ];
      }),
      ...tableShapes(plan.object).map((shape) => shapeInk(shape, "insertion")),
    ];
  }
  return strokes;
};

export const shrinkDocumentErasure = (
  before: readonly InkStroke[],
  after: readonly InkStroke[],
) => {
  const current = new Map(after.map((stroke) => [stroke.id, stroke]));
  const erased: ErasedCells = new Map();
  for (const old of before) {
    const owner = old.insertion;
    const cell = owner?.inkCell ?? owner?.textIndex;
    if (owner?.kind !== "table" || cell === undefined) {
      continue;
    }
    const retained = current.get(old.id);
    if (!retained) {
      recordErasedCell(erased, owner, cell);
      continue;
    }
    if (retained.points === old.points || owner.inkCell === undefined) {
      continue;
    }
    const previous = pointBounds(old.points);
    const next = pointBounds(retained.points);
    if (
      retained.points.length < old.points.length ||
      next.right - next.left < previous.right - previous.left - 0.5 ||
      next.bottom - next.top < previous.bottom - previous.top - 0.5
    ) {
      recordErasedCell(erased, owner, cell);
    }
  }
  return erased.size ? shrinkDocumentTables(after, erased) : after;
};
