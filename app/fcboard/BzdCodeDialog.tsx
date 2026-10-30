import { useEffect, useRef, useState } from "react";
import { t } from "@fcboard/fcboard/i18n";

import { MaterialPanel } from "./MaterialPanel";
import { TransientMessage } from "./TransientMessage";
import closeIcon from "./factory-setting-icons/close.svg";
import "./CloudTransfers.scss";

/** ExtraCodePopu: editable read code; non-editable successful upload, with one confirm button. */
export const BzdCodeDialog = ({
  code,
  onClose,
  onRead,
}: {
  code?: string;
  onClose: () => void;
  onRead?: (code: string, signal: AbortSignal) => Promise<void>;
}) => {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => pending.current?.abort(), []);
  const close = () => {
    pending.current?.abort();
    onClose();
  };
  return (
    <MaterialPanel
      centered
      onDismiss={close}
      className="fc-bzd-code fc-surface"
      role="dialog"
      aria-label={t(
        code
          ? "fcboard.cloud_transfer.uploaded"
          : "fcboard.cloud_transfer.enter_code",
      )}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          close();
        }
      }}
    >
      <button
        type="button"
        className="fc-bzd-code-close"
        aria-label={t("buttons.close")}
        onClick={close}
      >
        <img src={closeIcon} alt="" />
      </button>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (code) {
            close();
            return;
          }
          if (pending.current || !onRead || input.length !== 4) {
            return;
          }
          const request = new AbortController();
          pending.current = request;
          setBusy(true);
          setError("");
          void onRead(input, request.signal)
            .then(() => {
              if (!request.signal.aborted) {
                close();
              }
            })
            .catch((failure) => {
              if (!request.signal.aborted) {
                setError(
                  failure instanceof Error ? failure.message : String(failure),
                );
              }
            })
            .finally(() => {
              if (pending.current === request) {
                pending.current = undefined;
                if (!request.signal.aborted) {
                  setBusy(false);
                }
              }
            });
        }}
      >
        <label>
          {t(
            code
              ? "fcboard.cloud_transfer.uploaded"
              : "fcboard.cloud_transfer.enter_code",
          )}
          <input
            aria-label={t("fcboard.cloud_transfer.code")}
            autoComplete="off"
            maxLength={4}
            pattern="[a-zA-Z0-9]{4}"
            value={code ?? input}
            readOnly={!!code}
            disabled={busy}
            onChange={(event) => {
              if (/^[a-zA-Z0-9]{0,4}$/.test(event.target.value)) {
                setInput(event.target.value);
              }
            }}
          />
        </label>
        {code && <p>{t("fcboard.cloud_transfer.expires")}</p>}
        <TransientMessage message={error} role="alert" />
        <footer>
          {!code && (
            <button type="button" onClick={close}>
              {t("buttons.cancel")}
            </button>
          )}
          <button
            type="submit"
            disabled={busy || (!code && input.length !== 4)}
          >
            {busy ? t("fcboard.processing") : t("buttons.confirm")}
          </button>
        </footer>
      </form>
    </MaterialPanel>
  );
};
