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
  return (
    <MainMenu>
      <MainMenu.DefaultItems.LoadScene />
      <MainMenu.DefaultItems.SaveToActiveFile />
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
        ["新建白板", "board.new"],
        ["切换白板", "board.list"],
        ["扫码分享", "board.share"],
        ["提问与讲解", "assistant.open"],
        ["教学工具", "tools.open"],
        ["课堂录制", "record.open"],
        ["课件 / 局域网快传", "files.open"],
        ["截屏", "canvas.capture"],
        ["总结白板", "canvas.summary"],
        ["语音指令", "voice.toggle"],
        ["AI 与语音设置", "panel.open", { panel: "settings" }],
        ["实时协作", "network.panel", { panel: "collab" }],
        ["设备控制", "network.panel", { panel: "remote" }],
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
        方成教育官网
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
    </MainMenu>
  );
});
