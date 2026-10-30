import {
  CaptureUpdateAction,
  convertToFcboardElements,
} from "@fcboard/fcboard";
import { pointFrom } from "@fcboard/math";
import { randomId } from "@fcboard/common";
import { getCommonBounds, newElementWith } from "@fcboard/element";
import { t } from "@fcboard/fcboard/i18n";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import type { FcboardElement } from "@fcboard/element/types";

import type { FcboardElementSkeleton } from "@fcboard/element/transform";

import { classroomCommands } from "./commands";
import { contentPosition, revealNewContent, objectSelection } from "./board";
import {
  insertionWritingTargets,
  insertionWritingText,
} from "./insertionWriting";

import { carryBoardTableContents } from "./tableContents";
import { insertionLabelParts } from "./insertionLabels";

import type { InkStroke } from "./documents";

export type InsertKind = "table" | "mindmap" | "fourline";
export type InsertNodeStyle = {
  width: number;
  height: number;
  color: string;
  opacity: number;
  direction: string;
  columns: number;
};
export type InsertionTextRun = { text: string; color: string };
export type InsertObject = {
  id: string;
  kind: InsertKind;
  position: { x: number; y: number };
  rows: number;
  columns: number;
  cells: string[];
  color?: string;
  strokeWidth?: number;
  opacity?: number;
  columnWidths?: number[];
  rowHeights?: number[];
  /** Raw handwriting belongs to a cell; it is never OCR-replaced. */
  inkCell?: number;
  nodePositions?: ({ x: number; y: number } | null)[];
  nodeSize?: { width: number; height: number };
  nodeStyles?: InsertNodeStyle[];
  textRuns?: InsertionTextRun[][];
  outline: string;
  text?: string;
  textColors?: string[];
  width: number;
  height: number;
};

