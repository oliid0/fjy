import { pointFrom } from "@fcboard/math";
import { exportToSvg } from "@fcboard/fcboard";

import type { LocalPoint } from "@fcboard/math";

import { API } from "../../fcboard/tests/helpers/api";
import { getDefaultAppState } from "../../fcboard/appState";
import { factoryInkPath } from "../src/factoryInk";
import {
  factoryNibControls,
  factoryNibPath,
  traceFactoryNib,
} from "../src/factoryNib";
import { eraseStroke } from "../../fcboard/eraser/stroke";

const hard = () => ({
  ...API.createElement({
    type: "freedraw",
    strokeWidth: 4,
    points: [
      [0, 0],
      [40, 20],
      [80, 20],
      [120, 20],
      [120, 20],
    ].map(([x, y]) => pointFrom<LocalPoint>(x, y)),
  }),
  customData: {
    fcInk: { version: 2, pen: "hard", unit: 1, nib: true, finished: true },
  },
});

describe("factory hard-pen lift", () => {
  it("fills the native two-quadratic nib separately from the round body in SVG and Canvas commands", async () => {
    const input = hard();
    const controls = factoryNibControls(input)!;
    // HCurveObject ends the body at the last MOVE midpoint (100, 20),
    // then fills RectUtil's two tangent quadratics to the UP midpoint (120, 20).
    expect(factoryInkPath(input)).toBe(
      "M0,0 Q0,0 20,10 Q40,20 60,20 Q80,20 100,20",
    );
    expect(controls).toHaveLength(5);
    expect(controls[2]).toEqual([120, 20]);
    expect(controls[0][0]).toBeCloseTo(100.2, 4);
    expect(controls[0][1]).toBeCloseTo(21.989974874, 5);
    const target = {
      moveTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      closePath: vi.fn(),
    };
    expect(traceFactoryNib(input, target)).toBe(true);
    expect(target.moveTo).toHaveBeenCalledWith(...controls[0]);
    expect(target.quadraticCurveTo.mock.calls).toEqual([
      [...controls[1], ...controls[2]],
      [...controls[3], ...controls[4]],
    ]);
    expect(target.closePath).toHaveBeenCalledTimes(1);
    const svg = await exportToSvg({
      elements: [input],
      appState: getDefaultAppState(),
      files: {},
    });
    const paths = [...svg.querySelectorAll("path")];
    expect(
      paths
        .find((path) => path.getAttribute("d") === factoryInkPath(input))
        ?.getAttribute("fill"),
    ).toBe("none");
    const tip = paths.filter(
      (path) => path.getAttribute("d") === factoryNibPath(input),
    );
    expect(tip).toHaveLength(1);
    expect(tip[0].getAttribute("fill")).toBe(input.strokeColor);
    expect(tip[0].hasAttribute("stroke")).toBe(false);
  });

  it("leaves old ink unchanged and suppresses nibs for live ink, other pens, auto-shapes and closed strokes", () => {
    const input = hard();
    for (const patch of [
      { nib: undefined },
      { nib: false },
      { finished: false },
      { pen: "dashed" },
      { pen: "rainbow" },
      { pen: "highlighter" },
      { assist: "shape" },
    ]) {
      const other = {
        ...input,
        customData: { fcInk: { ...input.customData.fcInk, ...patch } },
      };
      expect(factoryNibControls(other)).toBeUndefined();
      expect(factoryInkPath(other)).toContain("L120,20");
    }
    const closed = {
      ...input,
      points: [
        ...input.points.slice(0, 3),
        pointFrom<LocalPoint>(10, 0),
        pointFrom<LocalPoint>(0, 0),
      ],
    };
    expect(factoryNibControls(closed)).toBeUndefined();
    expect(
      factoryNibControls({ ...input, points: input.points.slice(0, 3) }),
    ).toBeUndefined();
  });

  it("keeps only the original surviving tail after a cut and does not grow nibs on cut ends", () => {
    const input = hard();
    const controls = factoryNibControls(input)!;
    const fragments = eraseStroke(
      input,
      { x: 50, y: 20 },
      { x: 50, y: 20 },
      4,
      4,
    )!;
    expect(fragments).toHaveLength(2);
    expect(factoryNibControls(fragments[0])).toBeUndefined();
    expect(
      factoryNibControls(fragments[1])!.map(([x, y]) => [
        x + fragments[1].x,
        y + fragments[1].y,
      ]),
    ).toEqual(controls);
    const originalTail = fragments[1];
    const withoutTail = eraseStroke(
      originalTail,
      { x: 115, y: 20 },
      { x: 115, y: 20 },
      3,
      3,
    )!;
    expect(withoutTail).toHaveLength(1);
    expect(factoryNibControls(withoutTail[0])).toBeUndefined();
    expect(withoutTail[0].points).toEqual(originalTail.points);
    expect(withoutTail[0].customData?.fcInk?.centerline).toBe(true);
  });
});
