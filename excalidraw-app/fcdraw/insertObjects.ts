import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import { pointFrom } from "@excalidraw/math";
import { randomId } from "@excalidraw/common";
import { getCommonBounds } from "@excalidraw/element";
import { t } from "@excalidraw/excalidraw/i18n";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element/transform";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { classroomCommands } from "./commands";
import { contentPosition, revealNewContent } from "./board";

import type { InkStroke } from "./documents";

export type InsertKind = "table" | "mindmap" | "fourline";
export type InsertObject = {
  id: string;
  kind: InsertKind;
  position: { x: number; y: number };
  rows: number;
  columns: number;
  cells: string[];
  outline: string;
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
        throw new Error(t("fcboard.插入对象参数 {{key}} 超出范围", { key }));
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
      throw new Error(t("fcboard.表格内容无效"));
    }
    next.cells = args.cells;
  }
  if (args.outline !== undefined) {
    if (
      typeof args.outline !== "string" ||
      !args.outline.trim() ||
      args.outline.length > 8000 ||
      args.outline.split("\n").length > 40
    ) {
      throw new Error(
        t("fcboard.思维导图大纲无效，请使用最多 40 行的缩进大纲"),
      );
    }
    next.outline = args.outline;
  }
  if (next.kind === "table") {
    next.width = Math.max(next.width, next.columns * 48);
    next.height = Math.max(next.height, next.rows * 32);
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
  outline: [
    t("fcboard.中心主题"),
    ...(["分支一", "分支二", "分支三"] as const).map(
      (label) => `  ${t(`fcboard.${label}`)}`,
    ),
  ].join("\n"),
  width: 360,
  height: kind === "table" ? 180 : 144,
});

type InsertShape = ExcalidrawElementSkeleton & { insertionText?: number };
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

export const insertionShapes = (object: InsertObject): InsertShape[] => {
  const { width, height } = object;
  if (object.kind === "fourline") {
    // HAlphabetObject draws four lines at fifths, inside a blue rounded panel.
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
    ];
  }
  if (object.kind === "table") {
    const cw = width / object.columns;
    const ch = height / object.rows;
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
            [0, row * ch],
            [width, row * ch],
          ],
          "#333333",
        ),
      );
    }
    for (let column = 1; column < object.columns; column++) {
      shapes.push(
        line(
          [
            [column * cw, 0],
            [column * cw, height],
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
            x: column * cw + 8,
            y: row * ch + 8,
            width: Math.max(20, cw - 16),
            text: object.cells[index],
            fontSize: Math.min(22, ch / 2),
            fontFamily: 2,
            strokeColor: "#333333",
            insertionText: index,
          });
        }
      }
    }
    return shapes;
  }
  const rows = object.outline.split("\n").filter((row) => row.trim());
  const nodes: {
    depth: number;
    parent: number;
    text: string;
    x: number;
    y: number;
  }[] = [];
  let leaf = 0;
  for (const row of rows) {
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
      x: depth * 190,
      y: leaf * 76,
    });
    leaf++;
  }
  // Place parents midway between their children. Links track the resulting node positions.
  for (let index = nodes.length - 1; index >= 0; index--) {
    const children = nodes.filter((node) => node.parent === index);
    if (children.length) {
      nodes[index].y = (children[0].y + children[children.length - 1].y) / 2;
    }
  }
  const shapes: InsertShape[] = [];
  nodes.forEach((node, index) => {
    if (node.parent >= 0) {
      const parent = nodes[node.parent];
      shapes.push(
        line(
          [
            [parent.x + 140, parent.y + 24],
            [parent.x + 164, parent.y + 24],
            [node.x - 24, node.y + 24],
            [node.x, node.y + 24],
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
        width: 140,
        height: 48,
        roughness: 0,
        roundness: { type: 3 },
        fillStyle: "solid",
        backgroundColor: "#36b48e",
        strokeColor: "#36b48e",
      },
      {
        type: "text",
        x: node.x + 8,
        y: node.y + 10,
        width: 124,
        text: node.text,
        fontSize: 20,
        fontFamily: 2,
        strokeColor: "#ffffff",
        insertionText: index,
      },
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
        type: stroke.text ? "text" : "line",
        text: stroke.text || "",
        customData: { fcInsertion: stroke.insertion },
      }))
    : api.getSceneElements();
  const ids = new Set<string>();
  return elements.flatMap((element) => {
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
        position: {
          x: data.position.x + element.x - data.origin.x,
          y: data.position.y + element.y - data.origin.y,
        },
        cells: [...object.cells],
      };
      const outline = object.outline.split("\n").filter((row) => row.trim());
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
          object.cells[meta.textIndex] = item.text;
        }
        if (object.kind === "mindmap") {
          outline[meta.textIndex] = `${
            outline[meta.textIndex]?.match(/^\s*/)?.[0] || ""
          }${item.text}`;
        }
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
) => {
  object = configureInsertion(object, object);
  const existing = api.getSceneElements();
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
      args: { id: object.id, shapes },
    });
    return;
  }
  const elements = convertToExcalidrawElements(shapes, {
    regenerateIds: false,
  });
  const context = existing.filter(
    (element) => api.getAppState().selectedElementIds[element.id],
  );
  api.updateScene({
    elements: [
      ...existing.filter(
        (element) => element.customData?.fcInsertion?.id !== object.id,
      ),
      ...elements,
    ],
    appState: {
      selectedElementIds: Object.fromEntries(
        elements.map((element) => [element.id, true]),
      ),
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  revealNewContent(api, elements, context);
};
