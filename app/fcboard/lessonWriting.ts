import { FONT_FAMILY } from "@fcboard/common";
import { convertToFcboardElements } from "@fcboard/fcboard";
import { getCommonBounds } from "@fcboard/element";
import { t } from "@fcboard/fcboard/i18n";

import type { FcboardElement } from "@fcboard/element/types";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { contentViewport } from "./board";
import { classroomCommands } from "./commands";
import { documentStrokeBounds } from "./documents";
import { documentInkElement } from "./documentInk";
import { handwritingElements, inkLineHeight } from "./handwriting";
import { findVisibleContentPosition } from "./placement";
import { layoutBoardText } from "./textLayout";

import type { InkStroke } from "./documents";
import type { ContentRect } from "./placement";

export const noWritingSpace = () =>
  new Error(
    t("fcboard.there_is_not_enough_visible_space_leave_some_room_for_writing"),
  );
export type LessonWritingContext = {
  viewport: ContentRect;
  obstacles: ContentRect[];
  source: FcboardElement[];
  bounds?: ContentRect;
  fontSize: number;
  color: string;
  width: number;
  opacity: number;
  scale: number;
};

/** Read the visible document alone; scene coordinates are never mixed with page units. */
export const lessonWritingContext = (
  api: FcboardImperativeAPI,
  lesson: string,
  sourceIds: readonly string[] | undefined,
  exclude: ReadonlySet<string>,
): LessonWritingContext => {
  const document = classroomCommands.read("document") as
    | {
        ink: InkStroke[];
        selection?: string[];
        pen?: {
          color: string;
          penWidth: number;
          fontSize: number;
          opacity: number;
        };
      }
    | undefined;
  const layout = document
    ? (classroomCommands.read("document.layout") as
        | { scale: number; viewport: ContentRect }
        | undefined)
    : undefined;
  if (document && !layout) {
    throw noWritingSpace();
  }
  const state = document ? undefined : api.getAppState();
  const viewport = layout?.viewport || contentViewport(api);
  const scale = layout?.scale || state!.zoom.value;
  const ids = sourceIds?.length
    ? sourceIds
    : document
    ? document.selection
    : Object.keys(state!.selectedElementIds || {});
  let source: FcboardElement[];
  let obstacles: ContentRect[];
  if (document) {
    const ink = document.ink || [];
    if (sourceIds?.some((id) => !ink.some((stroke) => stroke.id === id))) {
      throw new DOMException("Lesson source removed", "AbortError");
    }
    const eligible = ink.filter(
      (stroke) =>
        !stroke.lesson &&
        !stroke.widget &&
        !stroke.insertion &&
        !stroke.plot &&
        !stroke.resource &&
        !stroke.image,
    );
    source = eligible
      .filter((stroke) => !ids?.length || ids.includes(stroke.id))
      .flatMap<FcboardElement>((stroke) =>
        stroke.text
          ? convertToFcboardElements(
              [
                {
                  type: "text",
                  id: stroke.id,
                  x: stroke.points[0][0],
                  y: stroke.points[0][1],
                  text: stroke.text,
                  fontSize: stroke.fontSize,
                  fontFamily: stroke.fontFamily,
                  strokeColor: stroke.color,
                  opacity: stroke.opacity,
                },
              ],
              { regenerateIds: false },
            )
          : [documentInkElement(stroke)],
      );
    obstacles = ink
      .filter(
        (stroke) =>
          !(stroke.lesson === lesson && exclude.has(stroke.commandId || "")),
      )
      .map(documentStrokeBounds);
  } else {
    const elements = api
      .getSceneElements()
      .filter((element) => !element.isDeleted);
    if (
      sourceIds?.some((id) => !elements.some((element) => element.id === id))
    ) {
      throw new DOMException("Lesson source removed", "AbortError");
    }
    source = elements.filter(
      (element) =>
        (element.type === "text" || element.type === "freedraw") &&
        !element.customData?.fcLessonId &&
        !element.customData?.fcWidget &&
        !element.customData?.fcPlot &&
        !element.customData?.fcInsertion &&
        !element.customData?.fcAxes &&
        (!ids?.length || ids.includes(element.id)),
    );
    obstacles = elements
      .filter(
        (element) =>
          !(
            element.customData?.fcLessonId === lesson &&
            exclude.has(element.customData?.fcTutorId)
          ),
      )
      .map((element) => {
        const [left, top, right, bottom] = getCommonBounds([element]);
        return { left, top, right, bottom };
      });
  }
  source = source.filter((element) => {
    const [left, top, right, bottom] = getCommonBounds([element]);
    return (
      right >= viewport.left &&
      left <= viewport.right &&
      bottom >= viewport.top &&
      top <= viewport.bottom
    );
  });
  const text = source.find((element) => element.type === "text");
  const ink = source.find((element) => element.type === "freedraw");
  const bounds = source.length ? getCommonBounds(source) : undefined;
  return {
    viewport,
    obstacles,
    source,
    scale,
    bounds: bounds
      ? { left: bounds[0], top: bounds[1], right: bounds[2], bottom: bounds[3] }
      : undefined,
    fontSize:
      text?.type === "text"
        ? text.fontSize
        : ink
        ? inkLineHeight(source, 1 / scale) / 1.25
        : (document?.pen?.fontSize || state?.currentItemFontSize || 24) / scale,
    color:
      source[0]?.strokeColor ||
      document?.pen?.color ||
      state?.currentItemStrokeColor ||
      "#000000",
    width:
      ink?.strokeWidth ||
      document?.pen?.penWidth ||
      (state?.currentItemStrokeWidth || 2) / scale,
    opacity:
      source[0]?.opacity ??
      document?.pen?.opacity ??
      state?.currentItemOpacity ??
      100,
  };
};

