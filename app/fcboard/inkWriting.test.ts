import { validateInkInput } from "./inkWriting";

it("rejects invalid captured trajectories and preserves valid coordinate order", () => {
  for (const input of [
    [],
    [[]],
    [[[0, NaN]]],
    [[[0, 1, 2]]],
    [[[0, Infinity]]],
    "ink",
  ]) {
    expect(() => validateInkInput(input)).toThrow();
  }
  const points = [
    [
      [1, 2],
      [3, 4],
    ],
  ] as [number, number][][];
  expect(validateInkInput(points)).toBe(points);
});
