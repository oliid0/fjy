import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";

import { API } from "../../excalidraw/tests/helpers/api";
import {
  factoryBrushPath,
  factoryBrushSamples,
  factoryBrushWidths,
} from "../src/factoryBrush";

const brush = () => ({
  ...API.createElement({
    type: "freedraw",
    points: [0, 100, 200].map((x) => pointFrom<LocalPoint>(x, 0)),
    strokeWidth: 15,
  }),
  simulatePressure: true,
  customData: { fcInk: { version: 3, pen: "brush", unit: 1 } },
});

describe("factory brush geometry", () => {
  it("matches the Java width recurrence for a fast finger stroke", () => {
    const widths = factoryBrushWidths(brush());
    // Base 15 + 15/3 + 3 = 23; variation 45/50, maximum 1.36,
    // minimum .172 and smoothing .84 once weighted distance saturates.
    expect(widths[0]).toBeCloseTo(31.28, 6);
    expect(widths[1]).toBeCloseTo(8.32784, 6);
    expect(widths[2]).toBeCloseTo(4.6554944, 6);
  });

  it("responds to actual pen pressure, and reproduces physical widths at different densities", () => {
    const input = brush();
    const low = factoryBrushWidths({
      ...input,
      simulatePressure: false,
      pressures: [0, 0, 0],
    });
    const high = factoryBrushWidths({
      ...input,
      simulatePressure: false,
      pressures: [1, 1, 1],
    });
    expect(low[0]).toBeCloseTo(31.28 * 0.8785);
    expect(high[0]).toBeCloseTo(31.28 * 1.1215);
    const baseline = factoryBrushWidths(input);
    for (const dpr of [2, 3]) {
      const scaled = {
        ...input,
        strokeWidth: input.strokeWidth / dpr,
        points: input.points.map(([x, y]) =>
          pointFrom<LocalPoint>(x / dpr, y / dpr),
        ),
        customData: { fcInk: { ...input.customData.fcInk, unit: 1 / dpr } },
      };
      factoryBrushWidths(scaled).forEach((width, i) =>
        expect(width * dpr).toBeCloseTo(baseline[i], 6),
      );
    }
  });

  it("retains the latest real tip and uses horizontal 2:1 filled ellipse stamps", () => {
    const input = brush();
    const samples = factoryBrushSamples(input);
    expect(samples.at(-1)).toEqual({
      x: 200,
      y: 0,
      width: factoryBrushWidths(input).at(-1),
    });
    const path = factoryBrushPath(input);
    expect(path.startsWith("M-15.64,0a15.64,7.82 0 1 0 31.28,0")).toBe(true);
    expect(path).not.toMatch(/NaN|Infinity/);
    const dot = { ...input, points: [pointFrom<LocalPoint>(0, 0)] };
    expect(factoryBrushPath(dot)).toContain("a15.64,7.82");
    expect(factoryBrushPath({ ...input, points: [] })).toBe("");
  });
});
