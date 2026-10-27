import { circleRegion, regionHandleAt, resizeRegion } from "./region";

it.each([0.5, 1, 2])(
  "maps a screen gesture at zoom %s without changing its visible margin",
  (scale) => {
    const viewport = { left: -100, top: 50, right: 900, bottom: 550 };
    const result = circleRegion(
      [
        [100, 100],
        [100 + 80 / scale, 100 + 40 / scale],
      ],
      viewport,
      scale,
    )!;
    expect((100 - result.left) * scale).toBe(12);
    expect((result.right - 100) * scale).toBe(92);
    expect(
      circleRegion(
        [
          [0, 60],
          [-200, 0],
        ],
        viewport,
        scale,
      )?.left,
    ).toBe(-100);
    expect(
      circleRegion(
        [
          [0, 60],
          [-200, 0],
        ],
        viewport,
        scale,
      )?.top,
    ).toBe(50);
    expect(
      circleRegion(
        [
          [100, 100],
          [100 + 2 / scale, 100],
        ],
        viewport,
        scale,
      ),
    ).toBeUndefined();
  },
);

it("resizes from corners, moves the selected contents from the frame interior or border and starts a new gesture outside", () => {
  const bounds = { left: 100, top: 100, right: 300, bottom: 200 };
  expect(regionHandleAt(bounds, { x: 100, y: 100 }, 10)).toBe("nw");
  expect(regionHandleAt(bounds, { x: 200, y: 103 }, 10)).toBe("move");
  expect(regionHandleAt(bounds, { x: 200, y: 150 }, 10)).toBe("move");
  expect(regionHandleAt(bounds, { x: 340, y: 150 }, 10)).toBeNull();
  const viewport = { left: 0, top: 0, right: 500, bottom: 400 };
  expect(resizeRegion(bounds, "se", { x: 900, y: 900 }, viewport, 1)).toEqual({
    ...bounds,
    right: 500,
    bottom: 400,
  });
  expect(resizeRegion(bounds, "nw", { x: 400, y: 300 }, viewport, 1)).toEqual(
    bounds,
  );
});
