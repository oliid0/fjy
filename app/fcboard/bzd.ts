import { convertToFcboardElements, restoreElements } from "@fcboard/fcboard";
import { getCommonBounds, newFreeDrawElement } from "@fcboard/element";
import { pointFrom } from "@fcboard/math";

import type { FcboardElementSkeleton } from "@fcboard/element/transform";

import type { BinaryFiles, DataURL } from "@fcboard/fcboard/types";

import type { FcboardElement, FileId } from "@fcboard/element/types";

import { factoryFlatShape } from "./factoryShapeGeometry";
import {
  readBzdInsertions,
  bzdNodeAttributes,
  bzdInsertionNodeId,
} from "./bzdInsertions";
import { widgetShapes, widgetDefaults } from "./widgets";
import {
  readBzdMatrix,
  bzdBitmapNeedsWarp,
  bzdBitmapPlacement,
  bzdNormalizedImageMatrix,
} from "./bzdBitmap";
import {
  configureInsertion,
  insertionDefaults,
  insertionShapes,
  insertionShapeId,
  readSceneInsertions,
  tableTrackSizes,
  trackOffsets,
} from "./insertObjects";

import type { BzdMatrix } from "./bzdBitmap";
import type { InsertObject } from "./insertObjects";
import type { WidgetKind } from "./widgets";
import type { Board } from "./boards";

const MAX_FILE = 64 * 1024 * 1024;
const MAX_ELEMENTS = 50000;
const number = (value: string | null, fallback = 0) => {
  const result = value === null ? fallback : Number(value);
  if (!Number.isFinite(result) || Math.abs(result) > 1e7) {
    throw new Error("Invalid BZD coordinate");
  }
  return result;
};
const rgb = (color: string) => {
  const match = /^#([\da-f]{6}|[\da-f]{3})$/i.exec(color);
  const hex =
    match?.[1]?.length === 3
      ? match[1]
          .split("")
          .map((c) => c + c)
          .join("")
      : match?.[1] || "000000";
  return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
};
const signedColor = (color: string) => {
  const [r, g, b] = rgb(color);
  return 0xff000000 | (r << 16) | (g << 8) | b;
};
const hexColor = (value: number) =>
  `#${((value >>> 0) & 0xffffff).toString(16).padStart(6, "0")}`;
const attrs = (
  node: Element,
  values: Record<string, string | number | boolean>,
) => {
  for (const [key, value] of Object.entries(values)) {
    node.setAttribute(key, String(value));
  }
};
const pointsText = (points: readonly (readonly number[])[], triples = false) =>
  points.map(([x, y]) => `${x},${y},${triples ? "false," : ""}`).join("");
const absolutePoints = (element: FcboardElement): number[][] => {
  const [left, top, right, bottom] = getCommonBounds([
    { ...element, angle: 0 as FcboardElement["angle"] },
  ]);
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const rotate = ([x, y]: readonly number[]) => [
    cx +
      (x - cx) * Math.cos(element.angle) -
      (y - cy) * Math.sin(element.angle),
    cy +
      (x - cx) * Math.sin(element.angle) +
      (y - cy) * Math.cos(element.angle),
  ];
  if (
    element.type === "freedraw" ||
    element.type === "line" ||
    element.type === "arrow"
  ) {
    return element.points.map(([x, y]) =>
      rotate([element.x + x, element.y + y]),
    );
  }
  if (element.type === "ellipse") {
    return Array.from({ length: 65 }, (_, index) =>
      rotate([
        element.x +
          (element.width * (1 + Math.cos((index * Math.PI) / 32))) / 2,
        element.y +
          (element.height * (1 + Math.sin((index * Math.PI) / 32))) / 2,
      ]),
    );
  }
  if (element.type === "diamond") {
    return [
      [cx, top],
      [right, cy],
      [cx, bottom],
      [left, cy],
      [cx, top],
    ].map(rotate);
  }
  return [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
    [left, top],
  ].map(rotate);
};

