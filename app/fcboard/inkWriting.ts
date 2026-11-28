import {
  DEFAULT_ELEMENT_PROPS,
  FONT_FAMILY,
  getSizeFromPoints,
} from "@fcboard/common";
import { convertToFcboardElements } from "@fcboard/fcboard";
import { Fonts } from "@fcboard/fcboard/fonts/Fonts";
import { getCommonBounds, newFreeDrawElement } from "@fcboard/element";
import { pointFrom } from "@fcboard/math";
import { t } from "@fcboard/fcboard/i18n";
import { whiteboardInkStyle } from "@fcboard/fcboard/whiteboardPen";
import { createEraseRegion } from "@fcboard/fcboard/eraser/region";

import type { FactoryInkData } from "@fcboard/element/factoryInk";
import type { GlobalPoint, LocalPoint } from "@fcboard/math";

import { inkLineHeight, supportsHandwriting } from "./handwriting";
import { noWritingSpace, prepareLessonText } from "./lessonWriting";
import { classroomCommands } from "./commands";

import type { InkInput } from "./digitalInk";

import type { ContentRect } from "./placement";
import type { LessonWritingContext } from "./lessonWriting";

const inkPoint = (value: unknown): value is [number, number] =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every(
    (coordinate) =>
      typeof coordinate === "number" && Number.isFinite(coordinate),
  );

/** Reject a whole malformed request before either canvas changes any object. */
export const validateInkInput = (value: unknown): InkInput => {
  let count = 0;
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 2000 ||
    !value.every(
      (stroke) =>
        Array.isArray(stroke) &&
        stroke.length > 0 &&
        (count += stroke.length) <= 100000 &&
        stroke.every(inkPoint),
    )
  ) {
    throw new Error(
      t("fcboard.invalid_writing_area_circle_an_area_containing_writing_again"),
    );
  }
  return value;
};

/** A single unwrapped path and a batch use the same canonical trajectories. */
const inkPaths = (value: unknown) =>
  validateInkInput(
    Array.isArray(value) && value.length && inkPoint(value[0])
      ? [value]
      : value,
  );

/** Map normalized viewport coordinates through the same visible bounds as board_inspect. */
export const inkCoordinates = (
  strokes: InkInput,
  args: Record<string, unknown>,
  viewport: ContentRect,
): InkInput => {
  if (
    (args.revision !== undefined &&
      args.revision !== classroomCommands.revision) ||
    (args.coordinateSpace !== undefined &&
      args.coordinateSpace !== "scene" &&
      args.coordinateSpace !== "viewport")
  ) {
    throw new Error(t("fcboard.invalid_annotation_coordinates"));
  }
  if (args.coordinateSpace !== "viewport") {
    return strokes;
  }
  const { left, top, right, bottom } = viewport;
  if (
    ![left, top, right, bottom].every(Number.isFinite) ||
    right <= left ||
    bottom <= top ||
    strokes.some((stroke) =>
      stroke.some(([x, y]) => x < 0 || y < 0 || x > 1000 || y > 1000),
    )
  ) {
    throw new Error(t("fcboard.invalid_annotation_coordinates"));
  }
  return strokes.map((stroke) =>
    stroke.map(([x, y]) => [
      left + ((right - left) * x) / 1000,
      top + ((bottom - top) * y) / 1000,
    ]),
  );
};

export const inkRegion = (
  args: Record<string, unknown>,
  viewport: ContentRect,
) => {
  const [points] = inkCoordinates(
    validateInkInput([args.region]),
    args,
    viewport,
  );
  if (
    points.length > 512 ||
    !createEraseRegion(
      points.map(([x, y]) => pointFrom<GlobalPoint>(x, y)),
      0,
    )
  ) {
    throw new Error(t("fcboard.invalid_annotation_coordinates"));
  }
  return points;
};

/** Use the actual pointer renderer's style per command, without changing a concurrent task's pen. */
export const inkStrokeStyle = (
  args: Record<string, unknown>,
  state: Parameters<typeof whiteboardInkStyle>[0],
  device: Parameters<typeof whiteboardInkStyle>[2],
  scale: number,
) => {
  const pen = (
    ["hard", "brush", "highlighter", "dashed", "rainbow"] as const
  ).find((value) => value === args.pen);
  if (args.pen !== undefined && !pen) {
    throw new Error(t("fcboard.unknown_pen_type"));
  }
  if (
    args.color !== undefined &&
    (typeof args.color !== "string" ||
      !/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(args.color))
  ) {
    throw new Error(t("fcboard.invalid_color"));
  }
  for (const [key, min, max] of [
    ["width", 1, 30],
    ["opacity", 0, 100],
  ] as const) {
    const value = args[key];
    if (
      value !== undefined &&
      (typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < min ||
        value > max)
    ) {
      throw new Error(t("fcboard.invalid_style_parameters"));
    }
  }
  if (
    ["pen", "color", "width", "opacity"].every(
      (key) => args[key] === undefined,
    ) &&
    (!state.currentItemPenMode || state.currentItemPenMode === "hard")
  ) {
    return undefined;
  }
  return whiteboardInkStyle(
    {
      ...state,
      whiteboardDualPen: false,
      currentItemPenMode: pen ?? state.currentItemPenMode ?? "hard",
      currentItemInkAssist: undefined,
      ...(args.color !== undefined
        ? { currentItemInkGradient: undefined }
        : {}),
      currentItemStrokeColor:
        typeof args.color === "string"
          ? args.color
          : state.currentItemStrokeColor || "#000000",
      currentItemStrokeWidth:
        typeof args.width === "number"
          ? args.width
          : state.currentItemStrokeWidth || DEFAULT_ELEMENT_PROPS.strokeWidth,
      currentItemOpacity:
        typeof args.opacity === "number"
          ? args.opacity
          : state.currentItemOpacity ?? 100,
    },
    { width: 1, height: 1, pointerType: "mouse" },
    device,
    1 / scale,
  );
};

