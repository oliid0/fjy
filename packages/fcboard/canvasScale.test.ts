import { canvasScale } from "./canvasScale";

it("preserves full 4K display detail while bounding every Android layer", () => {
  const scale = canvasScale(3840, 2160, 3, true);
  expect(3840 * 2160 * scale * scale).toBeLessThanOrEqual(8_388_609);
  expect(scale).toBeGreaterThanOrEqual(1);
  expect(canvasScale(3840, 2160, 1, true)).toBe(1);
  expect(canvasScale(1280, 720, 3, true)).toBe(3);
  expect(canvasScale(1138, 616, 2.25, true)).toBe(2.25);
  const huge = canvasScale(7680, 4320, 3, true);
  expect(7680 * 4320 * huge * huge).toBeLessThanOrEqual(8_388_609);
  expect(canvasScale(1280, 720, 1, true)).toBe(1);
});
it("preserves desktop detail within budget and rejects invalid dimensions/ratios", () => {
  expect(canvasScale(1280, 720, 2, false)).toBe(2);
  expect(canvasScale(Infinity, 720, 2, true)).toBe(1);
  expect(canvasScale(1280, 720, NaN, true)).toBe(1);
  expect(canvasScale(0, 0, 1, true)).toBe(1);
});
