import { getFactoryGesture } from "../gesture";

describe("factory multi-finger measure", () => {
  it("uses HCanvas's anchored distance sum, including collinear and additional fingers", () => {
    const points = new Map([
      [4, { x: 100, y: 100 }],
      [8, { x: 300, y: 100 }],
      [12, { x: 100, y: 300 }],
    ]);
    expect(getFactoryGesture(points)).toEqual({
      center: { x: 100, y: 200 },
      distance: 400,
    });
    points.set(8, { x: 500, y: 100 });
    expect(getFactoryGesture(points)).toEqual({
      center: { x: 100, y: 200 },
      distance: 600,
    });
    points.set(17, { x: 300, y: 300 });
    const four = getFactoryGesture(points)!;
    expect(four.center).toEqual({ x: 200, y: 200 });
    expect(four.distance).toBeCloseTo(600 + Math.hypot(200, 200));
    const collinear = new Map([
      [1, { x: 0, y: 0 }],
      [2, { x: 100, y: 0 }],
      [3, { x: 200, y: 0 }],
    ]);
    expect(getFactoryGesture(collinear)?.distance).toBe(300);
    expect(getFactoryGesture(new Map())).toBeNull();
  });
});
