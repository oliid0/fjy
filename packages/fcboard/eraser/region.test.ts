import { pointFrom } from "@fcboard/math";

import type { GlobalPoint } from "@fcboard/math";

import { createEraseRegion } from "./region";

const loop = (points: [number, number][]) =>
  points.map(([x, y]) => pointFrom<GlobalPoint>(x, y));
const concave = loop([
  [20, -20],
  [40, -20],
  [40, 10],
  [60, 10],
  [60, -20],
  [80, -20],
  [80, 20],
  [20, 20],
]);

it("finds every entry and exit through a concave loop even when both segment ends are outside", () => {
  const region = createEraseRegion(concave)!;
  expect(region.intervals({ x: 0, y: 0 }, { x: 100, y: 0 })).toEqual([
    [0.2, 0.4],
    [0.6, 0.8],
  ]);
  expect(region.containsSegment({ x: 30, y: 0 }, { x: 70, y: 0 })).toBe(false);
  expect(region.containsSegment({ x: 25, y: 15 }, { x: 75, y: 15 })).toBe(true);
});

it("preserves the original nonzero winding rule for self-crossing loops", () => {
  const region = createEraseRegion(
    loop([
      [0, 0],
      [100, 100],
      [0, 100],
      [100, 0],
    ]),
  )!;
  expect(region.contains({ x: 50, y: 20 })).toBe(true);
  expect(region.contains({ x: 50, y: 80 })).toBe(true);
  expect(region.contains({ x: 10, y: 50 })).toBe(false);
});

it("does not treat an open line, invalid coordinate, or repeated tap as an erase area", () => {
  expect(
    createEraseRegion(
      loop([
        [1, 1],
        [1, 1],
        [1, 1],
      ]),
    ),
  ).toBeUndefined();
  expect(
    createEraseRegion(
      loop([
        [0, 0],
        [50, 0],
        [100, 0],
      ]),
      0,
    ),
  ).toBeUndefined();
  expect(
    createEraseRegion(
      loop([
        [0, 0],
        [50, NaN],
        [100, 0],
      ]),
    ),
  ).toBeUndefined();
});

it("reduces dense straight contacts using the existing subpixel simplifier before clipping strokes", () => {
  const path = loop(
    Array.from({ length: 2001 }, (_, i): [number, number] => [
      i / 10,
      0,
    ]).concat([
      [200, 100],
      [0, 100],
      [0, 0],
    ]),
  );
  const region = createEraseRegion(path, 0.125)!;
  expect(region.path.length).toBeLessThanOrEqual(5);
  expect(region.contains({ x: 100, y: 50 })).toBe(true);
  expect(path.length).toBe(2004);
});
