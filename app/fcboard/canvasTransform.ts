import { t } from "@fcboard/fcboard/i18n";
import { hashString, newElementWith } from "@fcboard/element";
import { pointFrom } from "@fcboard/math";
import { MIN_FONT_SIZE } from "@fcboard/common";

import type { FcboardElement } from "@fcboard/element/types";

import { moveDocumentStroke, scaleDocumentStroke } from "./documents";

import type { ContentRect } from "./placement";

export const resizeAnchor = (
  args: Record<string, unknown>,
  bounds: ContentRect,
) => {
  if (
    Object.keys(args).some(
      (key) => !["ids", "scale", "anchor"].includes(key),
    ) ||
    typeof args.scale !== "number" ||
    !Number.isFinite(args.scale) ||
    args.scale < 0.1 ||
    args.scale > 10 ||
    (args.anchor !== undefined &&
      !["center", "top-left"].includes(String(args.anchor)))
  ) {
    throw new Error(t("fcboard.invalid_style_parameters"));
  }
  return args.anchor === "top-left"
    ? { x: bounds.left, y: bounds.top }
    : {
        x: (bounds.left + bounds.right) / 2,
        y: (bounds.top + bounds.bottom) / 2,
      };
};

/** Align the entire selection to the visible page, preserving its internal layout. */
export const alignmentOffset = (
  args: Record<string, unknown>,
  bounds: ContentRect,
  viewport: ContentRect,
) => {
  if (
    Object.keys(args).some(
      (key) => !["ids", "horizontal", "vertical"].includes(key),
    ) ||
    (args.horizontal === undefined && args.vertical === undefined) ||
    (args.horizontal !== undefined &&
      !["left", "center", "right"].includes(String(args.horizontal))) ||
    (args.vertical !== undefined &&
      !["top", "center", "bottom"].includes(String(args.vertical))) ||
    !Object.values(viewport).every(Number.isFinite)
  ) {
    throw new Error(t("fcboard.invalid_movement_distance"));
  }
  return {
    dx:
      args.horizontal === "left"
        ? viewport.left - bounds.left
        : args.horizontal === "right"
        ? viewport.right - bounds.right
        : args.horizontal === "center"
        ? (viewport.left + viewport.right - bounds.left - bounds.right) / 2
        : 0,
    dy:
      args.vertical === "top"
        ? viewport.top - bounds.top
        : args.vertical === "bottom"
        ? viewport.bottom - bounds.bottom
        : args.vertical === "center"
        ? (viewport.top + viewport.bottom - bounds.top - bounds.bottom) / 2
        : 0,
  };
};

/** Match the editor's uniform selection resize, including editable pen/widget anchors. */
export const transformBoardElement = (
  element: FcboardElement,
  anchor: { x: number; y: number },
  scale: number,
  dx = 0,
  dy = 0,
) => {
  if (scale !== 1 && element.customData?.fcInsertion?.kind === "table") {
    throw new Error(t("fcboard.table_zoom_instructions"));
  }
  if (element.type === "text" && element.fontSize * scale < MIN_FONT_SIZE) {
    throw new Error(t("fcboard.invalid_style_parameters"));
  }
  const transform = (point: { x: number; y: number }) => ({
    x: anchor.x + (point.x - anchor.x) * scale + dx,
    y: anchor.y + (point.y - anchor.y) * scale + dy,
  });
  const data = element.customData;
  const semantic = moveDocumentStroke(
    scaleDocumentStroke(
      {
        id: element.id,
        color: element.strokeColor,
        width: element.strokeWidth,
        points: [],
        fcInk: data?.fcInk,
        widget: data?.fcWidget,
        insertion: data?.fcInsertion,
        plot: data?.fcPlot,
      },
      anchor,
      scale,
    ),
    dx,
    dy,
  );
  const points =
    element.type === "freedraw" ||
    element.type === "line" ||
    element.type === "arrow"
      ? element.points.map(([x, y]) => pointFrom(x * scale, y * scale))
      : undefined;
  return newElementWith(element, {
    ...transform(element),
    width: element.width * scale,
    height: element.height * scale,
    strokeWidth: element.strokeWidth * scale,
    ...(points ? { points } : {}),
    ...(element.type === "text" ? { fontSize: element.fontSize * scale } : {}),
    ...(element.type === "arrow" && element.elbowed && element.fixedSegments
      ? {
          fixedSegments: element.fixedSegments.map((segment) => ({
            ...segment,
            start: pointFrom(
              segment.start[0] * scale,
              segment.start[1] * scale,
            ),
            end: pointFrom(segment.end[0] * scale, segment.end[1] * scale),
          })),
        }
      : {}),
    ...(data
      ? {
          customData: {
            ...data,
            ...(data.fcInk ? { fcInk: semantic.fcInk } : {}),
            ...(data.fcWidget ? { fcWidget: semantic.widget } : {}),
            ...(data.fcInsertion ? { fcInsertion: semantic.insertion } : {}),
            ...(data.fcPlot ? { fcPlot: semantic.plot } : {}),
            ...(data.fcAxes
              ? {
                  fcAxes: {
                    ...transform(data.fcAxes),
                    unit: data.fcAxes.unit * scale,
                  },
                }
              : {}),
            ...(element.type === "freedraw" &&
            points &&
            data.fcWrittenHash === hashString(JSON.stringify(element.points))
              ? { fcWrittenHash: hashString(JSON.stringify(points)) }
              : {}),
          },
        }
      : {}),
  });
};
