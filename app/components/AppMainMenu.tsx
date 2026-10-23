import { t, useI18n } from "@excalidraw/excalidraw/i18n";
import { Capacitor } from "@capacitor/core";
import { FactoryIcon } from "@excalidraw/excalidraw/components/FactoryIcon";
import { eyeIcon } from "@excalidraw/excalidraw/components/icons";
import { MainMenu } from "@excalidraw/excalidraw/index";
import React from "react";

import { isDevEnv } from "@excalidraw/common";

import type { Theme } from "@excalidraw/element/types";

import { LanguageList } from "../app-language/LanguageList";
import { classroomCommands } from "../fcboard/commands";

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
          <MainMenu.Item onSelect={() => invoke("board.settings")}>
            {t("fcboard.白板设置")}
          </MainMenu.Item>
          <MainMenu.Item
            onSelect={() => invoke("panel.open", { panel: "settings" })}
          >
            {t("fcboard.AI 与语音设置")}
          </MainMenu.Item>
          <MainMenu.Sub>
            <MainMenu.Sub.Trigger>{t("fcboard.实时协作")}</MainMenu.Sub.Trigger>
            <MainMenu.Sub.Content>
              {props.isCollabEnabled && (
                <MainMenu.DefaultItems.LiveCollaborationTrigger
                  isCollaborating={props.isCollaborating}
                  onSelect={() => props.onCollabDialogOpen()}
                />
              )}
              <MainMenu.Item
                onSelect={() => invoke("network.panel", { panel: "collab" })}
              >
                {t("fcboard.实时协作")}
              </MainMenu.Item>
            </MainMenu.Sub.Content>
          </MainMenu.Sub>
          <MainMenu.Sub>
            <MainMenu.Sub.Trigger>{t("buttons.export")}</MainMenu.Sub.Trigger>
            <MainMenu.Sub.Content>
              <MainMenu.DefaultItems.Export />
              <MainMenu.DefaultItems.SaveAsImage />
            </MainMenu.Sub.Content>
          </MainMenu.Sub>
          <MainMenu.Sub>
            <MainMenu.Sub.Trigger>{t("helpDialog.tools")}</MainMenu.Sub.Trigger>
            <MainMenu.Sub.Content>
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
            </MainMenu.Sub.Content>
          </MainMenu.Sub>
          <MainMenu.ItemCustom>
            <LanguageList style={{ width: "100%" }} />
          </MainMenu.ItemCustom>
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
