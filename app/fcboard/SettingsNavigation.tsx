import { createContext, useContext, useState } from "react";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import { t } from "@excalidraw/excalidraw/i18n";

import type { ReactNode } from "react";

const sections = {
  models: "模型与连接",
  recognition: "手写与插入",
  voice: "语音与播报",
  teaching: "教学偏好",
} as const;
type Section = keyof typeof sections;
const current = createContext<Section | null>(null);

export const SettingsNavigation = ({ children }: { children: ReactNode }) => {
  const [section, setSection] = useState<Section | null>(null);
  return (
    <current.Provider value={section}>
      {section ? (
        <nav
          className="fc-settings-navigation"
          aria-label={t("fcboard.设置导航")}
        >
          <Button onClick={() => setSection(null)}>
            {t("fcboard.返回设置")}
          </Button>
          <strong>{t(`fcboard.${sections[section]}`)}</strong>
        </nav>
      ) : (
        <List aria-label={t("fcboard.设置导航")}>
          {(Object.keys(sections) as Section[]).map((id) => (
            <ListItemButton key={id} onClick={() => setSection(id)}>
              <ListItemText primary={t(`fcboard.${sections[id]}`)} />
              <span aria-hidden>›</span>
            </ListItemButton>
          ))}
        </List>
      )}
      {children}
    </current.Provider>
  );
};

export const SettingsSection = ({
  id,
  children,
}: {
  id: Section;
  children: ReactNode;
}) => (useContext(current) === id ? <>{children}</> : null);