/** HSaxSlideParser and HTableObject persist the complete, uneven grid. */
const tableLines = (table: InsertObject) => {
  const xs = trackOffsets(
    tableTrackSizes(table.columnWidths, table.columns, table.width),
  );
  const ys = trackOffsets(
    tableTrackSizes(table.rowHeights, table.rows, table.height),
  );
  const { x, y } = table.position;
  return {
    vertical: xs.map((dx) => [x + dx, y, x + dx, y + table.height]),
    horizontal: ys.map((dy) => [x, y + dy, x + table.width, y + dy]),
  };
};
const readTable = (
  object: Element,
  points: readonly number[][],
  color: string,
) => {
  const read = (key: string) =>
    (object.getAttribute(key) || "")
      .split(";")
      .filter((line) => line.trim())
      .map((line) => {
        const values = line.split(",").map((value) => number(value));
        if (values.length !== 4) {
          throw new Error("Invalid BZD table line");
        }
        return values;
      });
  const vertical = read("tableVerticalLines").sort((a, b) => a[0] - b[0]);
  const horizontal = read("tableHorizontalLines").sort((a, b) => a[1] - b[1]);
  const table = {
    ...insertionDefaults("table", { x: 0, y: 0 }),
    strokeWidth: Math.max(0.1, number(object.getAttribute("width"), 2)),
    opacity: Math.max(
      0,
      Math.min(100, number(object.getAttribute("nRGBA_A"), 255) / 2.55),
    ),
  };
  if (!vertical.length && !horizontal.length) {
    // Older files restore an equal grid from two corners and the stored counts.
    if (points.length < 2) {
      throw new Error("BZD table corners are missing");
    }
    const [first, last] = [points[0], points.at(-1)!];
    return configureInsertion(
      {
        ...table,
        position: {
          x: Math.min(first[0], last[0]),
          y: Math.min(first[1], last[1]),
        },
      },
      {
        width: Math.abs(last[0] - first[0]),
        height: Math.abs(last[1] - first[1]),
        columns: number(object.getAttribute("tableVerLine"), 3),
        rows: number(object.getAttribute("tableHorLine"), 3),
        color,
      },
    );
  }
  if (vertical.length < 2 || horizontal.length < 2) {
    throw new Error("BZD table edges are missing");
  }
  const left = vertical[0][0];
  const right = vertical.at(-1)![0];
  const top = horizontal[0][1];
  const bottom = horizontal.at(-1)![1];
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;
  if (
    vertical.some(
      ([x1, y1, x2, y2]) =>
        !near(x1, x2) ||
        !near(Math.min(y1, y2), top) ||
        !near(Math.max(y1, y2), bottom),
    ) ||
    horizontal.some(
      ([x1, y1, x2, y2]) =>
        !near(y1, y2) ||
        !near(Math.min(x1, x2), left) ||
        !near(Math.max(x1, x2), right),
    )
  ) {
    throw new Error("Unsupported BZD table geometry");
  }
  return configureInsertion(
    { ...table, position: { x: left, y: top } },
    {
      width: right - left,
      height: bottom - top,
      columns: vertical.length - 1,
      rows: horizontal.length - 1,
      columnWidths: vertical
        .slice(1)
        .map((line, i) => line[0] - vertical[i][0]),
      rowHeights: horizontal
        .slice(1)
        .map((line, i) => line[1] - horizontal[i][1]),
      color,
    },
  );
};

