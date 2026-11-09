import type { FcboardFreeDrawElement } from "./types";

// PenColorView.colors[9..10], CustomPaint.setPaintCustomColor: diagonal 320px MIRROR.
export const nativeInkPalettes = {
  mint: ["#4dd7af", "#3b52c8"],
  spectrum: [
    "#ff0205",
    "#fe09fd",
    "#0b24fe",
    "#02ffdd",
    "#01ff6c",
    "#9bff00",
    "#ffe404",
    "#ff0601",
  ],
} as const;
export type NativeInkPalette = keyof typeof nativeInkPalettes;
export const isNativeInkPalette = (value: unknown): value is NativeInkPalette =>
  value === "mint" || value === "spectrum";

/** Extend mirrored stops over the actual stroke for Canvas and cropped SVG alike. */
export const nativeInkGradient = (element: FcboardFreeDrawElement) => {
  const data = element.customData?.fcInk?.gradient;
  if (
    !data ||
    !isNativeInkPalette(data.palette) ||
    !Number.isFinite(data.size) ||
    data.size <= 0
  ) {
    return null;
  }
  const size = data.size;
  // Same point-box center as bounds.getFreeDrawElementAbsoluteCoords, without
  // importing bounds -> shape -> renderer back into this paint dependency.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of element.points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const cx = element.x + (minX + maxX) / 2;
  const cy = element.y + (minY + maxY) / 2;
  const cos = Math.cos(element.angle);
  const sin = Math.sin(element.angle);
  let low = Infinity;
  let high = -Infinity;
  for (const [x, y] of element.points) {
    const dx = element.x + x - cx;
    const dy = element.y + y - cy;
    const projection = cx + cy + (cos + sin) * dx + (cos - sin) * dy;
    low = Math.min(low, projection);
    high = Math.max(high, projection);
  }
  const padding = element.strokeWidth * 4;
  const first = Math.floor((low - padding) / (2 * size));
  const last = Math.max(first + 1, Math.ceil((high + padding) / (2 * size)));
  if (
    !Number.isFinite(first) ||
    !Number.isFinite(last) ||
    last - first > 4096
  ) {
    return null;
  }
  const local = (position: number): [number, number] => {
    const dx = position - cx;
    const dy = position - cy;
    return [
      cx - element.x + cos * dx + sin * dy,
      cy - element.y - sin * dx + cos * dy,
    ];
  };
  const coordinates: [number, number, number, number] = [
    ...local(first * size),
    ...local(last * size),
  ];
  const colors = nativeInkPalettes[data.palette];
  const stops: [number, string][] = [];
  for (let period = first; period < last; period++) {
    const ordered = Math.abs(period % 2) === 1 ? [...colors].reverse() : colors;
    ordered.forEach((color, index) => {
      if (period === first || index) {
        stops.push([
          (period - first + index / (ordered.length - 1)) / (last - first),
          color,
        ]);
      }
    });
  }
  return { coordinates, stops };
};
