import { t } from "@fcboard/fcboard/i18n";
import { createStore, get, set } from "idb-keyval";
import { getDataURL } from "@fcboard/fcboard/data/blob";
import { eraseStroke } from "@fcboard/fcboard/eraser/stroke";
import { FONT_FAMILY, getFontString } from "@fcboard/common";
import { convertToFcboardElements } from "@fcboard/fcboard";
import { getElementLineSegments } from "@fcboard/element";
import { getLassoSelectedElementIds } from "@fcboard/fcboard/lasso/utils";
import { regionPath } from "@fcboard/fcboard/lasso/region";
import { pointFrom, polygonIncludesPointNonZero } from "@fcboard/math";
import { measureText } from "@fcboard/element/textMeasurements";

import { rainbowInkStops } from "@fcboard/element/rainbowInk";
import { factoryNibControls } from "@fcboard/element/factoryNib";

import type { FcboardElementSkeleton } from "@fcboard/element/transform";
import type { FontFamilyValues } from "@fcboard/element/types";
import type { FactoryInkData } from "@fcboard/element/factoryInk";
import type { RegionBounds } from "@fcboard/fcboard/lasso/region";
import type { InteractiveResource } from "@fcboard/fcboard/interactiveHtml";

import {
  documentInkElement,
  documentStrokeGeometry,
  documentStrokeSamples,
} from "./documentInk";

import type { Widget } from "./widgets";
import type { InsertObject } from "./insertObjects";
import type { Plot } from "./math";
import type { LanguageInk } from "./languageStudy";

export const DOCUMENT_ACCEPT =
  ".ppt,.pptx,.pps,.ppsx,.pdf,.doc,.docx,.xls,.xlsx,.csv,.odt,.ods,.odp,.rtf,.txt,.png,.jpg,.jpeg,.webp,.gif";
export type InkStroke = {
  id: string;
  color: string;
  width: number;
  opacity?: number;
  points: [number, number][];
  pressures?: number[];
  simulatePressure?: boolean;
  fcInk?: FactoryInkData;
  fill?: string;
  strokeStyle?: "solid" | "dashed" | "dotted";
  anchor?: { x: number; y: number };
  text?: string;
  fontSize?: number;
  fontFamily?: FontFamilyValues;
  lineHeight?: number;
  originalText?: string;
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
  resource?: InteractiveResource & { width: number; height: number };
  lesson?: string;
  commandId?: string;
  annotation?: boolean;
  questionInput?: boolean;
  language?: LanguageInk;
  questionAnswer?: { owner: string; ids: string[]; folded?: InkStroke[] };
  widget?: Widget & { origin: { x: number; y: number } };
  insertion?: InsertObject & {
    origin: { x: number; y: number };
    textIndex?: number;
    labelPart?: number;
    labelText?: string;
  };
  plot?: {
    id: string;
    plot: Plot;
    position: { x: number; y: number };
    origin: { x: number; y: number };
  };
};
export type DocumentInk = Record<number, InkStroke[]>;

const documentCompositeGroup = (stroke: InkStroke) =>
  stroke.widget
    ? `widget:${stroke.widget.id}`
    : stroke.insertion
    ? `insertion:${stroke.insertion.id}`
    : stroke.plot
    ? `plot:${stroke.plot.id}`
    : stroke.language
    ? `language:${stroke.language.group}`
    : undefined;

/** A recognition result belongs to these exact, still-visible trajectories. */
export const documentSourceSignature = (strokes: readonly InkStroke[]) =>
  JSON.stringify(strokes);

/** Courseware uses the same swept eraser geometry as the main whiteboard. */
export const eraseDocumentInk = (
  strokes: InkStroke[],
  from: [number, number],
  to: [number, number],
  width: number,
  height: number,
) => {
  let changed = false;
  const next = strokes.flatMap((stroke) => {
    if (stroke.text || stroke.image || stroke.widget || stroke.resource) {
      return [stroke];
    }
    const element = documentInkElement(stroke);
    const parts = eraseStroke(
      element,
      { x: from[0], y: from[1] },
      { x: to[0], y: to[1] },
      width,
      height,
    );
    if (!parts) {
      return [stroke];
    }
    changed = true;
    return parts.map((part, index) => ({
      ...stroke,
      id: index ? part.id : stroke.id,
      points: part.points.map(([x, y]): [number, number] => [
        part.x + x,
        part.y + y,
      ]),
      ...(stroke.fcInk
        ? { fcInk: part.customData?.fcInk, pressures: [...part.pressures] }
        : {}),
    }));
  });
  return changed ? next : strokes;
};

