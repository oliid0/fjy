import { t, useI18n } from "@fcboard/fcboard/i18n";
import { Capacitor } from "@capacitor/core";
import { FactoryIcon } from "@fcboard/fcboard/components/FactoryIcon";
import { MainMenu } from "@fcboard/fcboard";
import React from "react";

import type { Theme } from "@fcboard/element/types";

import { classroomCommands } from "../fcboard/commands";

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
      <MainMenu.Item
        icon={<FactoryIcon name="document" />}
        onSelect={() => invoke("board.chooseOpen")}
        data-testid="load-button"
      >
        {t("buttons.load")}
      </MainMenu.Item>
      <MainMenu.Item
        icon={<FactoryIcon name="save" />}
        onSelect={() => invoke("board.saveFile")}
        data-testid="save-button"
      >
        {t("buttons.save")}
      </MainMenu.Item>
      <MainMenu.Item
        icon={<FactoryIcon name="qr" />}
        onSelect={() => invoke("board.share")}
      >
        {t("fcboard.qr_share")}
      </MainMenu.Item>
      <MainMenu.Item
        icon={<FactoryIcon name="mail" />}
        onSelect={() => invoke("board.mail")}
      >
        {t("fcboard.mail_sent")}
      </MainMenu.Item>
      <MainMenu.Item
        icon={<FactoryIcon name="qr" />}
        onSelect={() => invoke("network.panel", { panel: "collab" })}
      >
        {t("fcboard.live_collaboration")}
      </MainMenu.Item>
      <MainMenu.Item
        icon={<FactoryIcon name="settings" />}
        onSelect={() => invoke("board.settings")}
      >
        {t("fcboard.settings")}
      </MainMenu.Item>
      <MainMenu.Item
        icon={<FactoryIcon name="exit" />}
        disabled={!Capacitor.isNativePlatform()}
        title={
          Capacitor.isNativePlatform()
            ? t("fcboard.save_and_exit_board")
            : t("fcboard.close_this_browser_tab_to_exit")
        }
        onSelect={() => invoke("app.exit")}
      >
        {t("fcboard.exit_app")}
      </MainMenu.Item>
    </MainMenu>
  );
});