/** Reserve final bounds before playback so every partial stroke stays in the same place. */
export const prepareLessonText = (
  text: string,
  context: LessonWritingContext,
  preferred: { x: number; y: number },
  color: string,
  customData: Record<string, unknown>,
) => {
  const { viewport, obstacles, scale } = context;
  const gap = 8 / scale;
  for (let attempt = 0; attempt < 24; attempt++) {
    const layout = layoutBoardText(
      text,
      context.fontSize * 0.9 ** attempt,
      FONT_FAMILY.Excalifont,
      viewport,
      obstacles,
      preferred,
      gap,
    );
    if (!layout) {
      break;
    }
    const ink = handwritingElements(layout.text, {
      x: 0,
      y: 0,
      height: layout.fontSize * 1.25,
      color,
      width: (context.width * layout.fontSize) / context.fontSize,
      opacity: context.opacity,
      maxWidth: viewport.right - layout.x,
      source: context.source,
      customData,
    });
    if (ink) {
      const [left, top, right, bottom] = getCommonBounds(ink);
      const point = findVisibleContentPosition(
        layout,
        { width: right - left, height: bottom - top },
        viewport,
        obstacles,
        gap,
      );
      if (!point) {
        continue;
      }
      return ink.map((element) => ({
        ...element,
        x: element.x + point.x - left,
        y: element.y + point.y - top,
      }));
    }
    return convertToFcboardElements([
      {
        type: "text",
        ...layout,
        strokeColor: color,
        opacity: context.opacity,
        customData,
      },
    ]);
  }
  throw noWritingSpace();
};

export const fitLessonFormula = (
  size: { width: number; height: number },
  context: LessonWritingContext,
  preferred: { x: number; y: number },
) => {
  for (let attempt = 0; attempt < 24; attempt++) {
    const ratio = (context.fontSize / 32) * 0.9 ** attempt;
    if (context.fontSize * 0.9 ** attempt < 6 / context.scale) {
      break;
    }
    const dimensions = {
      width: size.width * ratio,
      height: size.height * ratio,
    };
    const point = findVisibleContentPosition(
      preferred,
      dimensions,
      context.viewport,
      context.obstacles,
      8 / context.scale,
    );
    if (point) {
      return { ...point, ...dimensions };
    }
  }
  throw noWritingSpace();
};