/** Native HTableObject, HMindMappingOBject and HAlphabetObject, represented by editable scene objects. */
export const configureInsertion = (
  object: InsertObject,
  args: Record<string, unknown>,
): InsertObject => {
  const next = { ...object };
  if (args.color !== undefined) {
    if (
      typeof args.color !== "string" ||
      !/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(args.color)
    ) {
      throw new Error(t("fcboard.invalid_insertion_data"));
    }
    next.color = args.color;
  }
  for (const key of ["strokeWidth", "opacity"] as const) {
    if (args[key] !== undefined) {
      const value = args[key];
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < (key === "opacity" ? 0 : 0.1) ||
        value > (key === "opacity" ? 100 : 100000)
      ) {
        throw new Error(t("fcboard.invalid_insertion_data"));
      }
      next[key] = value;
    }
  }
  for (const [key, min, max] of [
    ["rows", 1, object.kind === "table" ? 50000 : 12],
    ["columns", 1, object.kind === "table" ? 50000 : 12],
    [
      "width",
      object.kind === "table" ? 1 : object.kind === "fourline" ? 0.1 : 80,
      object.kind === "table" || object.kind === "fourline" ? 100000 : 1600,
    ],
    [
      "height",
      object.kind === "table" ? 1 : object.kind === "fourline" ? 0.1 : 40,
      object.kind === "table" || object.kind === "fourline" ? 100000 : 1200,
    ],
  ] as const) {
    if (args[key] !== undefined) {
      const value = args[key];
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < min ||
        value > max ||
        ((key === "rows" || key === "columns") && !Number.isInteger(value))
      ) {
        throw new Error(
          t("fcboard.insertion_parameter_key_is_out_of_range", { key }),
        );
      }
      next[key] = value;
    }
  }
  // The BZD scene budget is 50,000 elements. The original end-track buttons
  // have no 10x7 picker / 12-track limit; keep imported and edited grids readable.
  if (next.kind === "table" && next.rows * next.columns > 50000) {
    throw new Error(t("fcboard.invalid_table_content"));
  }
  if (args.cells !== undefined) {
    if (
      !Array.isArray(args.cells) ||
      args.cells.length > (next.kind === "table" ? 50000 : 144) ||
      !args.cells.every(
        (value) => typeof value === "string" && value.length <= 1000,
      )
    ) {
      throw new Error(t("fcboard.invalid_table_content"));
    }
    next.cells = args.cells;
  }
  if (args.outline !== undefined) {
    if (
      typeof args.outline !== "string" ||
      (!args.outline.trim() && object.kind !== "mindmap") ||
      args.outline.length > 8000 ||
      args.outline.split("\n").length > 40
    ) {
      throw new Error(
        t(
          "fcboard.invalid_mind_map_outline_use_an_indented_outline_of_up_to_40_lines",
        ),
      );
    }
    next.outline = args.outline;
  }
  if (args.text !== undefined) {
    if (typeof args.text !== "string" || args.text.length > 4000) {
      throw new Error(t("fcboard.invalid_insertion_data"));
    }
    next.text = args.text;
  }
  if (args.textColors !== undefined) {
    if (
      !Array.isArray(args.textColors) ||
      args.textColors.length > (next.kind === "table" ? 50000 : 144) ||
      !args.textColors.every(
        (color) => typeof color === "string" && color.length <= 64,
      )
    ) {
      throw new Error(t("fcboard.invalid_insertion_data"));
    }
    next.textColors = [...args.textColors];
  }
  if (args.nodePositions !== undefined) {
    if (
      !Array.isArray(args.nodePositions) ||
      args.nodePositions.length > 40 ||
      args.nodePositions.some(
        (point) =>
          point !== null &&
          (!point ||
            typeof point !== "object" ||
            ![point.x, point.y].every(
              (value) =>
                typeof value === "number" &&
                Number.isFinite(value) &&
                Math.abs(value) <= 100000,
            )),
      )
    ) {
      throw new Error(t("fcboard.invalid_insertion_data"));
    }
    next.nodePositions = args.nodePositions.map(
      (point) => point && { x: point.x, y: point.y },
    );
  }
  if (args.nodeSize !== undefined) {
    const size = args.nodeSize as InsertObject["nodeSize"];
    if (
      !size ||
      ![size.width, size.height].every(
        (value) =>
          typeof value === "number" &&
          Number.isFinite(value) &&
          value > 0 &&
          value <= 100000,
      )
    ) {
      throw new Error(t("fcboard.invalid_insertion_data"));
    }
    next.nodeSize = { width: size.width, height: size.height };
  }
  if (args.nodeStyles !== undefined) {
    const styles = args.nodeStyles as InsertNodeStyle[];
    if (
      !Array.isArray(styles) ||
      styles.length > 40 ||
      styles.some(
        (style) =>
          !style ||
          ![style.width, style.height].every(
            (value) => Number.isFinite(value) && value > 0 && value <= 100000,
          ) ||
          typeof style.color !== "string" ||
          !/^#[a-f0-9]{6}$/i.test(style.color) ||
          !Number.isFinite(style.opacity) ||
          style.opacity < 0 ||
          style.opacity > 100 ||
          typeof style.direction !== "string" ||
          style.direction.length > 32 ||
          !Number.isInteger(style.columns) ||
          style.columns < 1 ||
          style.columns > 100000,
      )
    ) {
      throw new Error(t("fcboard.invalid_insertion_data"));
    }
    next.nodeStyles = styles.map((style) => ({ ...style }));
  }
  if (args.textRuns !== undefined) {
    const runs = args.textRuns as InsertionTextRun[][];
    if (
      !Array.isArray(runs) ||
      runs.length > 40 ||
      runs.some(
        (parts) =>
          !Array.isArray(parts) ||
          parts.length > 4000 ||
          parts.some(
            (part) =>
              !part ||
              typeof part.text !== "string" ||
              part.text.length > 4000 ||
              typeof part.color !== "string" ||
              part.color.length > 64,
          ) ||
          parts.reduce((sum, part) => sum + part.text.length, 0) > 4000,
      )
    ) {
      throw new Error(t("fcboard.invalid_insertion_data"));
    }
    next.textRuns = runs.map((parts) => parts.map((part) => ({ ...part })));
  }
  if (next.kind === "table") {
    for (const [key, count] of [
      ["columnWidths", next.columns],
      ["rowHeights", next.rows],
    ] as const) {
      const sizes = args[key] ?? next[key];
      if (sizes !== undefined) {
        if (
          !Array.isArray(sizes) ||
          sizes.some(
            (size) =>
              typeof size !== "number" || !Number.isFinite(size) || size <= 0,
          )
        ) {
          throw new Error(t("fcboard.invalid_insertion_data"));
        }
        next[key] = Array.from(
          { length: count },
          (_, index) =>
            sizes[index] ||
            (key === "columnWidths" ? next.width / count : next.height / count),
        );
      }
    }
  }
  // Changing the column count preserves row/cell positions rather than reflowing their values.
  if (next.columns !== object.columns && args.cells === undefined) {
    next.cells = Array.from(
      { length: next.rows * next.columns },
      (_, index) =>
        object.cells[
          Math.floor(index / next.columns) * object.columns +
            (index % next.columns)
        ] || "",
    );
  }
  return next;
};

