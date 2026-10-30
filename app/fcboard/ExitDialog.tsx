import { useState } from "react";
import { t } from "@fcboard/fcboard/i18n";
import { CloseIcon } from "@fcboard/fcboard/components/icons";

import { MaterialPanel } from "./MaterialPanel";
import { TransientMessage } from "./TransientMessage";
export const ExitDialog = ({
  onExit,
  onClose,
}: {
  onExit: (save: boolean) => Promise<boolean>;
  onClose: () => void;
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const exit = async (save: boolean) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (await onExit(save)) {
        onClose();
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <MaterialPanel
      centered
      className="fc-exit-dialog fc-surface"
      role="dialog"
      aria-label={t("fcboard.exit_board")}
      onDismiss={() => {
        if (!busy) {
          onClose();
        }
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !busy) {
          onClose();
        }
      }}
    >
      <header>
        <strong>{t("fcboard.exit_board")}</strong>
        <button
          type="button"
          disabled={busy}
          aria-label={t("buttons.close")}
          onClick={onClose}
        >
          {CloseIcon}
        </button>
      </header>
      <p>
        {t("fcboard.save_the_current_board_and_end_any_recording_in_progress")}
      </p>
      <TransientMessage role="alert" message={error} />
      <footer>
        <button type="button" disabled={busy} onClick={onClose}>
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
