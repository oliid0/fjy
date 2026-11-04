import { circledLanguage } from "./languageCircle";

const circle = [
  Array.from({ length: 65 }, (_, i): [number, number] => [
    100 + 60 * Math.cos((i * Math.PI) / 32),
    60 + 35 * Math.sin((i * Math.PI) / 32),
  ]),
];
it("captures the region inside a language-pen circle even when the word belongs to a longer text object", () => {
  expect(
    circledLanguage(circle, [
      { id: "sentence", bounds: { left: 0, top: 40, right: 400, bottom: 75 } },
      {
        id: "elsewhere",
        bounds: { left: 300, top: 180, right: 420, bottom: 220 },
      },
    ]),
  ).toEqual({
    sourceIds: ["sentence"],
    region: { left: 40, top: 25, right: 160, bottom: 95 },
  });
});
it("does not interpret ordinary writing or an empty circle as a study selection", () => {
  expect(
    circledLanguage(
      [
        [
          [0, 0],
          [100, 20],
          [30, 80],
        ],
      ],
      [{ id: "x", bounds: { left: 0, top: 0, right: 100, bottom: 100 } }],
    ),
  ).toBeUndefined();
  expect(circledLanguage(circle, [])).toBeUndefined();
});