export const insertionDefaults = (
  kind: InsertKind,
  position: InsertObject["position"],
): InsertObject => ({
  id: randomId(),
  kind,
  position,
  rows: 3,
  columns: 3,
  cells: [],
  outline: kind === "mindmap" ? "\n  \n  \n  " : t("fcboard.main_topic"),
  width: 360,
  height: kind === "table" ? 180 : 144,
});

type InsertShape = FcboardElementSkeleton & { insertionText?: number };
/** Stable table roles prevent a new separator from reusing a text object's ID. */
export const insertionShapeId = (
  object: InsertObject,
  shape: InsertShape,
  index: number,
) =>
  object.kind !== "table" || index === 0
    ? `${object.id}-${index}`
    : shape.insertionText !== undefined
    ? `${object.id}-cell-${shape.insertionText}`
    : index < object.rows
    ? `${object.id}-row-${index}`
    : `${object.id}-column-${index - object.rows + 1}`;
export const tableTrackSizes = (
  sizes: readonly number[] | undefined,
  count: number,
  extent: number,
) => {
  const values = Array.from(
    { length: count },
    (_, index) => sizes?.[index] || extent / count,
  );
  const total = values.reduce((sum, size) => sum + size, 0);
  return values.map((size) => (size * extent) / total);
};
export const trackOffsets = (sizes: readonly number[]) => {
  const offsets = [0];
  for (const size of sizes) {
    offsets.push(offsets[offsets.length - 1] + size);
  }
  return offsets;
};

export type TableTrackAction =
  | "row.add"
  | "row.remove"
  | "column.add"
  | "column.remove";
/** SelectCacheLayer.drawTableRows / drawTableColumn: change only the far edge. */
export const changeTableTrack = (
  object: InsertObject,
  action: TableTrackAction,
): InsertObject => {
  if (object.kind !== "table") {
    throw new Error(t("fcboard.invalid_insertion_data"));
  }
  const row = action.startsWith("row.");
  const add = action.endsWith(".add");
  const count = row ? object.rows : object.columns;
  if (!add && count === 1) {
    throw new Error(
      t(row ? "fcboard.only_one_row_left" : "fcboard.only_one_column_left"),
    );
  }
  const extent = row ? object.height : object.width;
  const sizes = tableTrackSizes(
    row ? object.rowHeights : object.columnWidths,
    count,
    extent,
  );
  if (add) {
    sizes.push(extent / count);
  } else {
    sizes.pop();
  }
  const rows = object.rows + (row ? (add ? 1 : -1) : 0);
  const columns = object.columns + (!row ? (add ? 1 : -1) : 0);
  const remap = (values: readonly string[] = []) =>
    Array.from({ length: rows * columns }, (_, index) => {
      const r = Math.floor(index / columns);
      const c = index % columns;
      return r < object.rows && c < object.columns
        ? values[r * object.columns + c] || ""
        : "";
    });
  return configureInsertion(object, {
    rows,
    columns,
    cells: remap(object.cells),
    textColors: remap(object.textColors),
    [row ? "height" : "width"]: sizes.reduce((sum, value) => sum + value, 0),
    [row ? "rowHeights" : "columnWidths"]: sizes,
  });
};
const line = (
  points: number[][],
  color: string,
  opacity = 100,
): InsertShape => ({
  type: "line",
  x: points[0][0],
  y: points[0][1],
  points: points.map(([x, y]) => pointFrom(x - points[0][0], y - points[0][1])),
  strokeColor: color,
  strokeWidth: 1.3,
  opacity,
  roughness: 0,
});

