import { simplify } from "points-on-curve";
import {
  lineSegment,
  lineSegmentIntersectionPoints,
  pointFrom,
  polygonIncludesPointNonZero,
} from "@fcboard/math";

import type { GlobalPoint } from "@fcboard/math";

type Point = { x: number; y: number };
export type EraseInterval = readonly [number, number];

export const mergeEraseIntervals = (intervals: EraseInterval[]) => {
  const merged: [number, number][] = [];
  for (const [start, end] of intervals.sort((a, b) => a[0] - b[0])) {
    if (end - start <= 1e-10) {
      continue;
    }
    const previous = merged.at(-1);
    if (previous && start <= previous[1] + 1e-10) {
      previous[1] = Math.max(previous[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
};

/** Use the selector's existing nonzero winding rule and segment intersections.
 * A concave or self-crossing loop can cut the same trajectory several times. */
export const createEraseRegion = (input: GlobalPoint[], precision = 0.125) => {
  if (input.some((point) => !point.every(Number.isFinite))) {
    return;
  }
  const distinct = input.filter(
    (point, index) =>
      !index ||
      point[0] !== input[index - 1][0] ||
      point[1] !== input[index - 1][1],
  );
  if (distinct.length < 3) {
    return;
  }
  const path = (
    precision > 0 ? simplify(distinct, precision) : distinct
  ) as GlobalPoint[];
  if (path.length < 3) {
    return;
  }
  const origin = path[0];
  const second = path.find(
    (point) => point[0] !== origin[0] || point[1] !== origin[1],
  );
  if (
    !second ||
    !path.some(
      (point) =>
        Math.abs(
          (second[0] - origin[0]) * (point[1] - origin[1]) -
            (second[1] - origin[1]) * (point[0] - origin[0]),
        ) > 1e-10,
    )
  ) {
    return;
  }
  const edges = path.flatMap((point, index) => {
    const next = path[(index + 1) % path.length];
    return point[0] === next[0] && point[1] === next[1]
      ? []
      : [
          {
            from: { x: point[0], y: point[1] },
            to: { x: next[0], y: next[1] },
            segment: lineSegment(point, next),
            left: Math.min(point[0], next[0]),
            right: Math.max(point[0], next[0]),
            top: Math.min(point[1], next[1]),
            bottom: Math.max(point[1], next[1]),
          },
        ];
  });
  const bounds = path.reduce(
    (box, [x, y]) => ({
      left: Math.min(box.left, x),
      right: Math.max(box.right, x),
      top: Math.min(box.top, y),
      bottom: Math.max(box.bottom, y),
    }),
    { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity },
  );
  const contains = (point: Point) =>
    polygonIncludesPointNonZero(pointFrom<GlobalPoint>(point.x, point.y), path);
  const classification = new WeakMap<Point, boolean>();
  const classify = (point: Point) => {
    const known = classification.get(point);
    if (known !== undefined) {
      return known;
    }
    const inside = contains(point);
    classification.set(point, inside);
    return inside;
  };
  const intervals = (a: Point, b: Point): EraseInterval[] => {
    if (
      Math.max(a.x, b.x) < bounds.left ||
      Math.min(a.x, b.x) > bounds.right ||
      Math.max(a.y, b.y) < bounds.top ||
      Math.min(a.y, b.y) > bounds.bottom
    ) {
      return [];
    }
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    if (length2 <= 1e-20) {
      return classify(a) ? [[0, 1]] : [];
    }
    const segment = lineSegment(
      pointFrom<GlobalPoint>(a.x, a.y),
      pointFrom<GlobalPoint>(b.x, b.y),
    );
    const breaks = [0, 1];
    for (const edge of edges) {
      if (
        Math.max(a.x, b.x) < edge.left ||
        Math.min(a.x, b.x) > edge.right ||
        Math.max(a.y, b.y) < edge.top ||
        Math.min(a.y, b.y) > edge.bottom
      ) {
        continue;
      }
      const hit = lineSegmentIntersectionPoints(segment, edge.segment, 1e-8);
      if (hit) {
        breaks.push(
          Math.max(
            0,
            Math.min(1, ((hit[0] - a.x) * dx + (hit[1] - a.y) * dy) / length2),
          ),
        );
      }
    }
    if (breaks.length === 2) {
      const inside = classify(a);
      classification.set(b, inside);
      return inside ? [[0, 1]] : [];
    }
    breaks.sort((a, b) => a - b);
    return breaks.slice(1).flatMap((end, index) => {
      const start = breaks[index];
      const middle = (start + end) / 2;
      return end - start > 1e-10 &&
        contains({ x: a.x + dx * middle, y: a.y + dy * middle })
        ? [[start, end] as const]
        : [];
    });
  };
  const containsSegment = (a: Point, b: Point) => {
    const parts = mergeEraseIntervals(intervals(a, b));
    return (
      parts.length === 1 && parts[0][0] <= 1e-10 && parts[0][1] >= 1 - 1e-10
    );
  };
  return { path, edges, bounds, contains, intervals, containsSegment };
};

export type EraseRegion = NonNullable<ReturnType<typeof createEraseRegion>>;
