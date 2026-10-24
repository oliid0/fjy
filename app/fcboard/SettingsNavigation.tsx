import { createContext, useContext, useState } from "react";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import { t } from "@excalidraw/excalidraw/i18n";

import type { ReactNode } from "react";

const sections = {
  background: "背景",
  pen: "画笔",
  touch: "触控与橡皮设置",
  models: "模型与连接",
  recognition: "手写与插入",
  voice: "语音与播报",
  teaching: "教学偏好",
  tools: "工具箱",
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
          aria-label={t("fcboard.设置导航")}
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
