import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";

import { API } from "../../fcboard/tests/helpers/api";
import { factoryPath2D } from "../src/factoryPath";
import {
  traceFactoryInk,
  factoryInkPath,
  finishFactoryInk,
} from "../src/factoryInk";
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
  it("tapers only the lifted tip and invalidates the live Canvas path, retaining old strokes", () => {
    const input = brush();
    const liveWidths = factoryBrushWidths(input);
    const livePath = factoryPath2D(input);
    Object.assign(
      input.customData.fcInk,
      finishFactoryInk({ version: 3, pen: "brush", unit: 1 }),
    );
    const completed = factoryBrushWidths(input);
    expect(completed.slice(0, -1)).toEqual(liveWidths.slice(0, -1));
    expect(completed.at(-1)).toBe(0);
    expect(factoryBrushSamples(input).at(-1)?.width).toBe(0);
    expect(factoryPath2D(input)).not.toBe(livePath);
    expect(factoryBrushPath(input)).not.toMatch(/NaN|Infinity|a0,0/);
    const dot = { ...input, points: [input.points[0]] };
    expect(factoryBrushWidths(dot)[0]).toBeGreaterThan(0);
    expect(factoryBrushPath(dot)).toContain("a");
    expect(finishFactoryInk(undefined)).toBeUndefined();
  });

  it("appends only new hard-pen quadratics and resets the cache when old samples change", () => {
    const OriginalPath = Path2D;
    const commands = vi.fn();
    vi.stubGlobal(
      "Path2D",
      class extends OriginalPath {
        constructor() {
          super();
          const quadratic = this.quadraticCurveTo.bind(this);
          this.quadraticCurveTo = (...args) => {
            commands(...args);
            quadratic(...args);
          };
        }
      },
    );
    try {
      const input = {
        ...brush(),
        customData: { fcInk: { version: 2, pen: "hard", unit: 1 } },
      };
      const first = factoryPath2D(input);
      expect(commands).toHaveBeenCalledTimes(2);
      input.points = [...input.points, pointFrom<LocalPoint>(300, 40)];
      input.version++;
      const second = factoryPath2D(input);
      expect(second).not.toBe(first);
      expect(commands).toHaveBeenCalledTimes(3);
      expect(commands.mock.lastCall).toEqual([200, 0, 250, 20]);
      input.points = input.points.map((point, index) =>
        index === 1 ? pointFrom<LocalPoint>(90, 30) : point,
      );
      input.version++;
      factoryPath2D(input);
      expect(commands).toHaveBeenCalledTimes(6);
      expect(commands.mock.calls.at(-2)).toEqual([90, 30, 145, 15]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("creates native Canvas ellipses from the same SVG stamps and reuses unchanged geometry", () => {
    const OriginalPath = Path2D;
    const ellipse = vi.fn();
    vi.stubGlobal(
      "Path2D",
      class extends OriginalPath {
        constructor() {
          super();
          const original = this.ellipse.bind(this);
          this.ellipse = (...args) => {
            ellipse(...args);
            original(...args);
          };
        }
      },
    );
    try {
      const input = brush();
      const path = factoryPath2D(input);
      const count = (factoryBrushPath(input).match(/M/g) || []).length;
      expect(ellipse).toHaveBeenCalledTimes(count);
      expect(ellipse.mock.calls[0].slice(0, 5)).toEqual([0, 0, 15.64, 7.82, 0]);
      expect(factoryPath2D(input)).toBe(path);
      expect(ellipse).toHaveBeenCalledTimes(count);
      input.points = [...input.points, pointFrom<LocalPoint>(300, 20)];
      input.version++;
      expect(factoryPath2D(input)).not.toBe(path);
      const full = (factoryBrushPath(input).match(/M/g) || []).length;
      expect(ellipse.mock.calls.length - count).toBeLessThan(full);
      const last = ellipse.mock.calls.at(-1)!;
      expect(last.slice(0, 2)).toEqual([300, 20]);
      expect(last[2] / last[3]).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("uses identical rounded quadratic commands for native Canvas and SVG", () => {
    const input = {
      ...brush(),
      customData: { fcInk: { version: 2, pen: "hard", unit: 1 } },
    };
    const target = {
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
    };
    traceFactoryInk(input, target);
    expect(target.moveTo).toHaveBeenCalledWith(0, 0);
    expect(target.quadraticCurveTo.mock.calls).toEqual([
      [0, 0, 50, 0],
      [100, 0, 150, 0],
    ]);
    expect(target.lineTo).toHaveBeenCalledWith(200, 0);
    expect(factoryInkPath(input)).toBe("M0,0 Q0,0 50,0 Q100,0 150,0 L200,0");
  });
  it("stores the configured Java variation factor in each stroke, including fixed width at zero", () => {
    const input = brush();
    const widths = factoryBrushWidths({
      ...input,
      customData: { fcInk: { ...input.customData.fcInk, variation: 0 } },
    });
    expect(widths).toEqual([23, 23, 23]);
    const changing = factoryBrushWidths({
      ...input,
      customData: { fcInk: { ...input.customData.fcInk, variation: 50 } },
    });
    expect(changing[2]).toBeLessThan(changing[0]);
    expect(changing).not.toEqual(factoryBrushWidths(input));
  });
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
