import { pointFrom } from "@fcboard/math";
import { factoryBrushSamples } from "@fcboard/element/factoryBrush";

import type { LocalPoint, Radians } from "@fcboard/math";

import { API } from "../tests/helpers/api";

import { eraseStroke, eraseSceneObjects, isPalmContact } from "./stroke";

const stroke = () => ({
  ...API.createElement({
    type: "freedraw",
    x: 0,
    y: 0,
    points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(100, 0)],
    strokeWidth: 4,
    groupIds: ["lesson"],
  }),
  customData: { fcInk: { pen: "hard" } },
  simulatePressure: false,
  pressures: [0.2, 0.8],
});

describe("local stroke erasure", () => {
  it("sweeps the complete object footprint between fast samples and removes its group without touching locked contents", () => {
    const line = API.createElement({
      type: "line",
      x: 100,
      y: 100,
      points: [pointFrom(0, 0), pointFrom(200, 0)],
      groupIds: ["one-object"],
    });
    const part = API.createElement({
      type: "line",
      x: 100,
      y: 400,
      points: [pointFrom(0, 0), pointFrom(200, 0)],
      groupIds: ["one-object"],
    });
    const locked = API.createElement({
      type: "rectangle",
      x: 200,
      y: 100,
      locked: true,
      groupIds: ["one-object"],
    });
    const outside = API.createElement({ type: "line", x: 100, y: 500 });
    const result = eraseSceneObjects(
      [line, part, locked, outside],
      { x: 0, y: 110 },
      { x: 500, y: 110 },
      20,
      30,
    );
    expect(
      result
        .filter((element) => element.isDeleted)
        .map((element) => element.id),
    ).toEqual([line.id, part.id]);
    expect(result.find((element) => element.id === locked.id)).toBe(locked);
    expect(result.find((element) => element.id === outside.id)).toBe(outside);
  });

  it("does not erase the empty interior of an outline shape but erases a filled shape at the same position", () => {
    const outline = API.createElement({
      type: "rectangle",
      x: 100,
      y: 100,
      width: 200,
      height: 200,
      backgroundColor: "transparent",
    });
    const elements = [outline];
    expect(
      eraseSceneObjects(
        elements,
        { x: 180, y: 180 },
        { x: 220, y: 220 },
        10,
        10,
      ),
    ).toBe(elements);
    const filled = { ...outline, backgroundColor: "#ff0000" };
    expect(
      eraseSceneObjects(
        [filled],
        { x: 180, y: 180 },
        { x: 220, y: 220 },
        10,
        10,
      )[0].isDeleted,
    ).toBe(true);
  });
  it("erases the visible quadratic curve rather than its raw control polygon, without smoothing surviving fragments again", () => {
    const input = {
      ...stroke(),
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(100, 200),
        pointFrom<LocalPoint>(200, 0),
      ],
      customData: { fcInk: { version: 2, pen: "hard", unit: 1 } },
    };
    // The second quadratic peaks at (100,150); neither raw segment passes here.
    const parts = eraseStroke(
      input,
      { x: 100, y: 150 },
      { x: 100, y: 150 },
      6,
      6,
    )!;
    expect(parts).toHaveLength(2);
    expect(
      eraseStroke(input, { x: 100, y: 200 }, { x: 100, y: 200 }, 6, 6),
    ).toBeNull();
    expect(parts[0].points.at(-1)![0] + parts[0].x).toBeLessThan(100);
    expect(parts[1].x).toBeGreaterThan(100);
    for (const part of parts) {
      expect(part.customData?.fcInk.centerline).toBe(true);
      expect(Math.max(...part.points.map((p) => p[1] + part.y))).toBeLessThan(
        150,
      );
    }
    const again = eraseStroke(
      parts[0],
      { x: 40, y: 80 },
      { x: 40, y: 80 },
      6,
      6,
    )!;
    expect(again).toHaveLength(2);
    expect(again[0].points[0]).toEqual(parts[0].points[0]);
    expect(again[1].points.at(-1)![0] + again[1].x).toBeCloseTo(
      parts[0].points.at(-1)![0] + parts[0].x,
    );
    expect(again[1].points.at(-1)![1] + again[1].y).toBeCloseTo(
      parts[0].points.at(-1)![1] + parts[0].y,
    );
  });
  it("keeps the brush curve and width on both sides of a cut, including repeated cuts", () => {
    const input = {
      ...stroke(),
      simulatePressure: true,
      strokeWidth: 15,
      points: [0, 50, 100, 150, 200].map((x) => pointFrom<LocalPoint>(x, 0)),
      customData: {
        fcInk: { version: 3, pen: "brush", unit: 1, finished: true },
      },
    };
    const original = factoryBrushSamples(input);
    const parts = eraseStroke(
      input,
      { x: 100, y: -30 },
      { x: 100, y: 30 },
      10,
      12,
    )!;
    expect(parts).toHaveLength(2);
    expect(factoryBrushSamples(parts[0]).at(-1)!.width).toBeGreaterThan(0);
    expect(factoryBrushSamples(parts[1]).at(-1)!.width).toBe(0);
    for (const part of parts) {
      const samples = factoryBrushSamples(part);
      expect(samples).toHaveLength(part.points.length);
      for (const sample of samples) {
        const previous = original.find(
          (p) => Math.abs(p.x - sample.x - part.x) < 1e-7,
        );
        if (previous) {
          expect(sample.width).toBeCloseTo(previous.width, 6);
        }
      }
    }
    const second = eraseStroke(
      parts[1],
      { x: 170, y: -30 },
      { x: 170, y: 30 },
      4,
      5,
    )!;
    expect(second).toHaveLength(2);
    expect(factoryBrushSamples(second[0]).at(-1)!.width).toBeGreaterThan(0);
    expect(factoryBrushSamples(second[1]).at(-1)!.width).toBe(0);
    expect(factoryBrushSamples(second[0])[0].width).toBeCloseTo(
      factoryBrushSamples(parts[1])[0].width,
    );
    const rotated = eraseStroke(
      { ...input, angle: (Math.PI / 2) as Radians },
      { x: 100, y: 0 },
      { x: 100, y: 0 },
      10,
      12,
    )!;
    expect(rotated).toHaveLength(2);
    expect(rotated[0].customData?.fcInk.brushAngle).toBe(Math.PI / 2);
  });
  it("retains the original dashed pen phase on each surviving fragment", () => {
    const input = {
      ...stroke(),
      strokeStyle: "dashed" as const,
      customData: { fcInk: { pen: "dashed", unit: 1, dashOffset: 18 } },
    };
    const parts = eraseStroke(
      input,
      { x: 50, y: -20 },
      { x: 50, y: 20 },
      20,
      24,
    )!;
    expect(parts[0].customData?.fcInk.dashOffset).toBeCloseTo(18);
    expect(parts[1].customData?.fcInk.dashOffset).toBeCloseTo(80);
  });
  it("cuts a sparsely sampled stroke at exact swept boundaries and interpolates pressure", () => {
    const input = stroke();
    const parts = eraseStroke(
      input,
      { x: 50, y: -20 },
      { x: 50, y: 20 },
      20,
      24,
    )!;
    expect(parts).toHaveLength(2);
    expect(parts[0].id).toBe(input.id);
    expect(parts[1].id).not.toBe(input.id);
    expect(parts[0].points.at(-1)![0]).toBeCloseTo(38);
    expect(parts[1].x).toBeCloseTo(62);
    expect(parts[0].pressures.at(-1)).toBeCloseTo(0.428);
    expect(parts[1].pressures[0]).toBeCloseTo(0.572);
    expect(parts.every((part) => part.groupIds[0] === "lesson")).toBe(true);
    expect(input.points).toHaveLength(2);
  });
  it("does not erase a nearby stroke, and removes only a dot within the eraser", () => {
    const input = stroke();
    expect(
      eraseStroke(input, { x: 50, y: 40 }, { x: 60, y: 40 }, 20, 24),
    ).toBeNull();
    const dot = { ...input, points: [pointFrom<LocalPoint>(0, 0)] };
    expect(eraseStroke(dot, { x: 0, y: 0 }, { x: 0, y: 0 }, 20, 24)).toEqual(
      [],
    );
    expect(
      eraseStroke(
        { ...input, locked: true },
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        20,
        24,
      ),
    ).toBeNull();
  });
  it("cuts rotated handwriting in scene coordinates and preserves its remaining orientation", () => {
    const input = { ...stroke(), angle: (Math.PI / 2) as Radians };
    const parts = eraseStroke(input, { x: 50, y: 0 }, { x: 50, y: 0 }, 20, 24)!;
    expect(parts).toHaveLength(2);
    expect(parts[0].x).toBeCloseTo(50);
    expect(parts[1].x).toBeCloseTo(50);
    expect(parts[0].y).toBeCloseTo(-50);
    expect(parts[1].y).toBeGreaterThan(0);
    expect(parts.every((part) => part.angle === 0)).toBe(true);
  });
  it("uses contact geometry rather than pressure, resolution, or a finger count guess", () => {
    expect(
      isPalmContact({ pointerType: "touch", width: 48, height: 60 }, 36),
    ).toBe(true);
    expect(
      isPalmContact({ pointerType: "touch", width: 8, height: 8 }, 36),
    ).toBe(false);
    expect(
      isPalmContact({ pointerType: "pen", width: 60, height: 60 }, 36),
    ).toBe(false);
  });
});
