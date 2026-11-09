import { canvasScale } from "./canvasScale";

it("bounds each Android display layer even on a 4K board with a high DPR", () => {
  const scale = canvasScale(3840, 2160, 3, true);
  expect(3840 * 2160 * scale * scale).toBeLessThanOrEqual(2_097_153);
  expect(scale).toBeLessThan(1);
  expect(canvasScale(1280, 720, 1, true)).toBe(1);
});
it("preserves desktop detail within budget and rejects invalid dimensions/ratios", () => {
  expect(canvasScale(1280, 720, 2, false)).toBe(2);
  expect(canvasScale(Infinity, 720, 2, true)).toBe(1);
  expect(canvasScale(1280, 720, NaN, true)).toBe(1);
  expect(canvasScale(0, 0, 1, true)).toBe(1);
});
