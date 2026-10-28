import { getFontString, getLineHeight } from "@excalidraw/common";
import { measureText } from "@excalidraw/element/textMeasurements";
import { wrapText } from "@excalidraw/element/textWrapping";

import type { FontFamilyValues } from "@excalidraw/element/types";

import { findVisibleContentPosition } from "./placement";

import type { ContentRect } from "./placement";

export type TextPlacement = {
  mode?: "inline" | "below" | "column" | "replace" | "center";
  bounds?: ContentRect;
  sourceLines?: number;
};

/** Reflow at the source's size first; shrink only when the visible area requires it.
 * Measurement and wrapping use the editor's font metrics, also used by SVG export.
 */
export const layoutBoardText = (
  text: string,
  fontSize: number,
  fontFamily: FontFamilyValues,
  viewport: ContentRect,
  obstacles: readonly ContentRect[],
  preferred: { x: number; y: number },
  gap: number,
  placement: TextPlacement = {},
) => {
  const source = placement.bounds;
  const centered = placement.mode === "center";
  const lineHeight = getLineHeight(fontFamily);
  const fullWidth = viewport.right - viewport.left;
  const fullHeight = viewport.bottom - viewport.top;
  if (fullWidth <= 0 || fullHeight <= 0) {
    return undefined;
  }
  // Below means below the actual writing, not below the loose lasso outline.
  const below = source
    ? {
        x: Math.max(viewport.left, Math.min(source.left, viewport.right - gap)),
        y: source.bottom + gap,
      }
    : preferred;
  const inline = source ? { x: source.right + gap, y: source.top } : preferred;
  const candidates: {
    x: number;
    y: number;
    nearby?: boolean;
    inline?: boolean;
  }[] =
    placement.mode === "replace" || centered
      ? [preferred]
      : placement.mode === "inline"
      ? [{ ...inline, inline: true }, below]
      : source
      ? [below]
      : [preferred];
  // If the question touches an edge, keep the original writing size and try
  // nearby space before shrinking it into the remaining narrow strip.
  if (source && placement.mode !== "replace" && !centered) {
    candidates.push({ x: viewport.left, y: source.bottom + gap });
    candidates.push({ x: source.left, y: source.top, nearby: true });
  }
  for (let attempt = 0; attempt < 48; attempt++) {
    const size = fontSize * 0.9 ** attempt;
    if (size < Math.min(fontSize, (gap * 6) / 16)) {
      break;
    }
    for (const origin of candidates) {
      const x = Math.max(viewport.left, Math.min(origin.x, viewport.right));
      const nearby = origin.nearby;
      const y = Math.max(viewport.top, origin.y);
      const width = centered
        ? fullWidth / 2
        : nearby
        ? fullWidth * 0.6
        : viewport.right - x;
      if (width < size || (!nearby && y >= viewport.bottom)) {
        continue;
      }
      const font = getFontString({ fontFamily, fontSize: size });
      const wrapped = origin.inline ? text : wrapText(text, font, width);
      const metrics = measureText(wrapped, font, lineHeight);
      if (origin.inline && (text.includes("\n") || metrics.width > width)) {
        continue;
      }
      const measuredOrigin =
        placement.mode === "column" && source
          ? { x: Math.max(viewport.left, source.right - metrics.width), y }
          : centered
          ? {
              x: (viewport.left + viewport.right - metrics.width) / 2,
              y: (viewport.top + viewport.bottom - metrics.height) / 2,
            }
          : { x, y };
      const area =
        centered || nearby
          ? viewport
          : {
              ...viewport,
              left: x,
              top: y,
              ...(origin.inline
                ? { bottom: Math.min(viewport.bottom, y + metrics.height) }
                : {}),
            };
      const position = findVisibleContentPosition(
        measuredOrigin,
        metrics,
        area,
        obstacles,
        gap,
      );
      if (position) {
        return {
          ...position,
          text: wrapped,
          originalText: text,
          fontSize: size,
          fontFamily,
          lineHeight,
          ...metrics,
          autoResize: false as const,
        };
      }
    }
  }
  return undefined;
};
