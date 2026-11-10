import type { ContentRect } from "./placement";

export const resourcePlacement = (
  viewport: ContentRect,
  scale: number,
  compact = false,
) => {
  // The requested lesson window opens centered over the board.
  // Its visibility must not depend on finding an empty rectangle among existing ink.
  const height = compact
    ? (viewport.bottom - viewport.top) / 3
    : Math.min(460 / scale, (viewport.bottom - viewport.top) * 0.8);
  const width = compact
    ? Math.min(height / 3, viewport.right - viewport.left)
    : Math.min(720 / scale, (viewport.right - viewport.left) * 0.8);
  return {
    x: (viewport.left + viewport.right - width) / 2,
    y: (viewport.top + viewport.bottom - height) / 2,
    width,
    height,
  };
};
