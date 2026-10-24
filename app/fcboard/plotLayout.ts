import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { getCommonBounds } from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element/transform";

import { findVisibleContentPosition } from "./placement";

import type { ContentRect } from "./placement";

/** Scale the whole coordinate system uniformly; labels and curves share the transform. */
export const fitPlot = (
  shapes: ExcalidrawElementSkeleton[],
  center: { x: number; y: number },
  viewport: ContentRect,
  obstacles: ContentRect[],
  gap: number,
  source?: ContentRect,
) => {
  // Text measurement rounds glyph metrics; retain a small rendering margin after scaling.
  viewport = {
    left: viewport.left + gap / 4,
    top: viewport.top + gap / 4,
    right: viewport.right - gap / 4,
    bottom: viewport.bottom - gap / 4,
  };
  const [left, top, right, bottom] = getCommonBounds(
    convertToExcalidrawElements(shapes),
  );
  const initial = Math.min(
    1,
    (viewport.right - viewport.left) / (right - left),
    (viewport.bottom - viewport.top) / (bottom - top),
  );
  for (let attempt = 0; attempt < 16; attempt++) {
    const scale = initial * 0.85 ** attempt;
    const size = {
      width: (right - left) * scale,
      height: (bottom - top) * scale,
    };
    if (size.width < gap * 6 || size.height < gap * 6) {
      break;
    }
    const position = findVisibleContentPosition(
      source
        ? {
            x: (source.left + source.right - size.width) / 2,
            y: (source.top + source.bottom - size.height) / 2,
          }
        : { x: left, y: top },
      size,
      viewport,
      source ? [...obstacles, source] : obstacles,
      gap,
    );
    if (!position) {
      continue;
    }
    const transform = (point: { x: number; y: number }) => ({
      x: position.x + (point.x - left) * scale,
      y: position.y + (point.y - top) * scale,
    });
    return {
      center: transform(center),
      shapes: shapes.map((shape) => {
        const plot = shape.customData?.fcPlot;
        return {
          ...shape,
          ...transform({ x: shape.x ?? 0, y: shape.y ?? 0 }),
          ...(shape.type === "text"
            ? { fontSize: (shape.fontSize || 20) * scale }
            : {}),
          ...(shape.type === "line" || shape.type === "arrow"
            ? {
                points: shape.points?.map(([x, y]) =>
                  pointFrom(x * scale, y * scale),
                ),
              }
            : {}),
          strokeWidth: (shape.strokeWidth ?? 2) * scale,
          ...(plot
            ? {
                customData: {
                  ...shape.customData,
                  fcPlot: {
                    ...plot,
                    position: transform(plot.position),
                    origin: transform(plot.origin),
                  },
                },
              }
            : {}),
        } as ExcalidrawElementSkeleton;
      }),
    };
  }
  throw new Error("No visible space for the function plot");
};
