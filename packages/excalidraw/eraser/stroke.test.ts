import { pointFrom } from "@excalidraw/math";

import type { LocalPoint, Radians } from "@excalidraw/math";

import { API } from "../tests/helpers/api";

import { eraseStroke, isPalmContact } from "./stroke";

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
