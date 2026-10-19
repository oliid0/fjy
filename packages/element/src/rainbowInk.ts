import { getElementAbsoluteCoords } from "./bounds";

import type { ExcalidrawFreeDrawElement } from "./types";

/** HRainbowCurveObject: one board-wide, clamped horizontal gradient. */
export const rainbowInkStops = [
  [0, "#2eb88a"],
  [0.12, "#14aee2"],
  [0.24, "#2c78e7"],
  [0.34, "#5637c6"],
  [0.44, "#c024be"],
  [0.52, "#ff235e"],
  [0.6, "#ff5722"],
  [0.68, "#ffa000"],
  [0.76, "#e2d728"],
  [0.84, "#8ac542"],
  [0.93, "#2bc3a5"],
  [1, "#10a8e0"],
] as const;

export const rainbowInkCoordinates = (
  element: ExcalidrawFreeDrawElement,
): [number, number, number, number] | null => {
  const rainbow = element.customData?.fcInk?.rainbow;
  if (
    element.customData?.fcInk?.pen !== "rainbow" ||
    !Number.isFinite(rainbow?.x) ||
    !Number.isFinite(rainbow?.width) ||
    rainbow.width <= 0
  ) {
    return null;
  }
  const [, , , , cx, cy] = getElementAbsoluteCoords(element, new Map());
  const cos = Math.cos(element.angle);
  const sin = Math.sin(element.angle);
  const start = rainbow.x - cx;
  const end = start + rainbow.width;
  // Undo the element transform. Erased fragments and rotated strokes share
  // the same board coordinates; zoom and cropped exports cannot recolor them.
  const coordinates: [number, number, number, number] = [
    cx - element.x + cos * start,
    cy - element.y - sin * start,
    cx - element.x + cos * end,
    cy - element.y - sin * end,
  ];
  return coordinates.every(Number.isFinite) ? coordinates : null;
};
