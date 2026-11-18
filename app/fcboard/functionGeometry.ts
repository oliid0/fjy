import { compileExpression, functionView, sampleFunctionCurve } from "./math";

import type { Plot } from "./math";

type Point = { x: number; y: number };
export type GraphCurve = { expression: string; lines: number[][][] };
export type GraphIntersection = Point & { label: string; functions: number[] };
const geometry = new WeakMap<
  Plot,
  { curves: GraphCurve[]; intersections: GraphIntersection[] }
>();

/** Reuse the existing interval-checked sampler; disconnected pole branches
 * remain disconnected during drawing, hit testing and intersection bracketing. */
export const functionGeometry = (plot: Plot) => {
  const cached = geometry.get(plot);
  if (cached) {
    return cached;
  }
  if (
    plot.surface ||
    plot.relation ||
    !Number.isFinite(plot.range) ||
    plot.range <= 0 ||
    plot.range > 1000 ||
    (plot.compare?.length || 0) > 2
  ) {
    throw new Error("Invalid two-dimensional function graph");
  }
  const view = functionView(plot);
  const curves = [plot.expression, ...(plot.compare || [])].map(
    (expression) => ({
      expression,
      lines: sampleFunctionCurve(expression, view, {
        x: plot.x,
        y: plot.y,
        z: plot.z,
        a: plot.a,
        b: plot.b,
        c: plot.c,
      }),
    }),
  );
  if (curves.every((curve) => !curve.lines.length) && !plot.view) {
    throw new Error("No real-valued plot in this range");
  }
  const intersections: GraphIntersection[] = [];
  const epsilonX = Math.max(1e-9, (view.right - view.left) * 1e-9);
  const epsilonY = Math.max(1e-9, (view.top - view.bottom) * 1e-9);
  for (let first = 0; first < curves.length; first++) {
    for (let second = first + 1; second < curves.length; second++) {
      const compiled = [first, second].map((index) =>
        compileExpression(curves[index].expression),
      );
      const value = (x: number) => {
        try {
          const y = compiled.map((fn) => fn.evaluate({ ...plot, x }));
          return y.every(
            (number) => typeof number === "number" && Number.isFinite(number),
          )
            ? { difference: y[0] - y[1], y: y[0] + plot.z }
            : undefined;
        } catch {
          return undefined;
        }
      };
      const add = (x: number) => {
        const point = value(x);
        if (
          !point ||
          Math.abs(point.difference) > epsilonY ||
          point.y < view.bottom - epsilonY ||
          point.y > view.top + epsilonY
        ) {
          return;
        }
        const existing = intersections.find(
          (item) =>
            Math.abs(item.x - x) < epsilonX * 4 &&
            Math.abs(item.y - point.y) < epsilonY * 4,
        );
        if (existing) {
          existing.functions = [
            ...new Set([...existing.functions, first, second]),
          ];
        } else {
          intersections.push({
            x,
            y: point.y,
            functions: [first, second],
            label: "",
          });
        }
      };
      const segments = [first, second].map((index) =>
        curves[index].lines.flatMap((line) =>
          line.slice(1).map((point, i) => [line[i], point]),
        ),
      );
      const trace: ({ x: number; difference: number } | undefined)[] = [];
      const append = (x: number) => {
        const last = trace.at(-1);
        if (last && Math.abs(last.x - x) <= epsilonX) {
          return;
        }
        const point = value(x);
        trace.push(point ? { x, difference: point.difference } : undefined);
      };
      let a = 0;
      let b = 0;
      // Both sample streams are x-ordered. Sweep once instead of comparing
      // every segment in one curve with every segment in the other.
      while (a < segments[0].length && b < segments[1].length) {
        const left = Math.max(segments[0][a][0][0], segments[1][b][0][0]);
        const right = Math.min(segments[0][a][1][0], segments[1][b][1][0]);
        if (right >= left) {
          const last = trace.at(-1);
          if (last && left - last.x > epsilonX) {
            trace.push(undefined);
          }
          append(left);
          append(right);
        }
        if (segments[0][a][1][0] <= segments[1][b][1][0]) {
          a++;
        } else {
          b++;
        }
      }
      for (let i = 0; i < trace.length; i++) {
        const current = trace[i];
        const previous = trace[i - 1];
        const next = trace[i + 1];
        if (!current) {
          continue;
        }
        // Coincident intervals have infinitely many common points, not a row
        // of fabricated isolated intersections.
        if (
          Math.abs(current.difference) <= epsilonY &&
          ((previous && Math.abs(previous.difference) > epsilonY) ||
            (next && Math.abs(next.difference) > epsilonY))
        ) {
          add(current.x);
        }
        if (previous && previous.difference * current.difference < 0) {
          let left = previous.x;
          let right = current.x;
          let lower = previous.difference;
          for (let step = 0; step < 48; step++) {
            const middle = (left + right) / 2;
            const result = value(middle);
            if (!result) {
              break;
            }
            if (lower * result.difference <= 0) {
              right = middle;
            } else {
              left = middle;
              lower = result.difference;
            }
          }
          add((left + right) / 2);
        }
        // A tangent can touch without a sign change. Refine a local minimum
        // of the actual residual, then accept only an actual numerical zero.
        if (
          previous &&
          next &&
          Math.abs(current.difference) < Math.abs(previous.difference) &&
          Math.abs(current.difference) < Math.abs(next.difference) &&
          previous.difference * next.difference > 0
        ) {
          let left = previous.x;
          let right = next.x;
          for (let step = 0; step < 48; step++) {
            const x1 = left + (right - left) / 3;
            const x2 = right - (right - left) / 3;
            const v1 = value(x1);
            const v2 = value(x2);
            if (!v1 || !v2) {
              break;
            }
            if (Math.abs(v1.difference) < Math.abs(v2.difference)) {
              right = x2;
            } else {
              left = x1;
            }
          }
          add((left + right) / 2);
        }
      }
    }
  }
  intersections
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .forEach((point, index) => {
      point.label = `${String.fromCharCode(97 + (index % 26))}${
        index >= 26 ? Math.floor(index / 26) : ""
      }`;
    });
  const result = { curves, intersections };
  geometry.set(plot, result);
  return result;
};
