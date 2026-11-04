import { DEFAULT_ELEMENT_PROPS, FONT_FAMILY } from "@fcboard/common";
import { convertToFcboardElements } from "@fcboard/fcboard";
import { Fonts } from "@fcboard/fcboard/fonts/Fonts";
import { getCommonBounds, newFreeDrawElement } from "@fcboard/element";
import { pointFrom } from "@fcboard/math";
import { t } from "@fcboard/fcboard/i18n";
import { whiteboardInkStyle } from "@fcboard/fcboard/whiteboardPen";

import type { FactoryInkData } from "@fcboard/element/factoryInk";

import { inkLineHeight, supportsHandwriting } from "./handwriting";
import { noWritingSpace, prepareLessonText } from "./lessonWriting";
import { validateQuestionInk } from "./questionInk";

import type { ContentRect } from "./placement";
import type { LessonWritingContext } from "./lessonWriting";

/** Use the actual pointer renderer's style per command, without changing a concurrent task's pen. */
export const questionStrokeStyle = (
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
      currentItemPenMode: pen ?? state.currentItemPenMode ?? "hard",
      currentItemInkAssist: undefined,
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

/** Dictation and raw question strokes commit together, on the same visible surface. */
export const prepareQuestionWriting = async (
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
      : validateQuestionInk(args.strokes);
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
    ...(style.inkStyle?.customData.fcInk.pen === "rainbow"
      ? {
          rainbow: {
            x: style.viewport.left,
            width: style.viewport.right - style.viewport.left,
          },
        }
      : {}),
  };
  const raw = points.map((points) =>
    newFreeDrawElement({
      type: "freedraw",
      x: points[0][0],
      y: points[0][1],
      points: points.map(([x, y]) =>
        pointFrom(x - points[0][0], y - points[0][1]),
      ),
      strokeColor: style.inkStyle?.strokeColor ?? style.color,
      strokeWidth: style.inkStyle?.strokeWidth ?? style.width,
      opacity: style.inkStyle?.opacity ?? style.opacity,
      strokeStyle: style.inkStyle?.strokeStyle ?? "solid",
      simulatePressure: style.inkStyle?.simulatePressure ?? true,
      customData: {
        fcQuestionInput: true,
        fcInk: { ...factoryInk },
      },
    }),
  );
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
    { fcQuestionInput: true },
  );
  return [...raw, ...written].map((element) => ({
    ...element,
    groupIds: [group],
  }));
};
