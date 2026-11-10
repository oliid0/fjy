import {
  calculationInk,
  hasStructuredMathInk,
  preservesMathInkStructure,
} from "./calculationInk";
import { inkRecognitionDelay, settleInkRecognition } from "./inkRecognition";

import type { InkInput } from "./digitalInk";

const equals: InkInput = [
  [
    [10, 20],
    [20, 60],
  ],
  [
    [40, 20],
    [50, 60],
  ],
  [
    [80, 35],
    [105, 35],
  ],
  [
    [80, 45],
    [105, 45],
  ],
];
const vertical: InkInput = [
  [
    [20, 10],
    [30, 40],
  ],
  [
    [20, 65],
    [30, 95],
  ],
  [
    [0, 105],
    [70, 105],
  ],
];
const fraction: InkInput = [
  [
    [20, 10],
    [35, 35],
  ],
  [
    [10, 45],
    [55, 45],
  ],
  [
    [20, 55],
    [35, 80],
  ],
];

afterEach(() => vi.useRealTimers());

it("starts and commits immediately after an explicit ending, without waiting 350/700ms", async () => {
  vi.useFakeTimers();
  for (const ink of [equals, vertical]) {
    expect(calculationInk(ink).complete).toBe(true);
    expect(inkRecognitionDelay("calculation", ink)).toBe(0);
    await settleInkRecognition(
      "calculation",
      Date.now(),
      new AbortController().signal,
      ink,
    );
    expect(vi.getTimerCount()).toBe(0);
  }
  expect(calculationInk(equals).strokes).toBe(equals);
  expect(calculationInk(vertical).strokes).toEqual(vertical.slice(0, 2));
});

it("retains fraction bars, single minus signs, and incomplete equals signs", () => {
  for (const ink of [fraction, equals.slice(0, -1), equals.slice(0, 2)]) {
    expect(calculationInk(ink)).toEqual({ complete: false, strokes: ink });
    expect(inkRecognitionDelay("calculation", ink)).toBe(350);
  }
});

it("requires mathematical structure in the transcription of fractions or scripts", () => {
  expect(hasStructuredMathInk(fraction)).toBe(true);
  expect(preservesMathInkStructure(fraction, "12+3")).toBe(false);
  expect(preservesMathInkStructure(fraction, String.raw`\frac{1}{2}`)).toBe(
    true,
  );
  const power: InkInput = [
    [
      [10, 30],
      [25, 70],
    ],
    [
      [30, 12],
      [40, 30],
    ],
  ];
  expect(hasStructuredMathInk(power)).toBe(true);
  expect(preservesMathInkStructure(power, "23")).toBe(false);
  expect(preservesMathInkStructure(power, "2^{3}")).toBe(true);
  expect(hasStructuredMathInk(equals)).toBe(false);
  expect(hasStructuredMathInk(vertical)).toBe(false);
});

it("still waits for a complete expression without an ending, with cancellation", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const wait = settleInkRecognition(
    "calculation",
    Date.now(),
    controller.signal,
    equals.slice(0, 2),
  );
  const failure = expect(wait).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await failure;
  expect(vi.getTimerCount()).toBe(0);
});