/** Dictation and captured pen strokes commit together, on the same visible surface. */
export const prepareInkWriting = async (
  args: Record<string, unknown>,
  context: () => Omit<LessonWritingContext, "source" | "bounds"> & {
    inkStyle?: ReturnType<typeof whiteboardInkStyle>;
  },
) => {
  const signal = args.signal instanceof AbortSignal ? args.signal : undefined;
  signal?.throwIfAborted();
  if (
    args.text !== undefined &&
    (typeof args.text !== "string" || args.text.length > 10000)
  ) {
    throw new Error(t("fcboard.text_is_empty_or_too_long"));
  }
  const text = typeof args.text === "string" ? args.text.trim() : "";
  const points =
    text && Array.isArray(args.strokes) && !args.strokes.length
      ? []
      : inkPaths(args.strokes);
  const bounds = args.bounds as ContentRect | undefined;
  if (text) {
    if (
      !bounds ||
      ![bounds.left, bounds.top, bounds.right, bounds.bottom].every(
        Number.isFinite,
      ) ||
      bounds.left >= bounds.right ||
      bounds.top >= bounds.bottom
    ) {
      throw noWritingSpace();
    }
    if (!supportsHandwriting(text)) {
      await Fonts.loadElementsFonts(
        convertToFcboardElements([
          {
            type: "text",
            x: 0,
            y: 0,
            text,
            fontFamily: FONT_FAMILY.Excalifont,
          },
        ]),
      );
    }
  }
  signal?.throwIfAborted();
  const style = context();
  const factoryInk: FactoryInkData = {
    version: 2,
    pen: "hard",
    unit: 1 / ((devicePixelRatio || 1) * style.scale),
    ...style.inkStyle?.customData.fcInk,
    finished: true,
    centerline: true,
    subpixel: true,
    nib: false,
    ...(style.inkStyle?.customData.fcInk.pen === "rainbow"
      ? {
          rainbow: {
            x: style.viewport.left,
            width: style.viewport.right - style.viewport.left,
          },
        }
      : {}),
  };
  const raw = inkCoordinates(points, args, style.viewport).map((points) => {
    const [originX, originY] = points[0];
    const local = points.map(([x, y]) =>
      pointFrom<LocalPoint>(x - originX, y - originY),
    );
    if (local.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) {
      throw new Error(t("fcboard.invalid_annotation_coordinates"));
    }
    if (local.length === 1) {
      local.push(pointFrom<LocalPoint>(0.0001, 0.0001));
    }
    return newFreeDrawElement({
      type: "freedraw",
      x: originX,
      y: originY,
      points: local,
      ...getSizeFromPoints(local),
      strokeColor: style.inkStyle?.strokeColor ?? style.color,
      strokeWidth: style.inkStyle?.strokeWidth ?? style.width,
      opacity: style.inkStyle?.opacity ?? style.opacity,
      strokeStyle: style.inkStyle?.strokeStyle ?? "solid",
      simulatePressure: style.inkStyle?.simulatePressure ?? true,
      customData: {
        fcGenerated: true,
        fcInk: { ...factoryInk },
      },
    });
  });
  const group = crypto.randomUUID();
  if (!text) {
    return raw.map((element) => ({ ...element, groupIds: [group] }));
  }
  const viewport = {
    left: Math.max(style.viewport.left, bounds!.left),
    top: Math.max(style.viewport.top, bounds!.top),
    right: Math.min(style.viewport.right, bounds!.right),
    bottom: Math.min(style.viewport.bottom, bounds!.bottom),
  };
  const boxes = raw.map((element) => {
    const [left, top, right, bottom] = getCommonBounds([element]);
    return { left, top, right, bottom };
  });
  const top = boxes.length
    ? Math.max(...boxes.map((box) => box.bottom)) + 8 / style.scale
    : viewport.top;
  const written = prepareLessonText(
    text,
    {
      ...style,
      source: raw,
      fontSize: raw.length
        ? inkLineHeight(raw, 1 / style.scale) / 1.25
        : style.fontSize,
      viewport,
      obstacles: [...style.obstacles, ...boxes],
    },
    { x: viewport.left, y: top },
    style.color,
    { fcGenerated: true },
  );
  return [...raw, ...written].map((element) => ({
    ...element,
    groupIds: [group],
  }));
};
