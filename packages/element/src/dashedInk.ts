import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";

/** Split by travelled distance, matching HDashedCurveObject's DashPathEffect. */
export const dashedInk = (
  points: readonly LocalPoint[],
  pressures: readonly number[],
  dash: number,
  gap: number,
  offset = 0,
) => {
  const parts: { points: LocalPoint[]; pressures: number[] }[] = [];
  if (
    !points.length ||
    !Number.isFinite(dash + gap + offset) ||
    dash <= 0 ||
    gap <= 0
  ) {
    return parts;
  }
  if (points.length === 1) {
    return [{ points: [...points], pressures: [...pressures] }];
  }
  const phase = ((offset % (dash + gap)) + dash + gap) % (dash + gap);
  let visible = phase < dash;
  let remaining = visible ? dash - phase : dash + gap - phase;
  let current: typeof parts[number] = { points: [], pressures: [] };
  const flush = () => {
    if (current.points.length) {
      parts.push(current);
    }
    current = { points: [], pressures: [] };
  };
  const append = (
    a: LocalPoint,
    b: LocalPoint,
    fraction: number,
    pressureA: number,
    pressureB: number,
  ) => {
    current.points.push(
      pointFrom<LocalPoint>(
        a[0] + (b[0] - a[0]) * fraction,
        a[1] + (b[1] - a[1]) * fraction,
      ),
    );
    if (pressures.length) {
      current.pressures.push(pressureA + (pressureB - pressureA) * fraction);
    }
  };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let travelled = 0;
    while (travelled < length - 1e-9) {
      const step = Math.min(remaining, length - travelled);
      if (visible && !current.points.length) {
        append(
          a,
          b,
          travelled / length,
          pressures[i - 1] ?? 0.5,
          pressures[i] ?? 0.5,
        );
      }
      travelled += step;
      remaining -= step;
      if (visible) {
        append(
          a,
          b,
          travelled / length,
          pressures[i - 1] ?? 0.5,
          pressures[i] ?? 0.5,
        );
      }
      if (remaining < 1e-9) {
        if (visible) {
          flush();
        }
        visible = !visible;
        remaining = visible ? dash : gap;
      }
    }
  }
  flush();
  return parts;
};
