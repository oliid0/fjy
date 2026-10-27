import { pointFrom } from "@excalidraw/math";

import { getSizeFromPoints } from "../src/points";

it("measures a long stroke without exceeding the JavaScript argument limit", () => {
  const points = Array.from({ length: 200000 }, (_, index) =>
    pointFrom(index - 50000, -index / 2),
  );
  expect(getSizeFromPoints(points)).toEqual({ width: 199999, height: 99999.5 });
});

it("keeps negative coordinates, point strokes and non-finite bounds consistent", () => {
  expect(getSizeFromPoints([pointFrom(-20, -10), pointFrom(-30, -40)])).toEqual(
    { width: 10, height: 30 },
  );
  expect(getSizeFromPoints([pointFrom(12, 34)])).toEqual({
    width: 0,
    height: 0,
  });
  expect(getSizeFromPoints([pointFrom(NaN, 1)])).toEqual({
    width: NaN,
    height: 0,
  });
});