export const mindMapNodes = (object: InsertObject) => {
  const scaleX = (object.nodeSize?.width || 140) / 140;
  const scaleY = (object.nodeSize?.height || 48) / 48;
  const nodes: {
    depth: number;
    parent: number;
    text: string;
    x: number;
    y: number;
  }[] = [];
  for (const row of object.outline.split("\n")) {
    const requested = Math.floor(
      (row.match(/^\s*/)?.[0].replace(/\t/g, "  ").length || 0) / 2,
    );
    const depth = nodes.length
      ? Math.max(1, Math.min(requested || 1, nodes[nodes.length - 1].depth + 1))
      : 0;
    let parent = nodes.length - 1;
    while (parent >= 0 && nodes[parent].depth >= depth) {
      parent--;
    }
    nodes.push({
      depth,
      parent,
      text: row.trim(),
      x: depth * 190 * scaleX,
      y: nodes.length * 76 * scaleY,
    });
  }
  for (let index = nodes.length - 1; index >= 0; index--) {
    const children = nodes.filter((node) => node.parent === index);
    if (children.length) {
      nodes[index].y = (children[0].y + children[children.length - 1].y) / 2;
    }
  }
  return nodes.map((node, index) => ({
    ...node,
    ...object.nodePositions?.[index],
    width: object.nodeStyles?.[index]?.width ?? object.nodeSize?.width ?? 140,
    height: object.nodeStyles?.[index]?.height ?? object.nodeSize?.height ?? 48,
    color: object.nodeStyles?.[index]?.color ?? "#36b48e",
    opacity: object.nodeStyles?.[index]?.opacity ?? 100,
    direction: object.nodeStyles?.[index]?.direction ?? "right",
  }));
};

export const insertionShapes = (object: InsertObject): InsertShape[] => {
  const { width, height } = object;
  const label = (
    text: string,
    index: number,
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
  ) => {
    const target = insertionWritingTargets([
      {
        id: object.id,
        x,
        y,
        width,
        height,
        angle: 0,
        rectangle: true,
        insertion: { ...object, origin: { x, y }, textIndex: index },
        groupIds: [object.id],
      },
    ])[0];
    const shape = target && insertionWritingText(target, text, color, []);
    return shape
      ? insertionLabelParts(shape, object.textRuns?.[index]).map((part) => ({
          ...part,
          insertionText: index,
        }))
      : [];
  };
  if (object.kind === "fourline") {
    // HAlphabetObject draws four lines at fifths inside its green rounded panel.
    return [
      {
        type: "rectangle",
        x: 0,
        y: 0,
        width,
        height,
        backgroundColor: object.color || "#0ed49f",
        fillStyle: "solid",
        strokeColor: "transparent",
        roughness: 0,
        opacity: object.opacity ?? 100,
        roundness: { type: 3 },
        insertionText: 0,
      },
      ...Array.from({ length: 4 }, (_, index) =>
        line(
          [
            [width * 0.104, (height * (index + 1)) / 5],
            [width * 0.896, (height * (index + 1)) / 5],
          ],
          "#8aedd2",
          78,
        ),
      ),
      ...label(
        object.text || "",
        0,
        0,
        0,
        width,
        height,
        object.textColors?.[0] || "#333333",
      ),
    ];
  }
  if (object.kind === "table") {
    const color = object.color || "#333333";
    const columns = tableTrackSizes(object.columnWidths, object.columns, width);
    const rows = tableTrackSizes(object.rowHeights, object.rows, height);
    const xs = trackOffsets(columns);
    const ys = trackOffsets(rows);
    const shapes: InsertShape[] = [
      {
        type: "rectangle",
        x: 0,
        y: 0,
        width,
        height,
        strokeColor: color,
        roughness: 0,
        strokeWidth: 1.3,
      },
    ];
    for (let row = 1; row < object.rows; row++) {
      shapes.push(
        line(
          [
            [0, ys[row]],
            [width, ys[row]],
          ],
          color,
        ),
      );
    }
    for (let column = 1; column < object.columns; column++) {
      shapes.push(
        line(
          [
            [xs[column], 0],
            [xs[column], height],
          ],
          color,
        ),
      );
    }
    for (let row = 0; row < object.rows; row++) {
      for (let column = 0; column < object.columns; column++) {
        const index = row * object.columns + column;
        if (object.cells[index]) {
          shapes.push({
            type: "text",
            x: xs[column] + 8,
            y: ys[row] + 8,
            width: Math.max(20, columns[column] - 16),
            text: object.cells[index],
            fontSize: Math.min(22, rows[row] / 2),
            fontFamily: 2,
            strokeColor: color,
            insertionText: index,
          });
        }
      }
    }
    return shapes.map((shape) => ({
      ...shape,
      ...(shape.type !== "text"
        ? {
            strokeWidth: object.strokeWidth ?? 1.3,
            opacity: object.opacity ?? 100,
          }
        : {}),
    }));
  }
  const nodes = mindMapNodes(object);
  const shapes: InsertShape[] = [];
  nodes.forEach((node, index) => {
    if (node.parent >= 0 && ["right", "bottom"].includes(node.direction)) {
      const parent = nodes[node.parent];
      const start = [parent.x + parent.width, parent.y + parent.height / 2];
      const end = [node.x, node.y + node.height / 2];
      // HMindMappingOBject.onDraw uses a straight link near the same row,
      // otherwise a quadratic curve with its control point 50px before the child.
      const points =
        Math.abs(parent.y - node.y) < 30
          ? [start, end]
          : Array.from({ length: 17 }, (_, step) => {
              const t = step / 16;
              return [0, 1].map(
                (axis) =>
                  (1 - t) ** 2 * start[axis] +
                  2 * (1 - t) * t * (axis === 0 ? end[0] - 50 : end[1] - 10) +
                  t * t * end[axis],
              );
            });
      shapes.push({
        ...line(points, "#36b48e"),
        strokeWidth: object.nodeStyles ? 6 : 1.3,
      });
    }
    shapes.push(
      {
        type: "rectangle",
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        roughness: 0,
        roundness: { type: 3 },
        fillStyle: "solid",
        backgroundColor: node.color,
        strokeColor: node.color,
        opacity: node.opacity,
        insertionText: index,
      },
      ...label(
        node.text,
        index,
        node.x,
        node.y,
        node.width,
        node.height,
        object.textColors?.[index] || "#ffffff",
      ),
    );
  });
  return shapes;
};