/** Restored handwriting stays editable and follows its cell when a track grows. */
const linkTableContents = (elements: FcboardElement[]) => {
  const tables = readSceneInsertions(elements)
    .filter((table) => table.kind === "table")
    .reverse()
    .map((table) => ({ table, ...tableLines(table) }));
  if (!tables.length) {
    return elements;
  }
  const cellAt = (
    edges: readonly number[][],
    coordinate: number,
    axis: number,
  ) => {
    let low = 0;
    let high = edges.length - 1;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (coordinate < edges[middle][axis]) {
        high = middle;
      } else {
        low = middle;
      }
    }
    return low;
  };
  return elements.map((element) => {
    if (
      !["text", "freedraw"].includes(element.type) ||
      element.customData?.fcInsertion
    ) {
      return element;
    }
    const [left, top, right, bottom] = getCommonBounds([element]);
    for (const { table, vertical, horizontal } of tables) {
      const { x, y } = table.position;
      if (
        left < x ||
        top < y ||
        right > x + table.width ||
        bottom > y + table.height
      ) {
        continue;
      }
      const column = cellAt(vertical, left, 0);
      const row = cellAt(horizontal, top, 1);
      if (right > vertical[column + 1][0] || bottom > horizontal[row + 1][1]) {
        continue;
      }
      return {
        ...element,
        groupIds: [...element.groupIds, table.id],
        customData: {
          ...element.customData,
          fcInsertion: {
            ...table,
            inkCell: row * table.columns + column,
            origin: { x: element.x, y: element.y },
          },
        },
      };
    }
    return element;
  });
};

