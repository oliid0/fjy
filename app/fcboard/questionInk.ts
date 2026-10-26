import { getCommonBounds } from "@excalidraw/element";
import { t } from "@excalidraw/excalidraw/i18n";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { contentViewport } from "./board";
import { classroomCommands } from "./commands";
import { findVisibleContentPosition } from "./placement";

import type { InkInput } from "./digitalInk";
import type { ContentRect } from "./placement";

/** The question paper and its submitted ink share the visible surface's transform. */
export const questionSurface = (api: ExcalidrawImperativeAPI) => {
  const document = classroomCommands.read("document") as
    | {
        viewport: { left: number; top: number; scroll: number };
        pen?: { color: string; penWidth: number };
      }
    | undefined;
  const layout = classroomCommands.read("document.layout") as
    | { scale: number; viewport: ContentRect; obstacles: ContentRect[] }
    | undefined;
  const state = document ? undefined : api.getAppState();
  if (document && !layout) {
    throw new Error(
      t(
        "fcboard.there_is_not_enough_visible_space_leave_some_room_for_writing",
      ),
    );
  }
  const scale = layout?.scale || state!.zoom.value;
  const origin = document
    ? {
        x: document.viewport.left,
        y: document.viewport.top - document.viewport.scroll * scale,
      }
    : {
        x: (state!.offsetLeft || 0) + state!.scrollX * scale,
        y: (state!.offsetTop || 0) + state!.scrollY * scale,
      };
  const screen = (rect: ContentRect) => ({
    left: origin.x + rect.left * scale,
    top: origin.y + rect.top * scale,
    right: origin.x + rect.right * scale,
    bottom: origin.y + rect.bottom * scale,
  });
  return {
    scale,
    color: document?.pen?.color || state?.currentItemStrokeColor || "#000000",
    width: document?.pen?.penWidth || state?.currentItemStrokeWidth || 2,
    viewport: screen(layout?.viewport || contentViewport(api)),
    obstacles: (
      layout?.obstacles ||
      api.getSceneElements().map((element) => {
        const [left, top, right, bottom] = getCommonBounds([element]);
        return { left, top, right, bottom };
      })
    ).map(screen),
    point: (x: number, y: number): [number, number] => [
      (x - origin.x) / scale,
      (y - origin.y) / scale,
    ],
  };
};

export const questionPosition = (api: ExcalidrawImperativeAPI) => {
  const { viewport, obstacles } = questionSurface(api);
  for (const ratio of [1, 0.85, 0.7]) {
    const width = Math.min(600 * ratio, viewport.right - viewport.left);
    const height = Math.min(144 * ratio, viewport.bottom - viewport.top);
    if (width < 180 || height < 120) {
      break;
    }
    const point = findVisibleContentPosition(
      {
        x: (viewport.left + viewport.right - width) / 2,
        y: (viewport.top + viewport.bottom - height) / 2,
      },
      { width, height },
      viewport,
      obstacles,
      8,
    );
    if (point) {
      return { left: point.x, top: point.y, width, height };
    }
  }
  throw new Error(
    t("fcboard.there_is_not_enough_visible_space_leave_some_room_for_writing"),
  );
};

/** Reject a whole malformed request before either canvas changes any object. */
export const validateQuestionInk = (value: unknown): InkInput => {
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
        stroke.every(
          (point) =>
            Array.isArray(point) &&
            point.length === 2 &&
            point.every(
              (coordinate) =>
                typeof coordinate === "number" && Number.isFinite(coordinate),
            ),
        ),
    )
  ) {
    throw new Error(
      t("fcboard.invalid_writing_area_circle_an_area_containing_writing_again"),
    );
  }
  return value;
};
