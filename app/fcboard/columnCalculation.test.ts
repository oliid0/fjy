import { columnCalculation } from "./columnCalculation";
import { latestFunctionInk } from "./functionInk";
import { localMathResult } from "./mathRecognition";

it.each([
  ["123\n+45\n----", "168"],
  ["123\n-45\n----", "78"],
  ["12\n×3\n----", "36"],
  ["144\n÷12\n----", "12"],
  ["12⟌144", "12"],
])("locally verifies vertical arithmetic %s", (input, answer) => {
  expect(localMathResult(input, "calculation")).toMatchObject({ answer });
});
it("places a calculation under its real bar even if OCR flattened its rows", () => {
  const input: [number, number][][] = [
    [
      [100, 100],
      [180, 140],
    ],
    [
      [110, 170],
      [180, 210],
    ],
    [
      [80, 225],
      [200, 225],
    ],
  ];
  expect(columnCalculation(input, "123+45")).toEqual({
    mode: "column",
    lines: 2,
  });
  expect(
    columnCalculation(
      [
        [
          [100, 100],
          [180, 140],
        ],
        [
          [190, 115],
          [230, 115],
        ],
      ],
      "123-45",
    ),
  ).toBeUndefined();
});
it("keeps a failed function on an earlier row separate from the next function and its superscript", () => {
  expect(
    [
      ...latestFunctionInk([
        [
          [100, 100],
          [400, 140],
        ],
        [
          [100, 240],
          [400, 280],
        ],
        [
          [300, 226],
          [310, 238],
        ],
      ]),
    ].sort(),
  ).toEqual([1, 2]);
});