/** HSaxSlideParser's real UTF-8 slide/object/lstPt schema; the extension retains AI metadata and binary files. */
export const serializeBzd = (boards: readonly Board[]): string => {
  if (!boards.length || boards.length > 100) {
    throw new Error("Choose 1–100 BZD pages");
  }
  const xml = document.implementation.createDocument(null, "bzd");
  let count = 0;
  for (const board of boards) {
    const slide = xml.createElement("slide");
    const elements = board.elements.filter((element) => !element.isDeleted);
    const insertions = readSceneInsertions(elements);
    const writing = new Map(
      insertions
        .filter((object) => object.kind !== "table")
        .map((object) => [object.id, object]),
    );
    const tables = new Map(
      insertions
        .filter((object) => object.kind === "table")
        .map((object) => [object.id, object]),
    );
    const writtenTables = new Set<string>();
    const writtenNodes = new Set<string>();
    if ((count += elements.length) > MAX_ELEMENTS) {
      throw new Error("Too many BZD objects");
    }
    attrs(slide, {
      nSlideId: board.id,
      name: board.name,
      zSlideType: `SLIDE_PATTERN_${
        board.view.whiteboardBackground?.pattern || 0
      }`,
      zSlideColor: signedColor(board.view.viewBackgroundColor || "#ffffff"),
      zSlideColorIndex: 0,
      ObjectCount: elements.length,
    });
    xml.documentElement.append(slide);
    for (const element of elements) {
      const owner = element.customData?.fcInsertion;
      const writingObject =
        owner?.inkCell === undefined ? writing.get(owner?.id) : undefined;
      if (writingObject && element.type !== "text") {
        if (
          element.type !== "rectangle" ||
          typeof owner.textIndex !== "number"
        ) {
          continue;
        }
        const index = owner.textIndex;
        const id =
          writingObject.kind === "fourline"
            ? writingObject.id
            : bzdInsertionNodeId(writingObject, index);
        if (writtenNodes.has(id)) {
          continue;
        }
        const object = xml.createElement("object");
        const node =
          writingObject.kind === "mindmap"
            ? bzdNodeAttributes(writingObject, index)
            : undefined;
        const [r, g, b] = rgb(node?.color || writingObject.color || "#0ed49f");
        attrs(object, {
          nId: id,
          eType: node ? "OBJECT_Note" : "OBJECT_ALPHABET",
          nRGBA_R: r,
          nRGBA_G: g,
          nRGBA_B: b,
          nRGBA_A: Math.round(
            (node?.opacity ?? writingObject.opacity ?? 100) * 2.55,
          ),
          width: element.strokeWidth,
        });
        if (node) {
          const { color, opacity, ...attributes } = node;
          attrs(object, attributes);
        } else {
          // HAlphabetObject is based on one fifth of the original 1920x1080 canvas.
          attrs(object, {
            matrix: `${writingObject.width / 384},0,${
              writingObject.position.x
            },0,${writingObject.height / 216},${
              writingObject.position.y
            },0,0,1`,
          });
        }
        object.append(xml.createElement("lstPt"));
        slide.append(object);
        writtenNodes.add(id);
        continue;
      }
      const table =
        owner?.inkCell === undefined && element.type !== "text"
          ? tables.get(owner?.id)
          : undefined;
      if (table && writtenTables.has(table.id)) {
        continue;
      }
      const object = xml.createElement("object");
      const [r, g, b] = rgb(element.strokeColor);
      const type = table
        ? "OBJECT_TABLE"
        : element.type === "text"
        ? "OBJECT_TEXT"
        : element.type === "image"
        ? "OBJECT_BITMAP"
        : "OBJECT_STROKE";
      attrs(object, {
        nId: element.id,
        eType: type,
        nRGBA_R: r,
        nRGBA_G: g,
        nRGBA_B: b,
        nRGBA_A: Math.round(element.opacity * 2.55),
        width: element.type === "text" ? element.fontSize : element.strokeWidth,
      });
      if (element.strokeStyle === "dashed") {
        object.setAttribute("dashedStroke", "true");
      }
      let points = absolutePoints(element);
      if (table) {
        writtenTables.add(table.id);
        const lines = tableLines(table);
        attrs(object, {
          nId: table.id,
          tableVerLine: table.columns,
          tableHorLine: table.rows,
          tableVerticalLines: `${lines.vertical
            .map((line) => line.join(","))
            .join(";")};`,
          tableHorizontalLines: `${lines.horizontal
            .map((line) => line.join(","))
            .join(";")};`,
        });
        points = [
          [table.position.x, table.position.y],
          [table.position.x + table.width, table.position.y + table.height],
        ];
      }
      if (element.type === "text") {
        object.setAttribute("text", element.originalText);
        points = [[element.x, element.y]];
        if (writingObject && typeof owner.textIndex === "number") {
          object.setAttribute(
            writingObject.kind === "mindmap" ? "mNoteId" : "alphabetId",
            writingObject.kind === "mindmap"
              ? bzdInsertionNodeId(writingObject, owner.textIndex)
              : writingObject.id,
          );
        }
      }
      if (element.type === "image") {
        if (!element.fileId || !board.files[element.fileId]) {
          throw new Error("BZD image data is missing");
        }
        attrs(object, {
          picUrl: `fcboard-asset:${element.fileId}`,
          matrix: bzdNormalizedImageMatrix(element).join(","),
          fcboardNormalizedImage: "true",
          photoRectLeft: 0,
          photoRectTop: 0,
          photoRectRight: 1,
          photoRectBottom: 1,
        });
        if (element.crop) {
          object.setAttribute("fcboardImageCrop", JSON.stringify(element.crop));
        }
      }
      const list = xml.createElement("lstPt");
      list.textContent = pointsText(points, element.type === "text");
      object.append(list);
      slide.append(object);
    }
    slide.setAttribute("ObjectCount", String(slide.children.length));
    // Unknown attributes/elements are ignored by the original SAX handler.
    // The native objects above remain readable without this lossless extension.
    const extension = xml.createElement("fcboard");
    extension.setAttribute("version", "1");
    extension.textContent = JSON.stringify({ ...board, elements });
    slide.append(extension);
  }
  const result = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(
    xml,
  )}`;
  if (result.length > MAX_FILE) {
    throw new Error("BZD file is too large");
  }
  return result;
};

const readPoints = (object: Element): [number, number][] => {
  const text = object.querySelector("lstPt")?.textContent || "";
  const stride = object.getAttribute("eType") === "OBJECT_TEXT" ? 3 : 2;
  const values = text.split(",").filter((value) => value.trim());
  if (values.length > 500000 * stride) {
    throw new Error("Too many BZD points");
  }
  const result: [number, number][] = [];
  for (let index = 0; index + 1 < values.length; index += stride) {
    result.push([number(values[index]), number(values[index + 1])]);
  }
  if (result.length > 500000) {
    throw new Error("Too many BZD points");
  }
  return result;
};
const bzdShapeKinds = [
  "circle",
  "ellipse",
  "rectangle",
  "triangle",
  "rightTriangle",
  "star",
  "arrow",
  "line",
  null,
  "trapezoid",
  "diamond",
  "sphere",
  "cube",
  "pyramid",
  "cone",
  "hemisphere",
  "cylinder",
  "frustum",
  "prism",
] as const;
export type BzdAssetLoader = (
  path: string,
  transform?: BzdMatrix,
) => Promise<{
  dataURL: DataURL;
  mimeType: BinaryFiles[string]["mimeType"];
  width?: number;
  height?: number;
  bounds?: { x: number; y: number; width: number; height: number };
}>;

export const parseBzd = async (
  text: string,
  loadAsset?: BzdAssetLoader,
): Promise<Board[]> => {
  if (
    !text.trim() ||
    text.length > MAX_FILE ||
    /<!DOCTYPE|<!ENTITY/i.test(text)
  ) {
    throw new Error("Invalid BZD file");
  }
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (
    xml.querySelector("parsererror") ||
    xml.documentElement.tagName !== "bzd"
  ) {
    throw new Error("Invalid BZD XML");
  }
  const slides = Array.from(xml.documentElement.children).filter(
    (node) => node.tagName === "slide",
  );
  if (!slides.length || slides.length > 100) {
    throw new Error("Invalid BZD pages");
  }
  const result: Board[] = [];
  let total = 0;
  let sceneTotal = 0;
  for (const slide of slides) {
    const extension = Array.from(slide.children).find(
      (node) =>
        node.tagName === "fcboard" && node.getAttribute("version") === "1",
    );
    if (extension) {
      const value = JSON.parse(extension.textContent || "null") as Board;
      if (
        !value ||
        !Array.isArray(value.elements) ||
        (total += value.elements.length) > MAX_ELEMENTS ||
        (sceneTotal += value.elements.length) > MAX_ELEMENTS ||
        !value.files ||
        typeof value.name !== "string" ||
        !value.view
      ) {
        throw new Error("Invalid Fcboard BZD page");
      }
      result.push({
        ...value,
        id: crypto.randomUUID(),
        elements: restoreElements(value.elements, null, {
          refreshDimensions: false,
          repairBindings: false,
        }),
        updated: Date.now(),
      });
      continue;
    }
    const objects = Array.from(slide.children).filter(
      (node) => node.tagName === "object",
    );
    if ((total += objects.length) > MAX_ELEMENTS) {
      throw new Error("Too many BZD objects");
    }
    const skeletons: FcboardElementSkeleton[] = [];
    const files: BinaryFiles = {};
    const writing = readBzdInsertions(objects);
    for (const object of objects) {
      if (writing.consumed.has(object)) {
        continue;
      }
      if (sceneTotal + skeletons.length > MAX_ELEMENTS) {
        throw new Error("Too many BZD objects");
      }
      const type = object.getAttribute("eType");
      const r = number(object.getAttribute("nRGBA_R"));
      const g = number(object.getAttribute("nRGBA_G"));
      const b = number(object.getAttribute("nRGBA_B"));
      const color = hexColor((r << 16) | (g << 8) | b);
      const opacity = Math.max(
        0,
        Math.min(100, number(object.getAttribute("nRGBA_A"), 255) / 2.55),
      );
      const width = Math.max(0.1, number(object.getAttribute("width"), 2));
      const points = readPoints(object);
      const native = { fcBzd: new XMLSerializer().serializeToString(object) };
      const style = {
        strokeColor: color,
        opacity,
        strokeWidth: width,
        roughness: 0,
        customData: native,
      };
      if (type === "OBJECT_TEXT") {
        const [x, y] = points[0] || [0, 0];
        skeletons.push({
          type: "text",
          x,
          y,
          text: object.getAttribute("text") || "",
          fontSize: width,
          ...style,
        });
        continue;
      }
      if (type === "OBJECT_BITMAP") {
        const path = object.getAttribute("picUrl");
        if (!path || !loadAsset) {
          throw new Error(
            "This BZD references external pictures. Open it on the Android board with its image files available.",
          );
        }
        const matrix = readBzdMatrix(object.getAttribute("matrix"));
        const warp = bzdBitmapNeedsWarp(matrix);
        const asset = await loadAsset(path, warp ? matrix : undefined);
        const fileId = crypto.randomUUID() as FileId;
        files[fileId] = { ...asset, id: fileId, created: Date.now() };
        const left = number(
          object.getAttribute("photoRectLeft"),
          points[0]?.[0] || 0,
        );
        const top = number(
          object.getAttribute("photoRectTop"),
          points[0]?.[1] || 0,
        );
        const right = number(
          object.getAttribute("photoRectRight"),
          points[1]?.[0] || left + 200,
        );
        const bottom = number(
          object.getAttribute("photoRectBottom"),
          points[1]?.[1] || top + 200,
        );
        const naturalWidth = asset.width ?? right - left;
        const naturalHeight = asset.height ?? bottom - top;
        let placement;
        if (warp) {
          const bounds = asset.bounds;
          if (
            !bounds ||
            [bounds.x, bounds.y, bounds.width, bounds.height].some(
              (value) => !Number.isFinite(value) || Math.abs(value) > 1e7,
            ) ||
            bounds.width <= 0 ||
            bounds.height <= 0
          ) {
            throw new Error(
              "This BZD bitmap requires native matrix conversion",
            );
          }
          placement = bounds;
        } else {
          placement = bzdBitmapPlacement(matrix, naturalWidth, naturalHeight);
        }
        skeletons.push({
          type: "image",
          ...placement,
          fileId,
          ...style,
          // Original HBitmapObject.doDraw uses a null Paint, ignoring nRGBA_A.
          opacity: 100,
        });
        continue;
      }
      if (type === "OBJECT_SHAPE" && points.length >= 2) {
        const kind = bzdShapeKinds[number(object.getAttribute("shapeType"))];
        if (!kind) {
          throw new Error("Unsupported native BZD shape");
        }
        const [start, end] = [points[0], points.at(-1)!];
        if (
          [
            "cube",
            "sphere",
            "cylinder",
            "cone",
            "pyramid",
            "hemisphere",
            "frustum",
            "prism",
          ].includes(kind)
        ) {
          const params = widgetDefaults();
          params.solid.stroke = color;
          params.strokeWidth = width;
          params.opacity = opacity;
          const shapes = widgetShapes({
            id: crypto.randomUUID(),
            kind: kind as WidgetKind,
            params,
            position: { x: start[0], y: start[1] },
          });
          const bounds = getCommonBounds(convertToFcboardElements(shapes));
          const sx =
            Math.max(1, Math.abs(end[0] - start[0])) /
            Math.max(1, bounds[2] - bounds[0]);
          const sy =
            Math.max(1, Math.abs(end[1] - start[1])) /
            Math.max(1, bounds[3] - bounds[1]);
          for (const shape of shapes) {
            skeletons.push({
              ...shape,
              x: Math.min(start[0], end[0]) + ((shape.x || 0) - bounds[0]) * sx,
              y: Math.min(start[1], end[1]) + ((shape.y || 0) - bounds[1]) * sy,
              width: shape.width === undefined ? undefined : shape.width * sx,
              height:
                shape.height === undefined ? undefined : shape.height * sy,
              ...("points" in shape && shape.points
                ? {
                    points: shape.points.map(([x, y]) =>
                      pointFrom(x * sx, y * sy),
                    ),
                  }
                : {}),
              ...style,
            } as FcboardElementSkeleton);
          }
        } else {
          skeletons.push(
            ...factoryFlatShape(kind, start, end, {
              color,
              width,
              opacity,
              fill: false,
            }),
          );
        }
        continue;
      }
      if (type === "OBJECT_TABLE") {
        const table = readTable(object, points, color);
        if (
          sceneTotal + skeletons.length + table.rows + table.columns - 1 >
          MAX_ELEMENTS
        ) {
          throw new Error("Too many BZD objects");
        }
        for (const [index, { insertionText, ...shape }] of insertionShapes(
          table,
        ).entries()) {
          const x = table.position.x + (shape.x || 0);
          const y = table.position.y + (shape.y || 0);
          skeletons.push({
            ...shape,
            id: insertionShapeId(table, { ...shape, insertionText }, index),
            x,
            y,
            groupIds: [table.id],
            ...style,
            customData: {
              ...native,
              fcInsertion: {
                ...table,
                origin: { x, y },
                textIndex: insertionText,
              },
            },
          } as FcboardElementSkeleton);
        }
        continue;
      }
      if (type === "OBJECT_BZ_STROKE" || type === "OBJECT_THICK_BZ_STROKE") {
        const ovals = object.querySelector("ovals")?.textContent || "";
        for (const entry of ovals.split("#").filter(Boolean)) {
          const values = entry.split(",").map((v) => number(v));
          for (let index = 2; index + 3 < values.length; index += 4) {
            if (sceneTotal + skeletons.length >= MAX_ELEMENTS) {
              throw new Error("Too many BZD objects");
            }
            const [l, t, r, b] = values.slice(index, index + 4);
            skeletons.push({
              type: "ellipse",
              x: l,
              y: t,
              width: r - l,
              height: b - t,
              ...style,
              strokeWidth: 0,
              backgroundColor: color,
              fillStyle: "solid",
            });
          }
        }
        continue;
      }
      if (
        ![
          "OBJECT_STROKE",
          "OBJECT_HIGHLIGHT_STROKE",
          "OBJECT_BRUSH",
          "OBJECT_ERASER",
          "OBJECT_SCRIBE_ERASER",
        ].includes(type || "")
      ) {
        throw new Error(`Unsupported BZD object: ${type}`);
      }
      if (type === "OBJECT_ERASER" || type === "OBJECT_SCRIBE_ERASER") {
        throw new Error(
          "Legacy BZD eraser masks require conversion on the original board",
        );
      }
      if (points.length) {
        const [x, y] = points[0];
        skeletons.push(
          newFreeDrawElement({
            type: "freedraw",
            x,
            y,
            points: points.map(([px, py]) => pointFrom(px - x, py - y)),
            simulatePressure: true,
            ...style,
            ...(type === "OBJECT_HIGHLIGHT_STROKE"
              ? { opacity: Math.min(opacity, 50) }
              : {}),
            ...(object.getAttribute("dashedStroke") === "true"
              ? { strokeStyle: "dashed" as const }
              : {}),
          }),
        );
      }
    }
    for (const insertion of writing.insertions) {
      for (const [index, { insertionText, ...shape }] of insertionShapes(
        insertion,
      ).entries()) {
        if (sceneTotal + skeletons.length >= MAX_ELEMENTS) {
          throw new Error("Too many BZD objects");
        }
        const x = insertion.position.x + (shape.x || 0);
        const y = insertion.position.y + (shape.y || 0);
        skeletons.push({
          ...shape,
          id: insertionShapeId(insertion, { ...shape, insertionText }, index),
          x,
          y,
          groupIds: [insertion.id],
          customData: {
            ...shape.customData,
            fcInsertion: {
              ...insertion,
              ...shape.customData?.fcInsertion,
              origin: { x, y },
              textIndex: insertionText,
            },
          },
        } as FcboardElementSkeleton);
      }
    }
    if ((sceneTotal += skeletons.length) > MAX_ELEMENTS) {
      throw new Error("Too many BZD objects");
    }
    const pattern = number(
      slide.getAttribute("zSlideType")?.replace("SLIDE_PATTERN_", "") || null,
    );
    result.push({
      id: crypto.randomUUID(),
      name: slide.getAttribute("name") || "Whiteboard",
      elements: linkTableContents(
        convertToFcboardElements(skeletons, { regenerateIds: false }),
      ),
      files,
      view: {
        scrollX: 0,
        scrollY: 0,
        zoom: { value: 1 as Board["view"]["zoom"]["value"] },
        viewBackgroundColor: hexColor(
          Number(slide.getAttribute("zSlideColor") ?? -1),
        ),
        ...(pattern > 0 && pattern <= 13
          ? { whiteboardBackground: { pattern, width: 1920, height: 1080 } }
          : {}),
      },
      updated: Date.now(),
    });
  }
  return result;
};
