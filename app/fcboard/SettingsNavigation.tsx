import { createContext, useContext, useState } from "react";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import { t } from "@excalidraw/excalidraw/i18n";

import type { ReactNode } from "react";

const sections = {
  background: "background",
  language: "language",
  pen: "pen",
  touch: "touch_and_eraser_settings",
  models: "models_and_connection",
  recognition: "handwriting_and_insertion",
  voice: "speech_and_narration",
  teaching: "teaching_preferences",
  tools: "toolbox",
} as const;
export type SettingsPage = keyof typeof sections;
const current = createContext<SettingsPage>("background");

export const SettingsNavigation = ({
  children,
  initialPage = "background",
  hasTools = false,
}: {
  children: ReactNode;
  initialPage?: SettingsPage;
  hasTools?: boolean;
}) => {
  const [section, setSection] = useState(initialPage);
  return (
    <current.Provider value={section}>
      <div className="fc-settings-layout">
        <List
          component="nav"
          className="fc-settings-navigation"
          aria-label={t("fcboard.settings_navigation")}
        >
          {(Object.keys(sections) as SettingsPage[])
            .filter((id) => id !== "tools" || hasTools)
            .map((id) => (
              <ListItemButton
                key={id}
                selected={id === section}
                aria-current={id === section ? "page" : undefined}
                onClick={() => setSection(id)}
              >
                <ListItemText primary={t(`fcboard.${sections[id]}`)} />
              </ListItemButton>
            ))}
        </List>
        <section
          className="fc-settings-content"
          aria-label={t(`fcboard.${sections[section]}`)}
        >
          <h3>{t(`fcboard.${sections[section]}`)}</h3>
          <div className="fc-settings-fields">{children}</div>
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
