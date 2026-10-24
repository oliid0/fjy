import { t, useI18n } from "@excalidraw/excalidraw/i18n";
import { Capacitor } from "@capacitor/core";
import { FactoryIcon } from "@excalidraw/excalidraw/components/FactoryIcon";
import { eyeIcon } from "@excalidraw/excalidraw/components/icons";
import { DropdownMenuContentPropsContext } from "@excalidraw/excalidraw/components/dropdownMenu/common";
import { MainMenu } from "@excalidraw/excalidraw/index";
import React from "react";
import MenuList from "@mui/material/MenuList";

import { isDevEnv } from "@excalidraw/common";

import type { Theme } from "@excalidraw/element/types";

import { LanguageList } from "../app-language/LanguageList";
import { classroomCommands } from "../fcboard/commands";

import { saveDebugState } from "./DebugCanvas";

type AppMenuProps = {
  onCollabDialogOpen: () => any;
  isCollaborating: boolean;
  isCollabEnabled: boolean;
  theme: Theme | "system";
  setTheme: (theme: Theme | "system") => void;
  refresh: () => void;
};

export const AppMainMenu: React.FC<AppMenuProps> = React.memo(() => {
  useI18n();
  const invoke = (command: string, args?: Record<string, unknown>) => {
    void classroomCommands.execute({
      name: "ui.invoke",
      args: { command, args },
    });
  };
  return (
    <MainMenu>
      <MainMenu.DefaultItems.LoadScene />
      <MainMenu.DefaultItems.SaveToActiveFile />
      <MainMenu.Item
        icon={<FactoryIcon name="qr" />}
        onSelect={() => invoke("board.share")}
      >
        {t("fcboard.扫码分享")}
      </MainMenu.Item>
      <MainMenu.Item
        icon={<FactoryIcon name="mail" />}
        onSelect={() => invoke("board.mail")}
      >
        {t("fcboard.邮件发送")}
      </MainMenu.Item>
      <MainMenu.Item
        icon={<FactoryIcon name="settings" />}
        onSelect={() => invoke("board.settings")}
      >
        {t("fcboard.设置")}
      </MainMenu.Item>
      <MainMenu.Item
        icon={<FactoryIcon name="exit" />}
        disabled={!Capacitor.isNativePlatform()}
        title={
          Capacitor.isNativePlatform()
            ? t("fcboard.保存并退出白板")
            : t("fcboard.网页可关闭当前标签页")
        }
        onSelect={() => invoke("app.exit")}
      >
        {t("fcboard.退出应用")}
      </MainMenu.Item>
    </MainMenu>
  );
});

/** Existing export/collaboration actions share the settings window's right-hand pane. */
export const AppSettingsActions = (
  props: AppMenuProps & { onClose: () => void },
) => {
  useI18n();
  return (
    <DropdownMenuContentPropsContext.Provider
      value={{ material: true, onSelect: props.onClose }}
    >
      <div className="fc-settings-tools">
        <MenuList>
          {props.isCollabEnabled && (
            <MainMenu.DefaultItems.LiveCollaborationTrigger
              isCollaborating={props.isCollaborating}
              onSelect={props.onCollabDialogOpen}
            />
          )}
          <MainMenu.Item
            onSelect={() =>
              void classroomCommands.execute({
                name: "network.panel",
                args: { panel: "collab" },
              })
            }
          >
            {t("fcboard.实时协作")}
          </MainMenu.Item>
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.CommandPalette />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.ItemLink href="http://www.fcjyboard.com/">
            {t("fcboard.方成教育官网")}
          </MainMenu.ItemLink>
          {isDevEnv() && (
            <MainMenu.Item
              icon={eyeIcon}
              onSelect={() => {
                if (window.visualDebug) {
                  delete window.visualDebug;
                  saveDebugState({ enabled: false });
                } else {
                  window.visualDebug = { data: [] };
                  saveDebugState({ enabled: true });
                }
                props.refresh();
              }}
            >
              Visual Debug
            </MainMenu.Item>
          )}
        </MenuList>
        <LanguageList style={{ width: "100%" }} />
      </div>
    </DropdownMenuContentPropsContext.Provider>
  );
};