export const readInsertions = (api: FcboardImperativeAPI): InsertObject[] => {
  const document = classroomCommands.read("document") as
    | { ink: InkStroke[] }
    | undefined;
  const elements = document
    ? document.ink.map((stroke) => ({
        x: stroke.anchor?.x ?? stroke.points[0][0],
        y: stroke.anchor?.y ?? stroke.points[0][1],
        type: stroke.text
          ? "text"
          : ["mindmap", "table"].includes(stroke.insertion?.kind || "") &&
            stroke.points.length === 5
          ? "rectangle"
          : "line",
        text: stroke.text || "",
        originalText: stroke.originalText,
        strokeColor: stroke.color,
        width:
          ["mindmap", "table"].includes(stroke.insertion?.kind || "") &&
          !stroke.text &&
          stroke.points.length === 5
            ? Math.abs(stroke.points[1][0] - stroke.points[0][0])
            : undefined,
        height:
          ["mindmap", "table"].includes(stroke.insertion?.kind || "") &&
          !stroke.text &&
          stroke.points.length === 5
            ? Math.abs(stroke.points[2][1] - stroke.points[0][1])
            : undefined,
        customData: { fcInsertion: stroke.insertion },
        opacity: stroke.opacity,
      }))
    : api.getSceneElements();
  return readSceneInsertions(elements);
};

