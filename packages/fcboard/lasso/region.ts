import { DRAGGING_THRESHOLD } from "@excalidraw/common";
import { pointFrom } from "@excalidraw/math";

import type { GlobalPoint } from "@excalidraw/math";

import { getLassoBounds } from "./utils";

export type RegionBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
export type RegionHandle = "nw" | "ne" | "sw" | "se" | "move";

export const regionPath = (bounds: RegionBounds): GlobalPoint[] => [
  pointFrom(bounds.left, bounds.top),
  pointFrom(bounds.right, bounds.top),
  pointFrom(bounds.right, bounds.bottom),
  pointFrom(bounds.left, bounds.bottom),
];

export const regionCorners = (bounds: RegionBounds, scale: number) => {
  const size = Math.min(
    12 / scale,
    (bounds.right - bounds.left) / 3,
    (bounds.bottom - bounds.top) / 3,
  );
  return [
    [bounds.left, bounds.top, size, size],
    [bounds.right, bounds.top, -size, size],
    [bounds.left, bounds.bottom, size, -size],
    [bounds.right, bounds.bottom, -size, -size],
  ].map(([x, y, dx, dy]) => [
    [x + dx, y],
    [x, y],
    [x, y + dy],
  ]);
};

/** CircleToSearch: a gesture defines one padded, visible screen region. */
export const circleRegion = (
  path: readonly (readonly [number, number, ...number[]])[],
  viewport: RegionBounds,
  scale: number,
): RegionBounds | undefined => {
  if (path.length < 2 || !Number.isFinite(scale) || scale <= 0) {
    return;
  }
  const [left, top, right, bottom] = getLassoBounds(
    path.map(([x, y]) => pointFrom(x, y)),
  );
  if (
    ![left, top, right, bottom].every(Number.isFinite) ||
    Math.max(right - left, bottom - top) * scale < DRAGGING_THRESHOLD
  ) {
    return;
  }
  const padding = 12 / scale;
  const bounds = {
    left: Math.max(viewport.left, left - padding),
    top: Math.max(viewport.top, top - padding),
    right: Math.min(viewport.right, right + padding),
    bottom: Math.min(viewport.bottom, bottom + padding),
  };
  return bounds.right > bounds.left && bounds.bottom > bounds.top
    ? bounds
    : undefined;
};

export const regionHandleAt = (
  bounds: RegionBounds,
  point: { x: number; y: number },
  radius: number,
): RegionHandle | null => {
  for (const [handle, x, y] of [
    ["nw", bounds.left, bounds.top],
    ["ne", bounds.right, bounds.top],
    ["sw", bounds.left, bounds.bottom],
    ["se", bounds.right, bounds.bottom],
  ] as const) {
    if (Math.hypot(point.x - x, point.y - y) <= radius) {
      return handle;
    }
  }
  // Keep whole-object movement on the border; an interior drag draws a new circle.
  const nearX =
    point.x >= bounds.left - radius && point.x <= bounds.right + radius;
  const nearY =
    point.y >= bounds.top - radius && point.y <= bounds.bottom + radius;
  return (nearX &&
    Math.min(
      Math.abs(point.y - bounds.top),
      Math.abs(point.y - bounds.bottom),
    ) <= radius) ||
    (nearY &&
      Math.min(
        Math.abs(point.x - bounds.left),
        Math.abs(point.x - bounds.right),
      ) <= radius)
    ? "move"
    : null;
};

export const resizeRegion = (
  initial: RegionBounds,
  handle: Exclude<RegionHandle, "move">,
  point: { x: number; y: number },
  viewport: RegionBounds,
  scale: number,
): RegionBounds => {
  const bounds = { ...initial };
  const x = Math.max(viewport.left, Math.min(viewport.right, point.x));
  const y = Math.max(viewport.top, Math.min(viewport.bottom, point.y));
  bounds[handle.endsWith("w") ? "left" : "right"] = x;
  bounds[handle.startsWith("n") ? "top" : "bottom"] = y;
  return bounds.right - bounds.left >= 20 / scale &&
    bounds.bottom - bounds.top >= 20 / scale
    ? bounds
    : initial;
};