/** Object erasing shares the board's swept hit geometry, then removes the composite. */
export const eraseDocumentObjects = (
  strokes: InkStroke[],
  from: [number, number],
  to: [number, number],
  width: number,
  height: number,
) => {
  const group = (stroke: InkStroke) =>
    stroke.widget
      ? `widget:${stroke.widget.id}`
      : stroke.insertion
      ? `insertion:${stroke.insertion.id}`
      : stroke.plot
      ? `plot:${stroke.plot.id}`
      : stroke.language
      ? `language:${stroke.language.group}`
      : undefined;
  const hit = new Set<string>();
  const groups = new Set<string>();
  for (const stroke of strokes) {
    let element = documentInkElement(stroke);
    let inside = false;
    if (stroke.text || stroke.image || stroke.resource) {
      const { left, top, right, bottom } = documentStrokeBounds(stroke);
      inside = [from, to].some(
        ([x, y]) => x >= left && x <= right && y >= top && y <= bottom,
      );
      element = documentInkElement({
        ...stroke,
        fcInk: undefined,
        width: 0,
        points: [
          [left, top],
          [right, top],
          [right, bottom],
          [left, bottom],
          [left, top],
        ],
      });
    } else if (
      stroke.fill &&
      stroke.fill !== "transparent" &&
      stroke.fill !== "none"
    ) {
      inside = [from, to].some((point) =>
        polygonIncludesPointNonZero(point, stroke.points),
      );
    }
    if (
      inside ||
      eraseStroke(
        element,
        { x: from[0], y: from[1] },
        { x: to[0], y: to[1] },
        width,
        height,
      )
    ) {
      hit.add(stroke.id);
      const id = group(stroke);
      if (id) {
        groups.add(id);
      }
    }
  }
  return hit.size
    ? strokes.filter(
        (stroke) => !hit.has(stroke.id) && !groups.has(group(stroke) || ""),
      )
    : strokes;
};
const storage = createStore("fcboard-documents", "documents");
export const documentKey = async (file: File) => {
  const bytes = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
};
export const loadInk = async (key: string) =>
  (await get<DocumentInk>(`ink:${key}`, storage)) || {};
export const saveInk = (key: string, value: DocumentInk) =>
  set(`ink:${key}`, value, storage);

export class OfficeReader {
  private worker: Worker;
  private id = 0;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  constructor() {
    this.worker = new Worker(new URL("./office.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = ({ data }) => {
      const task = this.pending.get(data.id);
      this.pending.delete(data.id);
      if (data.error) {
        const message =
          data.error === "OFFICE_DOCUMENT_ENCRYPTED"
            ? t("fcboard.this_file_is_encrypted_use_an_unencrypted_document")
            : data.error === "OFFICE_DOCUMENT_NOT_OPEN"
            ? t("fcboard.no_document_is_open")
            : data.error;
        task?.reject(new Error(message));
      } else {
        task?.resolve(data.value);
      }
    };
    this.worker.onerror = () => {
      this.pending.forEach((task) =>
        task.reject(
          new Error(
            t("fcboard.document_engine_failed_to_start_open_the_file_again"),
          ),
        ),
      );
      this.pending.clear();
    };
  }
  private request<T>(
    type: string,
    value: Record<string, unknown> = {},
  ): Promise<T> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (result) => resolve(result as T),
        reject,
      });
      this.worker.postMessage({ id, type, ...value });
    });
  }
  open(file: File, bytes: ArrayBuffer) {
    return this.request<{ index: number; name: string }[]>("open", {
      bytes,
      name: file.name,
    });
  }
  render(page: number) {
    return this.request<string>("render", { page });
  }
  close() {
    this.worker.terminate();
    this.pending.forEach((task) =>
      task.reject(new DOMException("Document closed", "AbortError")),
    );
    this.pending.clear();
  }
}

