import { t, useI18n } from "@excalidraw/excalidraw/i18n";
import { Capacitor } from "@capacitor/core";
import { FactoryIcon } from "@excalidraw/excalidraw/components/FactoryIcon";
import { eyeIcon } from "@excalidraw/excalidraw/components/icons";
import { MainMenu } from "@excalidraw/excalidraw/index";
import React from "react";

import { isDevEnv } from "@excalidraw/common";

import type { Theme } from "@excalidraw/element/types";

import { LanguageList } from "../app-language/LanguageList";
import { classroomCommands } from "../fcdraw/commands";

import { saveDebugState } from "./DebugCanvas";

export const AppMainMenu: React.FC<{
  onCollabDialogOpen: () => any;
  isCollaborating: boolean;
  isCollabEnabled: boolean;
  theme: Theme | "system";
  setTheme: (theme: Theme | "system") => void;
  refresh: () => void;
}> = React.memo((props) => {
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
      <MainMenu.Sub>
        <MainMenu.Sub.Trigger icon={<FactoryIcon name="settings" />}>
          {t("fcboard.设置")}
        </MainMenu.Sub.Trigger>
        <MainMenu.Sub.Content className="fc-factory-settings">
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.SaveAsImage />
          {props.isCollabEnabled && (
            <MainMenu.DefaultItems.LiveCollaborationTrigger
              isCollaborating={props.isCollaborating}
              onSelect={() => props.onCollabDialogOpen()}
            />
          )}
          <MainMenu.DefaultItems.CommandPalette className="highlighted" />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          {[
            [t("fcboard.AI 与语音设置"), "panel.open", { panel: "settings" }],
            [t("fcboard.实时协作"), "network.panel", { panel: "collab" }],
            [t("fcboard.设备控制"), "network.panel", { panel: "remote" }],
          ].map(([label, command, args]) => (
            <MainMenu.Item
              key={String(command) + String(label)}
              onSelect={() => {
                void classroomCommands.execute({
                  name: "ui.invoke",
                  args: { command, args },
                });
              }}
            >
              {String(label)}
            </MainMenu.Item>
          ))}
          <MainMenu.Separator />
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
                props?.refresh();
              }}
            >
              Visual Debug
            </MainMenu.Item>
          )}
          <MainMenu.Separator />
          <MainMenu.DefaultItems.Preferences />
          <MainMenu.DefaultItems.ToggleTheme
            allowSystemTheme
            theme={props.theme}
            onSelect={props.setTheme}
          />
          <MainMenu.ItemCustom>
            <LanguageList style={{ width: "100%" }} />
          </MainMenu.ItemCustom>
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu.Sub.Content>
      </MainMenu.Sub>
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
