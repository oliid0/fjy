import { languageInkSignature, parseLanguageStudy } from "./languageStudy";
import { languageStudy } from "./test/language";

it("requires a bounded complete translation and learning data before writing", () => {
  expect(parseLanguageStudy(JSON.stringify(languageStudy))).toEqual(
    languageStudy,
  );
  for (const value of [
    null,
    { term: "hello" },
    { ...languageStudy, translation: "" },
    { ...languageStudy, grammar: "" },
    { ...languageStudy, usage: "" },
    { ...languageStudy, term: "a".repeat(1801) },
    { ...languageStudy, meanings: [] },
  ]) {
    expect(() => parseLanguageStudy(JSON.stringify(value))).toThrow();
  }
});

it("keeps moved and scaled source ink valid but rejects erased or edited trajectories", () => {
  const strokes = [
    [
      [10, 20],
      [20, 40],
    ],
    [
      [30, 20],
      [40, 35],
    ],
  ];
  const signature = languageInkSignature(strokes);
  expect(
    languageInkSignature(
      strokes
        .map((stroke) => stroke.map(([x, y]) => [x * 2 + 100, y * 3 - 50]))
        .reverse(),
    ),
  ).toBe(signature);
  expect(languageInkSignature(strokes.slice(0, 1))).not.toBe(signature);
  expect(
    languageInkSignature([
      [
        [10, 20],
        [20, 38],
      ],
      strokes[1],
    ]),
  ).not.toBe(signature);
  expect(languageInkSignature([[[NaN, 0]]])).toBe("");
  expect(
    languageInkSignature([
      Array.from({ length: 150000 }, (_, i) => [i, i % 50]),
    ]),
  ).not.toBe("");
});
