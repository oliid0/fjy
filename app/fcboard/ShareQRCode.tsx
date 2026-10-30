import { t } from "@fcboard/fcboard/i18n";
import { useCallback, useEffect, useRef, useState } from "react";

import { QRCode } from "../share/QRCode";

import { TransientMessage } from "./TransientMessage";

const randomCode = () =>
  Array.from({ length: 4 }, () => Math.floor(Math.random() * 10)).join("");

/** Own the switch state for the share's lifetime, including closing/reopening its panel. */
export const useShareProtection = (
  onPasswordChange: (password: string) => Promise<void>,
) => {
  const [enabled, setEnabled] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState("");
  const applying = useRef(false);
  const applied = useRef("");
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const reset = useCallback(() => {
    generation.current++;
    applying.current = false;
    applied.current = "";
    setEnabled(false);
    setPassword(randomCode());
    setBusy(false);
    setError("");
    setCreated(new Date().toLocaleString());
  }, []);

  const update = async (nextEnabled: boolean, nextPassword: string) => {
    if (applying.current) {
      return;
    }
    const previous = { enabled, password: applied.current || password };
    const value = nextEnabled ? nextPassword : "";
    setEnabled(nextEnabled);
    setPassword(nextPassword);
    setError("");
    if (nextEnabled && !/^\d{4}$/.test(value)) {
      return;
    }
    if (value === applied.current) {
      return;
    }
    applying.current = true;
    const current = generation.current;
    setBusy(true);
    try {
      await onPasswordChange(value);
      if (current !== generation.current) {
        return;
      }
      applied.current = value;
    } catch (failure) {
      if (current !== generation.current) {
        return;
      }
      setEnabled(previous.enabled);
      setPassword(previous.password);
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (current === generation.current) {
        applying.current = false;
        setBusy(false);
      }
    }
  };
  return {
    enabled,
    password,
    busy,
    error,
    created,
    update,
    reset,
  };
};

/** QRHttpPopu.initView/syncPhotoPwdIfReady and http_popu_view.xml. */
export const ShareQRCode = ({
  url,
  protection,
}: {
  url: string;
  protection: ReturnType<typeof useShareProtection>;
}) => {
  const { enabled, password, busy, error, created, update } = protection;

  return (
    <div className="fc-qr-content" aria-busy={busy}>
      <label className="fc-qr-protection">
        <span>{t("fcboard.qr_password_protection")}</span>
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={busy}
          onChange={(event) => void update(event.target.checked, password)}
        />
      </label>
      <p className="fc-qr-description">
        {t("fcboard.qr_password_protection_desc")}
      </p>
      {enabled && (
        <label className="fc-qr-password">
          <span>{t("fcboard.qr_my_password")}</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
            autoComplete="off"
            spellCheck={false}
            value={password}
            disabled={busy}
            onChange={(event) => {
              const value = event.target.value;
              if (/^\d{0,4}$/.test(value)) {
                void update(true, value);
              }
            }}
          />
        </label>
      )}
      <div className="fc-qr-image">
        <QRCode value={url} />
      </div>
      <time className="fc-qr-time">{created}</time>
      <TransientMessage message={error} role="alert" />
    </div>
  );
};