export const htmlText = (html: string) => {
  const document = new DOMParser().parseFromString(html, "text/html");
  document
    .querySelectorAll("script,style,noscript")
    .forEach((element) => element.remove());
  return (document.body.textContent || "").replace(/[\t ]+/g, " ").trim();
};

export const documentStrokeBounds = (stroke: InkStroke) => {
  const nib = stroke.fcInk?.nib
    ? factoryNibControls(documentInkElement(stroke))
    : undefined;
  const points = nib ? [...stroke.points, ...nib] : stroke.points;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  if (stroke.text) {
    const font = getFontString({
      fontSize: stroke.fontSize || 26,
      fontFamily: stroke.fontFamily || FONT_FAMILY.Helvetica,
    });
    const metrics = measureText(
      stroke.text,
      font,
      (stroke.lineHeight || 1.3) as Parameters<typeof measureText>[2],
    );
    return {
      left,
      top,
      right: left + metrics.width,
      bottom: top + metrics.height,
    };
  }
  return {
    left,
    top,
    right: stroke.resource
      ? left + stroke.resource.width
      : stroke.image
      ? left + (stroke.imageWidth || 120)
      : Math.max(...xs),
    bottom: stroke.resource
      ? top + stroke.resource.height
      : stroke.image
      ? top + (stroke.imageHeight || 40)
      : Math.max(...ys),
  };
};

/** Select the closed path's actual region, as SelectCacheLayer.computeRectFRegion does. */
export const selectDocumentLasso = (
  strokes: InkStroke[],
  path: [number, number][],
) => {
  if (path.length < 3) {
    const hit = strokes
      .filter((stroke) => path[0] && hitStroke(stroke, path[0]))
      .map((stroke) => stroke.id);
    const groups = new Set(
      strokes
        .filter((stroke) => hit.includes(stroke.id))
        .map(documentCompositeGroup)
        .filter(Boolean),
    );
    return strokes
      .filter(
        (stroke) =>
          hit.includes(stroke.id) || groups.has(documentCompositeGroup(stroke)),
      )
      .map((stroke) => stroke.id);
  }
  const elements = strokes.map((stroke) => {
    if (!stroke.text && !stroke.image && !stroke.resource) {
      return documentInkElement(stroke);
    }
    const bounds = documentStrokeBounds(stroke);
    return convertToFcboardElements(
      [
        {
          type: "rectangle",
          id: stroke.id,
          x: bounds.left,
          y: bounds.top,
          width: bounds.right - bounds.left,
          height: bounds.bottom - bounds.top,
        },
      ],
      { regenerateIds: false },
    )[0];
  });
  const elementsMap = new Map(elements.map((element) => [element.id, element]));
  const selected = getLassoSelectedElementIds({
    lassoPath: path.map(([x, y]) => pointFrom(x, y)),
    elements,
    elementsMap,
    elementsSegments: new Map(
      elements.map((element) => [
        element.id,
        getElementLineSegments(element, elementsMap),
      ]),
    ),
    enclosedElements: new Set(),
    intersectedElements: new Set(),
  }).selectedElementIds;
  const groups = new Set(
    strokes
      .filter((stroke) => selected.includes(stroke.id))
      .map(documentCompositeGroup)
      .filter(Boolean),
  );
  return strokes
    .filter(
      (stroke) =>
        selected.includes(stroke.id) ||
        groups.has(documentCompositeGroup(stroke)),
    )
    .map((stroke) => stroke.id);
};

export const selectDocumentRegion = (
  strokes: InkStroke[],
  bounds: RegionBounds,
) => selectDocumentLasso(strokes, regionPath(bounds));

