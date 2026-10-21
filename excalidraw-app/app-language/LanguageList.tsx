import { useI18n, languages } from "@excalidraw/excalidraw/i18n";
import React from "react";

import { useSetAtom, useAtomValue } from "../app-jotai";

import { appLangCodeAtom, appLangPreferenceAtom } from "./language-state";

export const LanguageList = ({ style }: { style?: React.CSSProperties }) => {
  const { t } = useI18n();
  const preference = useAtomValue(appLangPreferenceAtom);
  const setLangCode = useSetAtom(appLangCodeAtom);

  return (
    <select
      className="dropdown-select dropdown-select__language"
      onChange={({ target }) => setLangCode(target.value)}
      value={preference}
      aria-label={t("buttons.selectLanguage")}
      style={style}
    >
      <option value="system">{t("fcboard.跟随系统语言")}</option>
      {languages.map((lang) => (
        <option key={lang.code} value={lang.code}>
          {lang.label}
        </option>
      ))}
    </select>
  );
};
