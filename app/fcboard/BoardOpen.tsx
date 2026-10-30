import { useEffect, useState } from "react";
import { t } from "@fcboard/fcboard/i18n";

import { classroomCommands, executeBoardCommand } from "./commands";
import { ShareServerChooser } from "./ShareServerChooser";
import { BzdCodeDialog } from "./BzdCodeDialog";

export const BoardOpen = () => {
  const [view, setView] = useState<"choose" | "code">();
  const [endpoint, setEndpoint] = useState("");
  useEffect(
    () =>
      classroomCommands.register(
        "board.chooseOpen",
        "打开原版 BZD 云端 / 本地选择器；云端凭四位提取码导入实际文件，本地打开设备文件窗。",
        () => setView("choose"),
      ),
    [],
  );
  if (view === "choose") {
    return (
      <ShareServerChooser
        title={t("buttons.load")}
        requireKey={false}
        onClose={() => setView(undefined)}
        onLocal={async (signal) => {
          await executeBoardCommand({ name: "board.open" }, signal);
          if (!signal.aborted) {
            setView(undefined);
          }
        }}
        onCloud={async (config) => {
          setEndpoint(config.endpoint);
          setView("code");
        }}
      />
    );
  }
  return view === "code" ? (
    <BzdCodeDialog
      onClose={() => setView(undefined)}
      onRead={async (code, signal) => {
        await executeBoardCommand(
          { name: "board.open", args: { code, endpoint } },
          signal,
        );
      }}
    />
  ) : null;
};
