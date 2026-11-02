import { answerFontSize } from "./textLayout";

it("caps AI writing in screen pixels on a zoomed or small viewport", () => {
  const viewport = { left: 0, top: 0, right: 600, bottom: 360 };
  expect(answerFontSize(200, 1, viewport)).toBe(20);
  expect(answerFontSize(200, 2, viewport)).toBe(12);
  expect(answerFontSize(32, 1, viewport)).toBe(16);
  for (const mode of ["inline", "column", "replace"] as const) {
    expect(answerFontSize(32, 1, viewport, mode)).toBe(32);
  }
});
