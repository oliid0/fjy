import type { ContentRect } from "./placement";

export const resourcePlacement = (
  viewport: ContentRect,
  scale: number,
  kind: "calculator" | "audio" | "video" | "lesson" = "lesson",
) => {
  // The requested lesson window opens centered over the board.
  // Its visibility must not depend on finding an empty rectangle among existing ink.
  const availableWidth = viewport.right - viewport.left;
  const availableHeight = viewport.bottom - viewport.top;
  const calculator = kind === "calculator";
  const width = Math.min(
    (calculator ? 400 : kind === "audio" ? 540 : 720) / scale,
    availableWidth * (calculator ? 0.96 : 0.8),
  );
  const height = Math.min(
    (calculator ? 560 : kind === "audio" ? 236 : 460) / scale,
    availableHeight * (calculator ? 0.96 : 0.8),
  );
  return {
    x: (viewport.left + viewport.right - width) / 2,
    y: (viewport.top + viewport.bottom - height) / 2,
    width,
    height,
  };
};
