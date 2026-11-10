import { newFreeDrawElement } from "@fcboard/element";
import { pointFrom } from "@fcboard/math";

import { boardInk, clipInk } from "./digitalInk";
const native = vi.hoisted(() => ({ recognize: vi.fn(), cancel: vi.fn() }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => native,
}));

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

it("cancels a native handwriting request immediately and ignores its late result", async () => {
  const { recognizeNativeInk } = await import("./digitalInk");
  let finish!: (value: { candidates: string[]; engine: string }) => void;
  const recognize = native.recognize.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const cancel = native.cancel.mockResolvedValue(undefined);
  const controller = new AbortController();
  try {
    const task = recognizeNativeInk(
      {
        strokes: [
          [
            [0, 0],
            [10, 10],
          ],
        ],
        language: "es-ES",
      },
      controller.signal,
    );
    const failure = expect(task).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await failure;
    expect(recognize.mock.calls[0][0]).toMatchObject({
      language: "es-ES",
      reuse: true,
    });
    expect(cancel).toHaveBeenCalledWith({ id: recognize.mock.calls[0][0].id });
    finish({ candidates: ["late"], engine: "mlkit" });
    await Promise.resolve();
  } finally {
    vi.restoreAllMocks();
  }
});
