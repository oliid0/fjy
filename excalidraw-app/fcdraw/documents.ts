import { t } from "@excalidraw/excalidraw/i18n";
import { createStore, get, set } from "idb-keyval";
import { getDataURL } from "@excalidraw/excalidraw/data/blob";
import { newFreeDrawElement } from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";
import { eraseStroke } from "@excalidraw/excalidraw/eraser/stroke";
import { FONT_FAMILY, getFontString } from "@excalidraw/common";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element/transform";
import type { FontFamilyValues } from "@excalidraw/element/types";

import type { Widget } from "./widgets";
import type { InsertObject } from "./insertObjects";
import type { Plot } from "./math";

export const DOCUMENT_ACCEPT =
  ".ppt,.pptx,.pps,.ppsx,.pdf,.doc,.docx,.xls,.xlsx,.csv,.odt,.ods,.odp,.rtf,.txt,.png,.jpg,.jpeg,.webp,.gif";
export type InkStroke = {
  id: string;
  color: string;
  width: number;
  opacity?: number;
  points: [number, number][];
  anchor?: { x: number; y: number };
  text?: string;
  fontSize?: number;
  fontFamily?: FontFamilyValues;
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
  lesson?: string;
  commandId?: string;
  annotation?: boolean;
  widget?: Widget & { origin: { x: number; y: number } };
  insertion?: InsertObject & {
    origin: { x: number; y: number };
    textIndex?: number;
  };
  plot?: {
    id: string;
    plot: Plot;
    position: { x: number; y: number };
    origin: { x: number; y: number };
  };
};
export type DocumentInk = Record<number, InkStroke[]>;

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
    if (stroke.text || stroke.image || stroke.widget) {
      return [stroke];
    }
    const element = newFreeDrawElement({
      type: "freedraw",
      x: 0,
      y: 0,
      points: stroke.points.map(([x, y]) => pointFrom(x, y)),
      simulatePressure: true,
      strokeWidth: stroke.width,
      customData: { fcInk: { pen: "hard" } },
    });
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
    }));
  });
  return changed ? next : strokes;
};
const storage = createStore("fcboard-documents", "documents");
const legacyStorage = createStore("fcdraw-documents", "documents");
export const documentKey = async (file: File) => {
  const bytes = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
};
export const loadInk = async (key: string) =>
  ((await get<DocumentInk>(`ink:${key}`, storage)) ??
    (await get<DocumentInk>(`ink:${key}`, legacyStorage))) ||
  {};
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
          data.error === "文件已加密，请使用未加密的课件"
            ? t("fcboard.文件已加密，请使用未加密的课件")
            : data.error === "课件尚未打开"
            ? t("fcboard.课件尚未打开")
            : data.error;
        task?.reject(new Error(message));
      } else {
        task?.resolve(data.value);
      }
    };
    this.worker.onerror = () => {
      this.pending.forEach((task) =>
        task.reject(new Error(t("fcboard.文档引擎启动失败，请重新打开文件"))),
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
      task.reject(new DOMException("课件已关闭", "AbortError")),
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

export const hitStroke = (
  stroke: InkStroke,
  point: [number, number],
  radius = 14,
) => {
  if (stroke.text || stroke.image) {
    const [x, y] = stroke.points[0];
    const width =
      stroke.imageWidth || (stroke.text?.length || 1) * (stroke.fontSize || 26);
    const height = stroke.imageHeight || (stroke.fontSize || 26) * 1.4;
    return (
      point[0] > x - radius &&
      point[0] < x + width + radius &&
      point[1] > y - radius &&
      point[1] < y + height + radius
    );
  }
  return stroke.points.some((end, index) => {
    const start = stroke.points[Math.max(0, index - 1)];
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
  shape: ExcalidrawElementSkeleton,
  lesson: string,
  image?: string,
): InkStroke => {
  if (!shape.id || !Number.isFinite(shape.x) || !Number.isFinite(shape.y)) {
    throw new Error(t("fcboard.课件板书坐标无效"));
  }
  const x = shape.x || 0;
  const y = shape.y || 0;
  let points: [number, number][] = [[x, y]];
  if (shape.type === "line" || shape.type === "arrow") {
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
    width: shape.strokeWidth || 2,
    opacity: shape.opacity,
    color: shape.strokeColor || "#245bd6",
    lesson,
    commandId: shape.customData?.fcTutorId,
    annotation: !!shape.customData?.fcAnnotation,
    widget: shape.customData?.fcWidget,
    insertion: shape.customData?.fcInsertion,
    plot: shape.customData?.fcPlot,
    text: shape.type === "text" ? shape.text : undefined,
    fontSize: shape.type === "text" ? shape.fontSize : undefined,
    fontFamily: shape.type === "text" ? shape.fontFamily : undefined,
    image: shape.type === "image" ? image : undefined,
    imageWidth: shape.type === "image" ? shape.width : undefined,
    imageHeight: shape.type === "image" ? shape.height : undefined,
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
    throw new Error(t("fcboard.设备无法生成课件截图"));
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
      image.onerror = () => reject(new Error(t("fcboard.课件图像读取失败")));
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
    if (stroke.image) {
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
            stroke.points[0][1] + index * (stroke.fontSize || 26) * 1.3,
          ),
        );
    } else {
      context.beginPath();
      stroke.points.forEach(([x, y], index) => {
        if (index) {
          context.lineTo(x, y);
        } else {
          context.moveTo(x, y);
        }
      });
      context.stroke();
    }
  }
  return getDataURL(
    await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error(t("fcboard.课件截图生成失败"))),
        "image/png",
      ),
    ),
  );
};
