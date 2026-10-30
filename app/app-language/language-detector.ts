import { defaultLang, languages } from "@fcboard/fcboard";
import LanguageDetector from "i18next-browser-languagedetector";

export const languageDetector = new LanguageDetector();

languageDetector.init({
  languageUtils: {},
});

export const getPreferredLanguage = (system = false) => {
  const detectedLanguages = languageDetector.detect(
    system ? ["navigator"] : undefined,
  );

  for (const detected of Array.isArray(detectedLanguages)
    ? detectedLanguages
    : [detectedLanguages]) {
    if (!detected) {
      continue;
    }
    const code = detected.replace(/_/g, "-").toLowerCase();
    const exact = languages.find((lang) => lang.code.toLowerCase() === code);
    if (exact) {
      return exact.code;
    }
    if (code.startsWith("zh")) {
      return /(?:hant|tw|hk|mo)/.test(code) ? "zh-TW" : "zh-CN";
    }
    const base = languages.find(
      (lang) => lang.code.split("-")[0] === code.split("-")[0],
    );
    if (base) {
      return base.code;
    }
  }
  return defaultLang.code;
};
