import { useEffect, useRef, useState } from "react";
import { t } from "@fcboard/fcboard/i18n";

import { MaterialPanel } from "./MaterialPanel";
import { TransientMessage } from "./TransientMessage";
import { loadCloudShare, saveCloudShare } from "./cloudShare";
import cloudIcon from "./factory-share-icons/cloud.svg";
import localIcon from "./factory-share-icons/local.svg";
import closeIcon from "./factory-setting-icons/close.svg";
import "./LiveShare.scss";

import type { CloudShareConfig } from "./cloudShare";

/** ChooseBzdPopu and ChooseServerPopu share layout_chooser_bzd. */
export const ShareServerChooser = ({
  title,
  onClose,
  onLocal,
  onCloud,
  requireKey = true,
  localDisabled,
}: {
  title: string;
  onClose: () => void;
  onLocal: (signal: AbortSignal) => Promise<void>;
  onCloud: (config: CloudShareConfig, signal: AbortSignal) => Promise<void>;
  requireKey?: boolean;
  localDisabled?: string;
}) => {
  const [config, setConfig] = useState(loadCloudShare);
  const [cloud, setCloud] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => pending.current?.abort(), []);
  const close = () => {
    pending.current?.abort();
    onClose();
  };
  const run = async (
    operation: (signal: AbortSignal) => Promise<void>,
    showCloudOnError = false,
  ) => {
    if (pending.current) {
      return;
    }
    const request = new AbortController();
    pending.current = request;
    setBusy(true);
    setError("");
    try {
      await operation(request.signal);
    } catch (failure) {
      if (!request.signal.aborted) {
        if (showCloudOnError) {
          setCloud(true);
        }
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      if (pending.current === request) {
        pending.current = undefined;
        if (!request.signal.aborted) {
          setBusy(false);
        }
      }
    }
  };
  const configure = (next: CloudShareConfig) => {
    setConfig(next);
    saveCloudShare(next);
  };
  return (
    <MaterialPanel
      centered
      onDismiss={close}
      className={`fc-network-panel fc-surface ${
        cloud ? "fc-live-share-config" : "fc-live-share-picker"
      }`}
      role="dialog"
      aria-label={title}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          close();
        }
      }}
    >
      <header>
        <strong>{title}</strong>
        <button type="button" aria-label={t("buttons.close")} onClick={close}>
          <img src={closeIcon} alt="" />
        </button>
      </header>
      <TransientMessage message={error} role="alert" />
      {cloud ? (
        <form
          className="fc-live-share-cloud"
          onSubmit={(event) => {
            event.preventDefault();
            void run((signal) => onCloud(config, signal));
          }}
        >
          <button
            type="button"
            className="fc-live-share-back"
            disabled={busy}
            onClick={() => setCloud(false)}
          >
            {t("fcboard.back")}
          </button>
          <label>
            {t("fcboard.live_share.endpoint")}
            <input
              type="url"
              autoComplete="url"
              value={config.endpoint}
              disabled={busy}
              onChange={(event) =>
                configure({ ...config, endpoint: event.target.value })
              }
            />
          </label>
          <label>
            {t("fcboard.live_share.key_label")}
            <input
              type="password"
              autoComplete="off"
              value={config.key}
              disabled={busy}
              onChange={(event) =>
                configure({ ...config, key: event.target.value })
              }
            />
          </label>
          <button
            type="submit"
            disabled={busy || !config.endpoint.trim() || !config.key.trim()}
          >
            {busy ? t("fcboard.processing") : t("buttons.confirm")}
          </button>
        </form>
      ) : (
        <div className="fc-live-share-choices" aria-busy={busy}>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!requireKey || config.key.trim().length >= 16) {
                void run((signal) => onCloud(config, signal), true);
              } else {
                setCloud(true);
              }
            }}
          >
            <img src={cloudIcon} alt="" />
            <span>{t("fcboard.live_share.cloud")}</span>
          </button>
          <button
            type="button"
            disabled={busy || !!localDisabled}
            title={localDisabled}
            onClick={() => void run(onLocal)}
          >
            <img src={localIcon} alt="" />
            <span>{t("fcboard.live_share.local")}</span>
          </button>
        </div>
      )}
      {busy && <p role="status">{t("fcboard.processing")}</p>}
    </MaterialPanel>
  );
};
