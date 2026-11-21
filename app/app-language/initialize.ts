import { defaultLang, languages, setLanguage } from "@fcboard/fcboard/i18n";

import { appJotaiStore } from "../app-jotai";

import { appLangCodeAtom } from "./language-state";

// Start the selected catalog while the application dependencies initialize.
// Mount the editor once, with its actual locale already available.
export const initialLanguageReady = setLanguage(
  languages.find(
    (language) => language.code === appJotaiStore.get(appLangCodeAtom),
  ) || defaultLang,
);
