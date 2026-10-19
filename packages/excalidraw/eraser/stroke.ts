import { getSizeFromPoints } from "@excalidraw/common";
import {
  getElementAbsoluteCoords,
  getElementBounds,
  newElementWith,
} from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";
import {
  factoryBrushSamples,
  isFactoryBrush,
} from "@excalidraw/element/factoryBrush";

import type { ExcalidrawFreeDrawElement } from "@excalidraw/element/types";
import type { LocalPoint, Radians } from "@excalidraw/math";

type Point = { x: number; y: number };
type Sample = Point & {
  pressure: number;
  distance: number;
  brushWidth: number;
};
const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Minkowski sum of a motion segment and the APK's rectangular eraser footprint. */
const sweptRectangle = (
  from: Point,
  to: Point,
  width: number,
  height: number,
) => {
  const corners = [from, to].flatMap((p) =>
    [-1, 1].flatMap((x) =>
      [-1, 1].map((y) => ({
        x: p.x + (x * width) / 2,
        y: p.y + (y * height) / 2,
      })),
    ),
  );
  const points = corners
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .filter((p, i, all) => !i || p.x !== all[i - 1].x || p.y !== all[i - 1].y);
  const half = (values: Point[]) => {
    const hull: Point[] = [];
    for (const p of values) {
      while (
        hull.length > 1 &&
        cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0
      ) {
        hull.pop();
      }
      hull.push(p);
    }
    return hull.slice(0, -1);
  };
  return [...half(points), ...half([...points].reverse())];
};

/** Clip a segment to a convex swept area; exact intersections preserve sparse, fast strokes. */
const insideInterval = (a: Point, b: Point, polygon: Point[]) => {
  let enter = 0;
  let exit = 1;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i];
    const q = polygon[(i + 1) % polygon.length];
    const start = cross(p, q, a);
    const delta = cross(p, q, b) - start;
    if (Math.abs(delta) < 1e-10) {
      if (start < 0) {
        return null;
      }
    } else if (delta > 0) {
      enter = Math.max(enter, -start / delta);
    } else {
      exit = Math.min(exit, -start / delta);
    }
    if (enter > exit) {
      return null;
    }
  }
  return [enter, exit] as const;
};

/** Null means untouched; survivors remain editable, serializable vector strokes. */
export const eraseStroke = (
  element: ExcalidrawFreeDrawElement,
  from: Point,
  to: Point,
  width: number,
  height: number,
): ExcalidrawFreeDrawElement[] | null => {
  if (element.locked || element.isDeleted || !element.points.length) {
    return null;
  }
  const brush = isFactoryBrush(element) ? factoryBrushSamples(element) : null;
  const cap = brush
    ? brush.reduce((maximum, sample) => Math.max(maximum, sample.width), 0)
    : element.strokeWidth * (element.customData?.fcInk ? 1 : 4.25);
  const bounds = getElementBounds(element, new Map());
  if (
    Math.max(from.x, to.x) + (width + cap) / 2 < bounds[0] ||
    Math.min(from.x, to.x) - (width + cap) / 2 > bounds[2] ||
    Math.max(from.y, to.y) + (height + cap) / 2 < bounds[1] ||
    Math.min(from.y, to.y) - (height + cap) / 2 > bounds[3]
  ) {
    return null;
  }
  const [, , , , cx, cy] = getElementAbsoluteCoords(element, new Map());
  const cos = Math.cos(element.angle);
  const sin = Math.sin(element.angle);
  const brushAngle =
    (element.customData?.fcInk?.brushAngle || 0) + element.angle;
  const brushCos = Math.cos(brushAngle);
  const brushSin = Math.sin(brushAngle);
  let travelled = element.customData?.fcInk?.dashOffset || 0;
  const input = brush || element.points.map(([x, y]) => ({ x, y, width: 0 }));
  const samples = input.map(({ x, y, width: brushWidth }, i): Sample => {
    if (i) {
      travelled += Math.hypot(x - input[i - 1].x, y - input[i - 1].y);
    }
    const dx = element.x + x - cx;
    const dy = element.y + y - cy;
    return {
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos,
      pressure: element.pressures[i] ?? 0.5,
      distance: travelled,
      brushWidth,
    };
  });
  // Include the stroke cap so a cut doesn't leave half a round cap in the erased area.
  const area = sweptRectangle(from, to, width + cap, height + cap);
  const result: Sample[][] = [];
  let current: Sample[] = [];
  let touched = false;
  const flush = () => {
    if (current.length) {
      result.push(current);
      current = [];
    }
  };
  const interpolate = (a: Sample, b: Sample, t: number): Sample => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    pressure: a.pressure + (b.pressure - a.pressure) * t,
    distance: a.distance + (b.distance - a.distance) * t,
    brushWidth: a.brushWidth + (b.brushWidth - a.brushWidth) * t,
  });
  if (samples.length === 1) {
    return insideInterval(samples[0], samples[0], area) ? [] : null;
  }
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const brushCap = Math.max(a.brushWidth, b.brushWidth);
    const hit = insideInterval(
      a,
      b,
      brush
        ? sweptRectangle(
            from,
            to,
            width + brushCap * Math.hypot(brushCos, brushSin / 2),
            height + brushCap * Math.hypot(brushSin, brushCos / 2),
          )
        : area,
    );
    const cut = hit && hit[1] - hit[0] > 1e-10;
    touched ||= !!cut;
    const intervals = !cut
      ? [[0, 1]]
      : [
          ...(hit[0] > 0 ? [[0, hit[0]]] : []),
          ...(hit[1] < 1 ? [[hit[1], 1]] : []),
        ];
    if (!intervals.length) {
      flush();
    }
    for (const [start, end] of intervals) {
      const first = interpolate(a, b, start);
      const last = current[current.length - 1];
      if (!last || Math.hypot(last.x - first.x, last.y - first.y) > 1e-7) {
        flush();
        current.push(first);
      }
      current.push(interpolate(a, b, end));
      if (end < 1) {
        flush();
      }
    }
  }
  flush();
  if (!touched) {
    return null;
  }
  return result.map((fragment, i) => {
    const first = fragment[0];
    const points = fragment.map((p) =>
      pointFrom<LocalPoint>(p.x - first.x, p.y - first.y),
    );
    const base = i
      ? { ...element, id: crypto.randomUUID(), version: 0 }
      : element;
    return newElementWith(base, {
      x: first.x,
      y: first.y,
      angle: 0 as Radians,
      ...(brush ||
      (element.customData?.fcInk && element.strokeStyle === "dashed")
        ? {
            customData: {
              ...element.customData,
              fcInk: {
                ...element.customData?.fcInk,
                dashOffset: first.distance,
                ...(brush
                  ? {
                      brushWidths: fragment.map(
                        (p) => p.brushWidth / element.strokeWidth,
                      ),
                      brushAngle,
                    }
                  : {}),
              },
            },
          }
        : {}),
      points,
      pressures: element.simulatePressure
        ? []
        : fragment.map((p) => p.pressure),
      ...getSizeFromPoints(points),
    });
  });
};

export const pointerSamples = (event: PointerEvent) => {
  const samples = event.getCoalescedEvents?.() || [];
  return samples.length ? [...samples, event] : [event];
};

export const isPalmContact = (
  event: Pick<PointerEvent, "pointerType" | "width" | "height">,
  threshold: number,
) =>
  event.pointerType === "touch" &&
  Math.max(event.width || 0, event.height || 0) >= threshold;
