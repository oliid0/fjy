import { getPreferredLanguage, languageDetector } from "./language-detector";

afterEach(() => vi.restoreAllMocks());

it.each([
  ["en-US", "en"],
  ["zh-Hans-CN", "zh-CN"],
  ["zh-Hant-HK", "zh-TW"],
  ["de_AT", "de-DE"],
])("resolves the system locale %s to %s", (detected, expected) => {
  vi.spyOn(languageDetector, "detect").mockReturnValue(detected);
  expect(getPreferredLanguage()).toBe(expected);
});

it("tries subsequent system languages when the first one is unsupported", () => {
  vi.spyOn(languageDetector, "detect").mockReturnValue(["xx-XX", "fr-CA"]);
  expect(getPreferredLanguage()).toBe("fr-FR");
});
