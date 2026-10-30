import { createContext, useContext, useState } from "react";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import { t } from "@fcboard/fcboard/i18n";

import type { TranslationKeys } from "@fcboard/fcboard/i18n";

import { AppVersion } from "./AppVersion";
import arrowIcon from "./factory-setting-icons/arrow.svg?url";

import type { ReactNode } from "react";

const sections = {
  home: "settings",
  background: "background",
  language: "language",
  pen: "pen",
  touch: "factorySettings.threshold",
  ai: "ai_and_speech_settings",
  models: "models_and_connection",
  recognition: "handwriting_and_insertion",
  voice: "speech_and_narration",
  teaching: "teaching_preferences",
} as const;
export type SettingsPage = keyof typeof sections;
const current = createContext<SettingsPage>("home");
export const useSettingsPage = () => useContext(current);
const aiPages: SettingsPage[] = ["models", "recognition", "voice", "teaching"];
export const settingsParent = (page: SettingsPage): SettingsPage =>
  aiPages.includes(page) ? "ai" : "home";
export const settingsPageTitle = (page: SettingsPage): TranslationKeys =>
  page === "background"
    ? "fcboard.factorySettings.background_title"
    : `fcboard.${sections[page]}`;

export const SettingsNavigation = ({
  children,
  initialPage = "home",
  page,
  onPageChange,
  showHeader = true,
}: {
  children: ReactNode;
  initialPage?: SettingsPage;
  page?: SettingsPage;
  onPageChange?: (page: SettingsPage) => void;
  showHeader?: boolean;
}) => {
  const [local, setLocal] = useState<SettingsPage>(initialPage);
  const section = page ?? local;
  const setSection = (next: SettingsPage) => {
    setLocal(next);
    onPageChange?.(next);
  };
  const inAI = aiPages.includes(section);
  const back = () => setSection(inAI ? "ai" : "home");
  const rows =
    section === "home"
      ? ["touch", "background", "language", "ai"]
      : section === "ai"
      ? aiPages
      : [];
  return (
    <current.Provider value={section}>
      <div className="fc-settings-layout" data-settings-page={section}>
        {showHeader && section !== "home" && (
          <div className="fc-settings-subheader">
            <button type="button" onClick={back} aria-label={t("fcboard.back")}>
              ‹ {t(`fcboard.${sections[inAI ? "ai" : "home"]}`)}
            </button>
            <h3>{t(`fcboard.${sections[section]}`)}</h3>
          </div>
        )}
        <section
          className="fc-settings-content"
          aria-label={t(`fcboard.${sections[section]}`)}
        >
          <div className="fc-settings-fields">{children}</div>
          {!!rows.length && (
            <List
              component="nav"
              className="fc-settings-navigation"
              aria-label={t("fcboard.settings_navigation")}
            >
              {rows.map((id) => (
                <ListItemButton
                  key={id}
                  onClick={() => setSection(id as SettingsPage)}
                >
                  <ListItemText
                    primary={t(`fcboard.${sections[id as SettingsPage]}`)}
                  />
                  <img src={arrowIcon} alt="" width="20" height="20" />
                </ListItemButton>
              ))}
            </List>
          )}
          {section === "home" && <AppVersion />}
        </section>
      </div>
    </current.Provider>
  );
};
export const SettingsSection = ({
  id,
  children,
}: {
  id: SettingsPage;
  children: ReactNode;
}) => (useContext(current) === id ? <>{children}</> : null);