export const moveDocumentStroke = (
  stroke: InkStroke,
  dx: number,
  dy: number,
): InkStroke => {
  const moved = (point: { x: number; y: number }) => ({
    x: point.x + dx,
    y: point.y + dy,
  });
  return {
    ...stroke,
    points: stroke.points.map(([x, y]) => [x + dx, y + dy]),
    anchor: stroke.anchor ? moved(stroke.anchor) : undefined,
    widget: stroke.widget
      ? { ...stroke.widget, origin: moved(stroke.widget.origin) }
      : undefined,
    insertion: stroke.insertion
      ? { ...stroke.insertion, origin: moved(stroke.insertion.origin) }
      : undefined,
    plot: stroke.plot
      ? {
          ...stroke.plot,
          position: moved(stroke.plot.position),
          origin: moved(stroke.plot.origin),
        }
      : undefined,
    fcInk: stroke.fcInk?.rainbow
      ? {
          ...stroke.fcInk,
          rainbow: { ...stroke.fcInk.rainbow, x: stroke.fcInk.rainbow.x + dx },
        }
      : stroke.fcInk,
  };
};

/** Scale an editable courseware object without losing its semantic anchors. */
export const scaleDocumentStroke = (
  stroke: InkStroke,
  anchor: { x: number; y: number },
  scale: number,
): InkStroke => {
  const transform = (point: { x: number; y: number }) => ({
    x: anchor.x + (point.x - anchor.x) * scale,
    y: anchor.y + (point.y - anchor.y) * scale,
  });
  return {
    ...stroke,
    points: stroke.points.map(([x, y]) => {
      const point = transform({ x, y });
      return [point.x, point.y];
    }),
    width: stroke.width * scale,
    anchor: stroke.anchor ? transform(stroke.anchor) : undefined,
    fontSize: stroke.fontSize ? stroke.fontSize * scale : undefined,
    imageWidth: stroke.imageWidth ? stroke.imageWidth * scale : undefined,
    imageHeight: stroke.imageHeight ? stroke.imageHeight * scale : undefined,
    resource: stroke.resource
      ? {
          ...stroke.resource,
          width: stroke.resource.width * scale,
          height: stroke.resource.height * scale,
        }
      : undefined,
    widget: stroke.widget
      ? {
          ...stroke.widget,
          position: transform(stroke.widget.position),
          origin: transform(stroke.widget.origin),
          params: {
            ...stroke.widget.params,
            size: stroke.widget.params.size * scale,
          },
        }
      : undefined,
    insertion: stroke.insertion
      ? {
          ...stroke.insertion,
          position: transform(stroke.insertion.position),
          origin: transform(stroke.insertion.origin),
          width: stroke.insertion.width * scale,
          height: stroke.insertion.height * scale,
          nodeSize: stroke.insertion.nodeSize
            ? {
                width: stroke.insertion.nodeSize.width * scale,
                height: stroke.insertion.nodeSize.height * scale,
              }
            : undefined,
          nodePositions: stroke.insertion.nodePositions?.map(
            (point) => point && { x: point.x * scale, y: point.y * scale },
          ),
          nodeStyles: stroke.insertion.nodeStyles?.map((style) => ({
            ...style,
            width: style.width * scale,
            height: style.height * scale,
          })),
        }
      : undefined,
    plot: stroke.plot
      ? {
          ...stroke.plot,
          position: transform(stroke.plot.position),
          origin: transform(stroke.plot.origin),
        }
      : undefined,
    fcInk: stroke.fcInk
      ? {
          ...stroke.fcInk,
          unit:
            (Number.isFinite(stroke.fcInk.unit) && stroke.fcInk.unit > 0
              ? stroke.fcInk.unit
              : 1) * scale,
          ...(stroke.fcInk.dashOffset !== undefined
            ? { dashOffset: stroke.fcInk.dashOffset * scale }
            : {}),
          ...(stroke.fcInk.rainbow
            ? {
                rainbow: {
                  x: transform({ x: stroke.fcInk.rainbow.x, y: 0 }).x,
                  width: stroke.fcInk.rainbow.width * scale,
                },
              }
            : {}),
        }
      : undefined,
    ...(stroke.questionAnswer?.folded
      ? {
          questionAnswer: {
            ...stroke.questionAnswer,
            folded: stroke.questionAnswer.folded.map((part) =>
              scaleDocumentStroke(part, anchor, scale),
            ),
          },
        }
      : {}),
  };
};

