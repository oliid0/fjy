import { FONT_FAMILY } from "@excalidraw/common";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { Fonts } from "@excalidraw/excalidraw/fonts/Fonts";
import { getCommonBounds, newFreeDrawElement } from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";
import { t } from "@excalidraw/excalidraw/i18n";

import { inkLineHeight, supportsHandwriting } from "./handwriting";
import { noWritingSpace, prepareLessonText } from "./lessonWriting";
import { validateQuestionInk } from "./questionInk";

import type { ContentRect } from "./placement";
import type { LessonWritingContext } from "./lessonWriting";

/** Dictation and raw question strokes commit together, on the same visible surface. */
export const prepareQuestionWriting = async (
  args: Record<string, unknown>,
  context: () => Omit<LessonWritingContext, "source" | "bounds">,
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
        convertToExcalidrawElements([
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
  const raw = points.map((points) =>
    newFreeDrawElement({
      type: "freedraw",
      x: points[0][0],
      y: points[0][1],
      points: points.map(([x, y]) =>
        pointFrom(x - points[0][0], y - points[0][1]),
      ),
      strokeColor: style.color,
      strokeWidth: style.width,
      opacity: style.opacity,
      simulatePressure: true,
      customData: {
        fcQuestionInput: true,
        fcInk: {
          version: 2,
          pen: "hard",
          unit: 1 / ((devicePixelRatio || 1) * style.scale),
          finished: true,
        },
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
