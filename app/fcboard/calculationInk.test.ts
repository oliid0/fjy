import {
  calculationInk,
  columnInkRows,
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

it("starts and commits immediately after an explicit ending, without an additional completion delay", async () => {
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
    expect(inkRecognitionDelay("calculation", ink)).toBe(1200);
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
  expect(hasStructuredMathInk(vertical)).toBe(true);
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

it("preserves the two dots of division instead of accepting a minus transcription", () => {
  const strokes: InkInput = [
    [
      [10, 10],
      [25, 50],
    ],
    [
      [45, 30],
      [65, 30],
    ],
    [[55, 22]],
    [[55, 38]],
    [
      [85, 10],
      [100, 50],
    ],
  ];
  expect(hasStructuredMathInk(strokes)).toBe(true);
  expect(preservesMathInkStructure(strokes, "12-3")).toBe(false);
  expect(preservesMathInkStructure(strokes, "12+3")).toBe(false);
  for (const value of [
    "12÷3",
    "12/3",
    String.raw`12\div3`,
    String.raw`\frac{12}{3}`,
  ]) {
    expect(preservesMathInkStructure(strokes, value)).toBe(true);
  }
  expect(
    hasStructuredMathInk(
      strokes.filter((_, index) => index !== 2 && index !== 3),
    ),
  ).toBe(false);
});

it("keeps unequal-height vertical operand rows out of superscript rejection", () => {
  const strokes: InkInput = [
    [
      [25, 10],
      [29, 20],
    ],
    [
      [25, 35],
      [30, 65],
    ],
    [
      [3, 50],
      [13, 50],
    ],
    [
      [8, 45],
      [8, 55],
    ],
    [
      [0, 75],
      [50, 75],
    ],
  ];
  const rows = columnInkRows(strokes);
  expect(rows).toEqual([[strokes[0]], [strokes[1], strokes[2], strokes[3]]]);
  expect(hasStructuredMathInk(strokes)).toBe(true);
  expect(preservesMathInkStructure(strokes, "1\n+3")).toBe(true);
});

it("recognizes a slanted final rule below a handwritten single-digit sum", () => {
  const strokes: InkInput = [
    [
      [28, 8],
      [31, 40],
    ],
    [
      [9, 60],
      [21, 60],
    ],
    [
      [15, 54],
      [15, 66],
    ],
    [
      [28, 46],
      [31, 77],
    ],
    [
      [3, 78],
      [47, 84],
    ],
  ];
  expect(columnInkRows(strokes)).toEqual([[strokes[0]], strokes.slice(1, 4)]);
  expect(calculationInk(strokes).strokes).toEqual(strokes.slice(0, 4));
  expect(preservesMathInkStructure(strokes, "1\n+1")).toBe(true);
});
