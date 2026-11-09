import { preprocessStrokes } from "ink-on/core";

import { recognizeLocalMath } from "./localMathOcr";
import { offlineInference } from "./offlineInference";
vi.mock("./offlineInference", () => ({ offlineInference: vi.fn() }));
vi.mock("ink-on/core", () => ({
  preprocessStrokes: vi.fn(() => ({
    tensor: new Float32Array(4),
    mask: new Uint8Array(1),
    width: 2,
    height: 2,
    maskWidth: 1,
    maskHeight: 1,
  })),
}));
afterEach(() => vi.clearAllMocks());
it("normalizes actual model tokens and bounds distant scene coordinates before rasterization", async () => {
  vi.mocked(offlineInference).mockResolvedValue({
    latex: String.raw`y = \frac { 1 2 } { x ^ { 2 } }`,
  });
  const value = await recognizeLocalMath(
    [
      [
        [1e6, -1e6],
        [1e7, 1e7],
      ],
    ],
    new AbortController().signal,
  );
  expect(value).toBe(String.raw`y = \frac{12}{x^{2}}`);
  const strokes = vi.mocked(preprocessStrokes).mock.calls[0][0];
  expect(
    strokes
      .flatMap((stroke) => stroke.points)
      .every(
        (point) =>
          point.x >= 8 && point.x <= 488 && point.y >= 8 && point.y <= 488,
      ),
  ).toBe(true);
});
it("rejects invalid or oversized ink before loading/running a model", async () => {
  await expect(
    recognizeLocalMath([[[NaN, 0]]], new AbortController().signal),
  ).rejects.toThrow();
  await expect(
    recognizeLocalMath(
      [Array.from({ length: 12001 }, () => [0, 0] as [number, number])],
      new AbortController().signal,
    ),
  ).rejects.toThrow();
  expect(offlineInference).not.toHaveBeenCalled();
});
