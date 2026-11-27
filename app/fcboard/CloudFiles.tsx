import { useEffect, useRef, useState } from "react";
import { t } from "@fcboard/fcboard/i18n";

import { classroomCommands, executeBoardCommand } from "./commands";
import { BzdCodeDialog } from "./BzdCodeDialog";
import { MaterialPanel } from "./MaterialPanel";
import { TransientMessage } from "./TransientMessage";
import { loadCloudShare, saveCloudShare } from "./cloudShare";

/** Cloud retrieval/upload keeps its existing service and extraction codes. */
export const CloudFiles = () => {
  const [view, setView] = useState<"choose" | "code">();
  const [config, setConfig] = useState(loadCloudShare);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | undefined>(undefined);
  const close = () => {
    pending.current?.abort();
    pending.current = undefined;
    setBusy(false);
    setView(undefined);
  };
  useEffect(() => {
    const stop = classroomCommands.register(
      "files.cloud",
      "Retrieve an editable cloud board using its extraction code or save all current boards to the existing cloud service.",
      () => {
        pending.current?.abort();
        pending.current = undefined;
        setBusy(false);
        setConfig(loadCloudShare());
        setError("");
        setView("choose");
      },
    );
    return () => {
      pending.current?.abort();
      stop();
    };
  }, []);
  if (view === "code") {
    return (
      <BzdCodeDialog
        onClose={close}
        onRead={async (code, signal) => {
          await executeBoardCommand(
            { name: "board.open", args: { code, endpoint: config.endpoint } },
            signal,
          );
        }}
      />
    );
  }
  if (!view) {
    return null;
  }
  return (
    <MaterialPanel
      centered
      onDismiss={close}
      role="dialog"
      aria-label={t("fcboard.cloud_files")}
      className="fc-network-panel fc-surface"
    >
      <header>
        <strong>{t("fcboard.cloud_files")}</strong>
        <button type="button" onClick={close}>
          {t("buttons.close")}
        </button>
      </header>
      <TransientMessage message={error} role="alert" />
      <label>
        {t("fcboard.live_share.endpoint")}
        <input
          type="url"
          value={config.endpoint}
          disabled={busy}
          onChange={(event) => {
            const next = { ...config, endpoint: event.target.value };
            setConfig(next);
            saveCloudShare(next);
          }}
        />
      </label>
      <label>
        {t("fcboard.live_share.key_label")}
        <input
          type="password"
          value={config.key}
          disabled={busy}
          onChange={(event) => {
            const next = { ...config, key: event.target.value };
            setConfig(next);
            saveCloudShare(next);
          }}
        />
      </label>
      <footer>
        <button
          type="button"
          disabled={busy || !config.endpoint.trim()}
          onClick={() => setView("code")}
        >
          {t("fcboard.retrieve_cloud_file")}
        </button>
        <button
          type="button"
          disabled={busy || !config.endpoint.trim() || !config.key.trim()}
          onClick={() => {
            const request = new AbortController();
            pending.current = request;
            setBusy(true);
            setError("");
            void executeBoardCommand(
              { name: "board.cloudSave", args: { config } },
              request.signal,
            )
              .then(
                () => {
                  if (!request.signal.aborted) {
                    setView(undefined);
                  }
                },
                (failure) => {
                  if (!request.signal.aborted) {
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : String(failure),
                    );
                  }
                },
              )
              .finally(() => {
                if (pending.current === request) {
                  pending.current = undefined;
                  setBusy(false);
                }
              });
          }}
        >
          {busy ? t("fcboard.processing") : t("fcboard.save_cloud_file")}
        </button>
      </footer>
    </MaterialPanel>
  );
};
