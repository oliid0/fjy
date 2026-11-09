import { useEffect, useRef, useState } from "react";
import { ToolbarExtras } from "@fcboard/fcboard";
import { FactoryIcon } from "@fcboard/fcboard/components/FactoryIcon";
import { t } from "@fcboard/fcboard/i18n";

import { classroomCommands } from "./commands";
import { MaterialPanel } from "./MaterialPanel";
import { useAnchoredPanel } from "./floating";
import { TransientMessage } from "./TransientMessage";

/** menu_bar / popupwindow_multiscreen: choose 2/3/4, then enter real canvases. */
export const BottomBarActions = () => {
  const [split, setSplit] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const panel = useRef<HTMLElement>(null);
  const style = useAnchoredPanel(panel, "[data-split-launcher]", split);
  useEffect(() => {
    if (!split) {
      return;
    }
    const dismiss = (event: globalThis.PointerEvent) => {
      if (
        !panel.current?.contains(event.target as Node) &&
        !(event.target as Element).closest?.("[data-split-launcher]")
      ) {
        setSplit(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSplit(false);
      }
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", escape);
    };
  }, [split]);
  const invoke = async (command: string, args?: Record<string, unknown>) => {
    if (pending.current) {
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await classroomCommands.execute({
        name: "ui.invoke",
        args: { command, args },
      });
      setSplit(false);
    } catch (failure) {
      setError(String(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <ToolbarExtras placement="navigation">
        <div className="fc-toolbar-extras">
          <button
            type="button"
            data-split-launcher
            disabled={busy}
            aria-label={t("fcboard.split_screen")}
            aria-expanded={split}
            onClick={() => setSplit(!split)}
          >
            <FactoryIcon name="split" />
            <span>{t("fcboard.split_screen")}</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void invoke("network.panel", { panel: "collab" })}
          >
            <FactoryIcon name="collaboration" />
            <span>{t("fcboard.live_collaboration")}</span>
          </button>
        </div>
      </ToolbarExtras>
      <ToolbarExtras placement="actions">
        <div className="fc-toolbar-extras">
          {(
            [
              ["board.share", "qr", "share_board"],
              ["files.open", "transfer", "file_transfer"],
              ["board.saveFile", "save", "save"],
            ] as const
          ).map(([command, icon, label]) => (
            <button
              key={command}
              type="button"
              disabled={busy}
              onClick={() => void invoke(command)}
            >
              <FactoryIcon name={icon} />
              <span>{t(`fcboard.${label}`)}</span>
            </button>
          ))}
        </div>
      </ToolbarExtras>
      {split && (
        <MaterialPanel
          ref={panel}
          style={style}
          onDismiss={() => setSplit(false)}
          className="fc-split-launcher fc-surface"
          role="dialog"
          aria-label={t("fcboard.split_screen")}
        >
          {([2, 3, 4] as const).map((count, index) => (
            <button
              key={count}
              type="button"
              disabled={busy}
              aria-label={t("fcboard.split_count", { count })}
              onClick={() => void invoke("tools.split", { count, open: true })}
            >
              <FactoryIcon
                name={(["splitTwo", "splitThree", "splitFour"] as const)[index]}
              />
            </button>
          ))}
        </MaterialPanel>
      )}
      <TransientMessage message={error} role="alert" />
    </>
  );
};
