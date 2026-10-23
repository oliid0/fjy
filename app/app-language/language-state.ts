import { useEffect } from "react";

import { atom, useAtom, useSetAtom, useAtomValue } from "../app-jotai";

import { getPreferredLanguage, languageDetector } from "./language-detector";

export const getLanguagePreference = () =>
  localStorage.getItem("fcboard-language") ||
  (localStorage.getItem("i18nextLng") ? getPreferredLanguage() : "system");
export const appLangPreferenceAtom = atom(getLanguagePreference());
const systemLangCodeAtom = atom(getPreferredLanguage(true));
export const appLangCodeAtom = atom(
  (get) =>
    get(appLangPreferenceAtom) === "system"
      ? get(systemLangCodeAtom)
      : get(appLangPreferenceAtom),
  (_get, set, code: string) => {
    localStorage.setItem("fcboard-language", code);
    set(appLangPreferenceAtom, code);
    if (code === "system") {
      set(systemLangCodeAtom, getPreferredLanguage(true));
    } else {
      languageDetector.cacheUserLanguage(code);
    }
  },
);

export const useAppLangCode = () => {
  const [langCode, setLangCode] = useAtom(appLangCodeAtom);
  const preference = useAtomValue(appLangPreferenceAtom);
  const setSystemLanguage = useSetAtom(systemLangCodeAtom);

  useEffect(() => {
    if (preference !== "system") {
      return;
    }
    const update = () => setSystemLanguage(getPreferredLanguage(true));
    update();
    window.addEventListener("languagechange", update);
    return () => window.removeEventListener("languagechange", update);
  }, [preference, setSystemLanguage]);

  return [langCode, setLangCode] as const;
};
