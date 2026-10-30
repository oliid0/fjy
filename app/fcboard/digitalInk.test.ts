import { newFreeDrawElement } from "@fcboard/element";
import { pointFrom } from "@fcboard/math";

import { boardInk, clipInk } from "./digitalInk";

it("preserves raw stroke order and applies moved/rotated object coordinates", () => {
  const ink = newFreeDrawElement({
    type: "freedraw",
    x: 100,
    y: 50,
    points: [pointFrom(0, 0), pointFrom(40, 20)],
    simulatePressure: true,
  });
  const strokes = boardInk([{ ...ink, angle: Math.PI as typeof ink.angle }]);
  expect(strokes[0][0][0]).toBeCloseTo(140);
  expect(strokes[0][0][1]).toBeCloseTo(70);
  expect(strokes[0][1][0]).toBeCloseTo(100);
  expect(strokes[0][1][1]).toBeCloseTo(50);
});

it("clips sparse crossings and separates exits without reading neighbouring handwriting", () => {
  const region = { left: 10, top: 10, right: 30, bottom: 30 };
  expect(
    clipInk(
      [
        [
          [0, 20],
          [40, 20],
          [40, 25],
          [0, 25],
        ],
      ],
      region,
    ),
  ).toEqual([
    [
      [10, 20],
      [30, 20],
    ],
    [
      [30, 25],
      [10, 25],
    ],
  ]);
  expect(clipInk([[[5, 5]], [[20, 20]]], region)).toEqual([[[20, 20]]]);
});