export const hitStroke = (
  stroke: InkStroke,
  point: [number, number],
  radius = 14,
) => {
  if (stroke.text || stroke.image || stroke.resource) {
    const { left: x, top: y, right, bottom } = documentStrokeBounds(stroke);
    return (
      point[0] > x - radius &&
      point[0] < right + radius &&
      point[1] > y - radius &&
      point[1] < bottom + radius
    );
  }
  const samples = documentStrokeSamples(stroke);
  return samples.some((end, index) => {
    const start = samples[Math.max(0, index - 1)];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const t = Math.max(
      0,
      Math.min(
        1,
        ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) /
          (dx * dx + dy * dy || 1),
      ),
    );
    return (
      Math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dy) <=
      radius + stroke.width
    );
  });
};

export const shapeInk = (
  shape: FcboardElementSkeleton,
  lesson: string,
  image?: string,
): InkStroke => {
  if (!shape.id || !Number.isFinite(shape.x) || !Number.isFinite(shape.y)) {
    throw new Error(t("fcboard.invalid_annotation_coordinates"));
  }
  const x = shape.x || 0;
  const y = shape.y || 0;
  let points: [number, number][] = [[x, y]];
  if (shape.type === "freedraw") {
    points = shape.points.map(([a, b]) => [x + a, y + b]);
  } else if (shape.type === "line" || shape.type === "arrow") {
    points = (
      shape.points || [
        [0, 0],
        [shape.width || 0, shape.height || 0],
      ]
    ).map(([a, b]) => [x + a, y + b]);
    if (shape.type === "arrow" && points.length > 1) {
      const end = points[points.length - 1];
      const before = points[points.length - 2];
      const angle = Math.atan2(end[1] - before[1], end[0] - before[0]);
      points.push(
        [
          end[0] - Math.cos(angle - 0.5) * 14,
          end[1] - Math.sin(angle - 0.5) * 14,
        ],
        end,
        [
          end[0] - Math.cos(angle + 0.5) * 14,
          end[1] - Math.sin(angle + 0.5) * 14,
        ],
      );
    }
  } else if (shape.type === "ellipse") {
    const width = shape.width || 1;
    const height = shape.height || 1;
    points = Array.from({ length: 65 }, (_, index) => [
      x + width / 2 + (Math.cos((index / 64) * 2 * Math.PI) * width) / 2,
      y + height / 2 + (Math.sin((index / 64) * 2 * Math.PI) * height) / 2,
    ]);
  } else if (shape.type === "rectangle") {
    points = [
      [x, y],
      [x + (shape.width || 0), y],
      [x + (shape.width || 0), y + (shape.height || 0)],
      [x, y + (shape.height || 0)],
      [x, y],
    ];
  } else if (shape.type === "diamond") {
    const w = shape.width || 0;
    const h = shape.height || 0;
    points = [
      [x + w / 2, y],
      [x + w, y + h / 2],
      [x + w / 2, y + h],
      [x, y + h / 2],
      [x + w / 2, y],
    ];
  }
  return {
    id: shape.id,
    anchor: { x, y },
    points,
    width: shape.strokeWidth ?? 2,
    strokeStyle: shape.strokeStyle,
    fill:
      shape.backgroundColor && shape.backgroundColor !== "transparent"
        ? shape.backgroundColor
        : undefined,
    opacity: shape.opacity,
    color: shape.strokeColor || "#245bd6",
    lesson,
    commandId: shape.customData?.fcTutorId,
    ...(shape.type === "freedraw"
      ? {
          pressures: [...shape.pressures],
          simulatePressure: shape.simulatePressure,
          fcInk: shape.customData?.fcInk,
        }
      : {}),
    annotation: !!shape.customData?.fcAnnotation,
    language: shape.customData?.fcLanguage,
    ...(shape.customData?.fcQuestionInput ? { questionInput: true } : {}),
    widget: shape.customData?.fcWidget,
    insertion: shape.customData?.fcInsertion,
    plot: shape.customData?.fcPlot,
    text: shape.type === "text" ? shape.text : undefined,
    fontSize: shape.type === "text" ? shape.fontSize : undefined,
    fontFamily: shape.type === "text" ? shape.fontFamily : undefined,
    lineHeight: shape.type === "text" ? shape.lineHeight : undefined,
    originalText: shape.type === "text" ? shape.originalText : undefined,
    image: shape.type === "image" ? image : undefined,
    imageWidth: shape.type === "image" ? shape.width : undefined,
    imageHeight: shape.type === "image" ? shape.height : undefined,
    resource: shape.customData?.fcInteractiveResource
      ? {
          ...shape.customData.fcInteractiveResource,
          width: shape.width,
          height: shape.height,
        }
      : undefined,
  };
};

