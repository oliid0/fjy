import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";

import { dashedInk } from "../src/dashedInk";

describe("factory dashed pen", () => {
  it("preserves dash and gap lengths across sparse samples and interpolates pressure", () => {
    const parts = dashedInk(
      [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(40, 0)],
      [0.2, 1],
      8,
      10,
    );
    expect(
      parts.map((part) => [part.points[0][0], part.points.at(-1)![0]]),
    ).toEqual([
      [0, 8],
      [18, 26],
      [36, 40],
    ]);
    expect(parts[0].pressures.at(-1)).toBeCloseTo(0.36);
    expect(parts[1].pressures[0]).toBeCloseTo(0.56);
  });
  it("keeps phase after a partial erase instead of restarting a dash at the cut", () => {
    const parts = dashedInk(
      [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(38, 0)],
      [],
      8,
      10,
      62,
    );
    expect(
      parts.map((part) => [part.points[0][0], part.points.at(-1)![0]]),
    ).toEqual([
      [10, 18],
      [28, 36],
    ]);
  });
});
