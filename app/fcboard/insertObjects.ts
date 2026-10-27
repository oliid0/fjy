import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import { pointFrom } from "@excalidraw/math";
import { randomId } from "@excalidraw/common";
import { getCommonBounds, newElementWith } from "@excalidraw/element";
import { t } from "@excalidraw/excalidraw/i18n";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element/transform";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { classroomCommands } from "./commands";
import { contentPosition, revealNewContent, objectSelection } from "./board";
import {
  insertionWritingTargets,
  insertionWritingText,
} from "./insertionWriting";

import type { InkStroke } from "./documents";

export type InsertKind = "table" | "mindmap" | "fourline";
export type InsertObject = {
  id: string;
  kind: InsertKind;
  position: { x: number; y: number };
  rows: number;
  columns: number;
  cells: string[];
  columnWidths?: number[];
  rowHeights?: number[];
  /** Raw handwriting belongs to a cell; it is never OCR-replaced. */
  inkCell?: number;
  nodePositions?: ({ x: number; y: number } | null)[];
  nodeSize?: { width: number; height: number };
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
  for (const [key, min, max] of [
    ["rows", 1, 12],
    ["columns", 1, 12],
    ["width", 80, 1600],
    ["height", 40, 1200],
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
  if (args.cells !== undefined) {
    if (
      !Array.isArray(args.cells) ||
      args.cells.length > 144 ||
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
      args.textColors.length > 144 ||
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
  if (next.kind === "table") {
    next.width = Math.max(next.width, next.columns * 48);
    next.height = Math.max(next.height, next.rows * 32);
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

type InsertShape = ExcalidrawElementSkeleton & { insertionText?: number };
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
export const trackOffsets = (sizes: readonly number[]) =>
  sizes.reduce<number[]>(
    (offsets, size) => [...offsets, offsets[offsets.length - 1] + size],
    [0],
  );
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
    return shape ? [{ ...shape, insertionText: index }] : [];
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
        backgroundColor: "#0ed49f",
        fillStyle: "solid",
        strokeColor: "transparent",
        roughness: 0,
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
        strokeColor: "#333333",
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
          "#333333",
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
          "#333333",
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
            strokeColor: "#333333",
            insertionText: index,
          });
        }
      }
    }
    return shapes;
  }
  const nodes = mindMapNodes(object);
  const nodeWidth = object.nodeSize?.width || 140;
  const nodeHeight = object.nodeSize?.height || 48;
  const gap = (nodeWidth * 24) / 140;
  const shapes: InsertShape[] = [];
  nodes.forEach((node, index) => {
    if (node.parent >= 0) {
      const parent = nodes[node.parent];
      shapes.push(
        line(
          [
            [parent.x + nodeWidth, parent.y + nodeHeight / 2],
            [parent.x + nodeWidth + gap, parent.y + nodeHeight / 2],
            [node.x - gap, node.y + nodeHeight / 2],
            [node.x, node.y + nodeHeight / 2],
          ],
          "#36b48e",
        ),
      );
    }
    shapes.push(
      {
        type: "rectangle",
        x: node.x,
        y: node.y,
        width: nodeWidth,
        height: nodeHeight,
        roughness: 0,
        roundness: { type: 3 },
        fillStyle: "solid",
        backgroundColor: "#36b48e",
        strokeColor: "#36b48e",
        insertionText: index,
      },
      ...label(
        node.text,
        index,
        node.x,
        node.y,
        nodeWidth,
        nodeHeight,
        object.textColors?.[index] || "#ffffff",
      ),
    );
  });
  return shapes;
};

export const readInsertions = (
  api: ExcalidrawImperativeAPI,
): InsertObject[] => {
  const document = classroomCommands.read("document") as
    | { ink: InkStroke[] }
    | undefined;
  const elements = document
    ? document.ink.map((stroke) => ({
        x: stroke.anchor?.x ?? stroke.points[0][0],
        y: stroke.anchor?.y ?? stroke.points[0][1],
        type: stroke.text
          ? "text"
          : stroke.insertion?.kind === "mindmap" && stroke.points.length === 5
          ? "rectangle"
          : "line",
        text: stroke.text || "",
        originalText: stroke.originalText,
        strokeColor: stroke.color,
        width:
          stroke.insertion?.kind === "mindmap" &&
          !stroke.text &&
          stroke.points.length === 5
            ? Math.abs(stroke.points[1][0] - stroke.points[0][0])
            : undefined,
        height:
          stroke.insertion?.kind === "mindmap" &&
          !stroke.text &&
          stroke.points.length === 5
            ? Math.abs(stroke.points[2][1] - stroke.points[0][1])
            : undefined,
        customData: { fcInsertion: stroke.insertion },
      }))
    : api.getSceneElements();
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
                object.nodeSize = { width: item.width, height: item.height };
              }
            }
          }
        }
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
            object.cells[meta.textIndex] = item.originalText || item.text;
          }
          if (object.kind === "mindmap") {
            outline[meta.textIndex] = `${
              outline[meta.textIndex]?.match(/^\s*/)?.[0] || ""
            }${item.originalText || item.text}`;
          }
          if (object.kind === "fourline") {
            object.text = item.originalText || item.text;
          }
          object.textColors![meta.textIndex] = item.strokeColor;
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
  api: ExcalidrawImperativeAPI,
  object: InsertObject,
  remember = true,
  transaction: {
    preview?: boolean;
    before?: InkStroke[];
    select?: boolean;
  } = {},
) => {
  object = configureInsertion(object, object);
  const existing = classroomCommands.has("document.insertion")
    ? []
    : api.getSceneElements();
  if (
    !classroomCommands.has("document.insertion") &&
    !existing.some(
      (element) => element.customData?.fcInsertion?.id === object.id,
    )
  ) {
    const [left, top, right, bottom] = getCommonBounds(
      convertToExcalidrawElements(insertionShapes(object)),
    );
    const point = contentPosition(
      api,
      { x: object.position.x + left, y: object.position.y + top },
      { width: right - left, height: bottom - top },
    );
    object = { ...object, position: { x: point.x - left, y: point.y - top } };
  }
  const shapes = insertionShapes(object).map(
    ({ insertionText, ...shape }, index) => ({
      ...shape,
      id: `${object.id}-${index}`,
      x: object.position.x + (shape.x || 0),
      y: object.position.y + (shape.y || 0),
      groupIds: [object.id],
      version:
        (existing.find((element) => element.id === `${object.id}-${index}`)
          ?.version || 0) + 1,
      customData: {
        fcGenerated: true,
        fcInsertion: {
          ...object,
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
      },
    });
    return;
  }
  const elements = convertToExcalidrawElements(shapes, {
    regenerateIds: false,
  });
  const context = existing.filter(
    (element) => api.getAppState().selectedElementIds[element.id],
  );
  const handwriting = existing.flatMap((element) => {
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
  api.updateScene({
    elements: [
      ...existing.filter(
        (element) => element.customData?.fcInsertion?.id !== object.id,
      ),
      ...elements,
      ...handwriting,
    ],
    ...(transaction.select === false
      ? {}
      : { appState: objectSelection([...elements, ...handwriting]) }),
    captureUpdate: transaction.preview
      ? CaptureUpdateAction.EVENTUALLY
      : remember
      ? CaptureUpdateAction.IMMEDIATELY
      : CaptureUpdateAction.NEVER,
  });
  if (!transaction.preview) {
    revealNewContent(api, elements, context);
  }
};