export const inkSnapshot = async (
  strokes: InkStroke[],
  height: number,
  background?: Blob,
  scroll = 0,
) => {
  const canvas = document.createElement("canvas");
  canvas.width = 1000;
  canvas.height = Math.max(1, Math.min(1600, Math.round(height)));
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error(t("fcboard.this_device_could_not_capture_the_document"));
  }
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const drawImage = async (
    source: string,
    x: number,
    y: number,
    width: number,
    size: number,
  ) => {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error(t("fcboard.could_not_read_document_image")));
      image.src = source;
    });
    context.drawImage(image, x, y, width, size);
  };
  if (background) {
    const url = URL.createObjectURL(background);
    try {
      await drawImage(url, 0, 0, 1000, canvas.height);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  context.translate(0, -scroll);
  for (const stroke of strokes) {
    context.globalAlpha = (stroke.opacity ?? 100) / 100;
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;
    context.lineWidth = stroke.width;
    context.lineCap = "round";
    context.lineJoin = "round";
    if (stroke.resource) {
      // Browser canvas cannot capture an opaque iframe. Preserve its title and extent;
      // native recording/snapshots capture the actual visible experiment.
      const bounds = documentStrokeBounds(stroke);
      context.strokeRect(
        bounds.left,
        bounds.top,
        stroke.resource.width,
        stroke.resource.height,
      );
      context.font = "18px sans-serif";
      context.fillText(
        stroke.resource.title,
        bounds.left + 12,
        bounds.top + 28,
        stroke.resource.width - 24,
      );
    } else if (stroke.image) {
      await drawImage(
        stroke.image,
        stroke.points[0][0],
        stroke.points[0][1],
        stroke.imageWidth || 120,
        stroke.imageHeight || 40,
      );
    } else if (stroke.text) {
      context.font = getFontString({
        fontSize: stroke.fontSize || 26,
        fontFamily: stroke.fontFamily || FONT_FAMILY.Helvetica,
      });
      context.textBaseline = "top";
      stroke.text
        .split("\n")
        .forEach((line, index) =>
          context.fillText(
            line,
            stroke.points[0][0],
            stroke.points[0][1] +
              index * (stroke.fontSize || 26) * (stroke.lineHeight || 1.3),
          ),
        );
    } else {
      const geometry = documentStrokeGeometry(stroke);
      const path = new Path2D(geometry.path);
      context.setLineDash(geometry.dashes || []);
      context.lineDashOffset = -geometry.dashOffset;
      if (stroke.fcInk?.pen === "rainbow") {
        const gradient = context.createLinearGradient(
          stroke.fcInk.rainbow?.x ?? 0,
          0,
          (stroke.fcInk.rainbow?.x ?? 0) +
            (stroke.fcInk.rainbow?.width ?? 1000),
          0,
        );
        rainbowInkStops.forEach(([offset, color]) =>
          gradient.addColorStop(offset, color),
        );
        context.strokeStyle = gradient;
      }
      if (geometry.filled || stroke.fill) {
        context.fillStyle = stroke.fill || stroke.color;
        context.fill(path);
      }
      if (!geometry.filled && stroke.width > 0) {
        context.stroke(path);
      }
      if (geometry.nib) {
        context.fillStyle = stroke.color;
        context.fill(new Path2D(geometry.nib));
      }
    }
  }
  return getDataURL(
    await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error(t("fcboard.could_not_capture_document"))),
        "image/png",
      ),
    ),
  );
};
