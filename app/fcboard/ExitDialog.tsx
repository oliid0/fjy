import { useEffect, useRef, useState } from "react";
import { t } from "@fcboard/fcboard/i18n";
import { CloseIcon } from "@fcboard/fcboard/components/icons";

import { MaterialPanel } from "./MaterialPanel";
import { TransientMessage } from "./TransientMessage";
export const ExitDialog = ({
  onExit,
  onClose,
}: {
  onExit: (save: boolean, signal: AbortSignal) => Promise<boolean>;
  onClose: () => void;
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => request.current?.abort(), []);
  const close = () => {
    request.current?.abort();
    request.current = undefined;
    setBusy(false);
    onClose();
  };
  const exit = async (save: boolean) => {
    if (request.current) {
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      if (
        (await onExit(save, controller.signal)) &&
        !controller.signal.aborted
      ) {
        onClose();
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (request.current === controller) {
        request.current = undefined;
        setBusy(false);
      }
    }
  };
  return (
    <MaterialPanel
      centered
      className="fc-exit-dialog fc-surface"
      role="dialog"
      aria-label={t("fcboard.exit_board")}
      onDismiss={close}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          close();
        }
      }}
    >
      <header>
        <strong>{t("fcboard.exit_board")}</strong>
        <button type="button" aria-label={t("buttons.close")} onClick={close}>
          {CloseIcon}
        </button>
      </header>
      <p>
        {t("fcboard.save_the_current_board_and_end_any_recording_in_progress")}
      </p>
      <TransientMessage role="alert" message={error} />
      <footer>
        <button type="button" onClick={close}>
          {t("buttons.cancel")}
        </button>
        <button type="button" disabled={busy} onClick={() => void exit(false)}>
          {t("fcboard.exit_without_saving")}
        </button>
        <button
          type="button"
          className="fc-primary"
          disabled={busy}
          onClick={() => void exit(true)}
        >
          {t("fcboard.save_and_exit")}
        </button>
      </footer>
      {busy && <p role="status">{t("fcboard.processing")}</p>}
    </MaterialPanel>
  );
};
