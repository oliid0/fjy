// ModelManager.APP_LANGUAGE_TAGS / resolveConfiguredTag / normalizeLanguageCode.
export const handwritingPackTags = [
  "zh-Hani-CN",
  "en-US",
  "ar",
  "bn-BD",
  "cs-CZ",
  "da-DK",
  "de-DE",
  "el-GR",
  "es-ES",
  "fa-IR",
  "fi-FI",
  "fr-FR",
  "gu-IN",
  "he-IL",
  "hi-IN",
  "hr-HR",
  "hu-HU",
  "id-ID",
  "it-IT",
  "ja-JP",
  "kk-KZ",
  "kn-IN",
  "ko-KR",
  "ky-KG",
  "mn-MN",
  "mr-IN",
  "ne-NP",
  "nl-NL",
  "pl-PL",
  "pt-PT",
  "ro-RO",
  "ru-RU",
  "sk-SK",
  "sv-SE",
  "ta-IN",
  "th-TH",
  "tr-TR",
  "uk-UA",
  "vi-VN",
] as const;
export type HandwritingPack = {
  tag: string;
  bundled: boolean;
  state: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
};
export type HandwritingPacks = { packs: HandwritingPack[]; revision: number };
export const packForLocale = (locale: string) => {
  let language = locale.split(/[-_]/)[0].toLowerCase();
  language = language === "iw" ? "he" : language === "in" ? "id" : language;
  return (
    handwritingPackTags.find((tag) => tag.split("-")[0] === language) || "en-US"
  );
};
export const languagePacksEvent = "fcboard-handwriting-language-packs";
export const openLanguagePacks = (tag?: string, required = false) =>
  window.dispatchEvent(
    new CustomEvent(languagePacksEvent, { detail: { tag, required } }),
  );
