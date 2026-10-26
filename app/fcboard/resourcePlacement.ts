import { t } from "@excalidraw/excalidraw/i18n";

import { findVisibleContentPosition } from "./placement";

import type { ContentRect } from "./placement";

export const resourcePlacement = (
  viewport: ContentRect,
  obstacles: ContentRect[],
  scale: number,
) => {
  let width = Math.min(720 / scale, (viewport.right - viewport.left) * 0.8);
  let height = Math.min(460 / scale, (viewport.bottom - viewport.top) * 0.8);
  for (let attempt = 0; attempt < 7; attempt++) {
    const position = findVisibleContentPosition(
      {
        x: (viewport.left + viewport.right - width) / 2,
        y: (viewport.top + viewport.bottom - height) / 2,
      },
      { width, height },
      viewport,
      obstacles,
      16 / scale,
    );
    if (position) {
      return { ...position, width, height };
    }
    width *= 0.85;
    height *= 0.85;
  }
  throw new Error(
    t("fcboard.there_is_not_enough_visible_space_leave_some_room_for_writing"),
  );
};
