import { isDictionaryWord, parseLanguageStudy } from "./languageStudy";

it("keeps automatic word lookup separate from equations, questions and lesson titles", () => {
  expect(isDictionaryWord("bonjour")).toBe(true);
  expect(isDictionaryWord("Straße")).toBe(true);
  expect(isDictionaryWord("l'école")).toBe(true);
  for (const text of [
    "1+1=",
    "Newton's laws",
    "Why?",
    "牛顿定律",
    "私は学生です。",
    "",
  ]) {
    expect(isDictionaryWord(text)).toBe(false);
  }
});

it("rejects incomplete language output before it can become board content", () => {
  for (const value of [
    null,
    { term: "hello" },
    { language: "en", term: "hello", meanings: [], examples: [] },
  ]) {
    expect(() => parseLanguageStudy(JSON.stringify(value))).toThrow();
  }
});