/** File export reads the requested page, independently of the active document. */
export const readSceneInsertions = (
  elements: readonly {
    type: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    text?: string;
    originalText?: string;
    strokeColor: string;
    opacity?: number;
    customData?: FcboardElement["customData"];
  }[],
): InsertObject[] => {
  const ids = new Set<string>();
  return elements
    .filter((element) => element.customData?.fcInsertion?.inkCell === undefined)
    .flatMap((element) => {
      const data = element.customData?.fcInsertion as
        | (InsertObject & {
            origin: { x: number; y: number };
            textIndex?: number;
          })
        | undefined;
      if (
        !data ||
        ids.has(data.id) ||
        !["table", "mindmap", "fourline"].includes(data.kind) ||
        !data.origin
      ) {
        return [];
      }
      try {
        let object = configureInsertion(data, data);
        object = {
          ...object,
          inkCell: undefined,
          position: {
            x: data.position.x + element.x - data.origin.x,
            y: data.position.y + element.y - data.origin.y,
          },
          cells: [...object.cells],
          textColors: Array.from(
            {
              length:
                object.kind === "mindmap"
                  ? object.outline.split("\n").length
                  : object.kind === "table"
                  ? object.rows * object.columns
                  : 1,
            },
            (_, index) => object.textColors?.[index] || "",
          ),
        };
        const outline = object.outline.split("\n");
        if (
          (object.kind === "table" || object.kind === "fourline") &&
          element.type === "rectangle"
        ) {
          object.position = { x: element.x, y: element.y };
          object.width = element.width || object.width;
          object.height = element.height || object.height;
          if (object.kind === "fourline") {
            object.color =
              element.strokeColor === "transparent"
                ? object.color
                : element.strokeColor;
            object.opacity = element.opacity ?? object.opacity;
          }
        }
        if (object.kind === "mindmap") {
          object.nodePositions = mindMapNodes(object).map(({ x, y }) => ({
            x,
            y,
          }));
          for (const item of elements) {
            const meta = item.customData?.fcInsertion;
            if (
              item.type === "rectangle" &&
              meta?.id === object.id &&
              typeof meta.textIndex === "number"
            ) {
              object.nodePositions[meta.textIndex] = {
                x: item.x - object.position.x,
                y: item.y - object.position.y,
              };
              if (item.width && item.height) {
                if (object.nodeStyles?.[meta.textIndex]) {
                  object.nodeStyles[meta.textIndex] = {
                    ...object.nodeStyles[meta.textIndex],
                    width: item.width,
                    height: item.height,
                    color: /^#[\da-f]{6}$/i.test(item.strokeColor)
                      ? item.strokeColor
                      : object.nodeStyles[meta.textIndex].color,
                    opacity:
                      item.opacity ?? object.nodeStyles[meta.textIndex].opacity,
                  };
                } else {
                  object.nodeSize = { width: item.width, height: item.height };
                }
              }
            }
          }
        }
        const labels = new Map<
          number,
          { text: string; color: string; fragment: boolean }[]
        >();
        for (const item of elements) {
          const meta = item.customData?.fcInsertion;
          if (
            meta?.id !== data.id ||
            item.type !== "text" ||
            typeof meta.textIndex !== "number"
          ) {
            continue;
          }
          if (object.kind === "table") {
            object.cells[meta.textIndex] = item.originalText || item.text || "";
          }
          if (object.kind === "mindmap") {
            const current = labels.get(meta.textIndex) || [];
            const text = item.originalText || item.text || "";
            const fragment =
              typeof meta.labelPart === "number" &&
              typeof meta.labelText === "string";
            current.push({
              text:
                fragment && meta.labelText.trim() === text.trim()
                  ? meta.labelText
                  : text,
              color: item.strokeColor,
              fragment,
            });
            labels.set(meta.textIndex, current);
          }
          if (object.kind === "fourline") {
            const current = labels.get(0) || [];
            const text = item.originalText || item.text || "";
            const fragment =
              typeof meta.labelPart === "number" &&
              typeof meta.labelText === "string";
            current.push({
              text:
                fragment && meta.labelText.trim() === text.trim()
                  ? meta.labelText
                  : text,
              color: item.strokeColor,
              fragment,
            });
            labels.set(0, current);
          }
          object.textColors![meta.textIndex] = item.strokeColor;
        }
        if (object.kind !== "table") {
          object.textRuns = Array.from(
            { length: object.kind === "mindmap" ? outline.length : 1 },
            (_, index) => {
              const runs = labels.get(index) || [];
              const colored = runs.map((run, part) => ({
                text: (!run.fragment && part ? " " : "") + run.text,
                color: run.color,
              }));
              const text = colored
                .map((run) => run.text)
                .join("")
                .trim()
                .replace(/\s+/g, " ");
              if (object.kind === "mindmap") {
                outline[index] = `${
                  outline[index]?.match(/^\s*/)?.[0] || ""
                }${text}`;
              } else {
                object.text =
                  !colored.length && object.text === undefined
                    ? undefined
                    : text;
              }
              return colored;
            },
          );
        }
        object.outline = outline.join("\n");
        ids.add(data.id);
        return [object];
      } catch {
        return [];
      }
    });
};

