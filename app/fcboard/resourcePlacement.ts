import type { ContentRect } from "./placement";

export const resourcePlacement = (viewport: ContentRect, scale: number) => {
  // The requested lesson window opens centered over the board.
  // Its visibility must not depend on finding an empty rectangle among existing ink.
  const width = Math.min(720 / scale, (viewport.right - viewport.left) * 0.8);
  const height = Math.min(460 / scale, (viewport.bottom - viewport.top) * 0.8);
  return {
    x: (viewport.left + viewport.right - width) / 2,
    y: (viewport.top + viewport.bottom - height) / 2,
    width,
    height,
  };
};
