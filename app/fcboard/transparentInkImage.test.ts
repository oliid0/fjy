import { transparentInkPixels } from "./transparentInkImage";

const pixels = (size: number, color: number[]) =>
  new Uint8ClampedArray(
    Array.from({ length: size * size }, () => color).flat(),
  );
const set = (
  data: Uint8ClampedArray,
  size: number,
  x: number,
  y: number,
  color: number[],
) => data.set(color, (y * size + x) * 4);
it("removes edge-connected paper without punching out the enclosed white of a drawing", () => {
  const data = pixels(5, [255, 255, 255, 255]);
  for (let y = 1; y <= 3; y++) {
    for (let x = 1; x <= 3; x++) {
      if (x !== 2 || y !== 2) {
        set(data, 5, x, y, [0, 0, 0, 255]);
      }
    }
  }
  expect(transparentInkPixels(data, 5, 5)).toEqual({
    left: 1,
    top: 1,
    right: 4,
    bottom: 4,
  });
  expect(data[3]).toBe(0);
  expect(Array.from(data.slice((2 * 5 + 2) * 4, (2 * 5 + 2) * 4 + 4))).toEqual([
    255, 255, 255, 255,
  ]);
});
it("preserves an existing colored alpha subject", () => {
  const data = pixels(3, [0, 0, 0, 0]);
  set(data, 3, 1, 1, [50, 120, 240, 180]);
  expect(transparentInkPixels(data, 3, 3)).toEqual({
    left: 1,
    top: 1,
    right: 2,
    bottom: 2,
  });
  expect(Array.from(data.slice(16, 20))).toEqual([50, 120, 240, 180]);
});
it("rejects an opaque colored scene or empty output instead of disguising it as a transparent drawing", () => {
  expect(() =>
    transparentInkPixels(pixels(3, [20, 50, 100, 255]), 3, 3),
  ).toThrow("opaque background");
  expect(() =>
    transparentInkPixels(pixels(3, [255, 255, 255, 255]), 3, 3),
  ).toThrow("no visible subject");
});