export const renderInsertion = async (
  api: FcboardImperativeAPI,
  object: InsertObject,
  remember = true,
  transaction: {
    preview?: boolean;
    before?: InkStroke[];
    select?: boolean;
    exact?: boolean;
    preserveSelection?: boolean;
  } = {},
) => {
  object = configureInsertion(object, object);
  const existing = classroomCommands.has("document.insertion")
    ? []
    : api.getSceneElements();
  if (
    !transaction.exact &&
    !classroomCommands.has("document.insertion") &&
    !existing.some(
      (element) => element.customData?.fcInsertion?.id === object.id,
    )
  ) {
    const [left, top, right, bottom] = getCommonBounds(
      convertToFcboardElements(insertionShapes(object)),
    );
    const point = contentPosition(
      api,
      { x: object.position.x + left, y: object.position.y + top },
      { width: right - left, height: bottom - top },
    );
    object = { ...object, position: { x: point.x - left, y: point.y - top } };
  }
  const existingById = new Map(
    existing.map((element) => [element.id, element]),
  );
  const shapes = insertionShapes(object).map(
    ({ insertionText, ...shape }, index) => ({
      ...shape,
      id: insertionShapeId(object, { ...shape, insertionText }, index),
      x: object.position.x + (shape.x || 0),
      y: object.position.y + (shape.y || 0),
      groupIds: [object.id],
      version:
        (existingById.get(
          insertionShapeId(object, { ...shape, insertionText }, index),
        )?.version || 0) + 1,
      customData: {
        ...shape.customData,
        fcGenerated: true,
        fcInsertion: {
          ...object,
          ...shape.customData?.fcInsertion,
          origin: {
            x: object.position.x + (shape.x || 0),
            y: object.position.y + (shape.y || 0),
          },
          textIndex: insertionText,
        },
      },
    }),
  );
  if (classroomCommands.has("document.insertion")) {
    await classroomCommands.execute({
      name: "document.insertion",
      args: {
        id: object.id,
        shapes,
        remember,
        before: transaction.before,
        select: transaction.select,
        preserveSelection: transaction.preserveSelection,
      },
    });
    return;
  }
  const elements = convertToFcboardElements(shapes, {
    regenerateIds: false,
  });
  const context = existing.filter(
    (element) => api.getAppState().selectedElementIds[element.id],
  );
  const handwriting =
    object.kind === "table"
      ? carryBoardTableContents(existing, object)
      : existing.flatMap((element) => {
          const owner = element.customData?.fcInsertion;
          if (owner?.id !== object.id || owner.inkCell === undefined) {
            return [];
          }
          const x = element.x + object.position.x - owner.position.x;
          const y = element.y + object.position.y - owner.position.y;
          return [
            newElementWith(element, {
              x,
              y,
              customData: {
                ...element.customData,
                fcInsertion: {
                  ...owner,
                  ...object,
                  inkCell: owner.inkCell,
                  origin: { x, y },
                },
              },
            }),
          ];
        });
  const replacement = [...elements, ...handwriting];
  const oldTable =
    object.kind === "table"
      ? existing.filter(
          (element) => element.customData?.fcInsertion?.id === object.id,
        )
      : [];
  let nextScene = [
    ...existing.filter(
      (element) => element.customData?.fcInsertion?.id !== object.id,
    ),
    ...replacement,
  ];
  if (oldTable.length) {
    const byId = new Map(replacement.map((element) => [element.id, element]));
    const last = oldTable.at(-1)!.id;
    nextScene = existing.flatMap((element) => {
      if (element.customData?.fcInsertion?.id !== object.id) {
        return [element];
      }
      const next = byId.get(element.id);
      byId.delete(element.id);
      const kept = next ? [{ ...next, index: element.index }] : [];
      return element.id === last ? [...kept, ...byId.values()] : kept;
    });
  }
  const previousSelection = api.getAppState().selectedElementIds;
  const selectedTableText = oldTable.some(
    (part) => previousSelection[part.id] && part.type === "text",
  );
  const selectedReplacement = replacement.filter(
    (element) =>
      element.customData?.fcInsertion?.id === object.id ||
      (transaction.preserveSelection &&
        (previousSelection[element.id] ||
          (element.type === "text" && selectedTableText))),
  );
  const selectedOthers = transaction.preserveSelection
    ? existing.filter(
        (element) =>
          previousSelection[element.id] &&
          element.customData?.fcInsertion?.id !== object.id,
      )
    : [];
  api.updateScene({
    elements: nextScene,
    ...(transaction.select === false
      ? {}
      : {
          appState: objectSelection([
            ...selectedOthers,
            ...selectedReplacement,
          ]),
        }),
    captureUpdate: transaction.preview
      ? CaptureUpdateAction.EVENTUALLY
      : remember
      ? CaptureUpdateAction.IMMEDIATELY
      : CaptureUpdateAction.NEVER,
  });
  if (!transaction.preview && !transaction.exact) {
    revealNewContent(api, elements, context);
  }
};
