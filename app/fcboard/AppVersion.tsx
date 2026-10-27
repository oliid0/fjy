import { Capacitor } from "@capacitor/core";
import { t } from "@excalidraw/excalidraw/i18n";
import { useEffect, useRef, useState } from "react";

import { version } from "../package.json";

import { Classroom } from "./native";
import { TransientMessage } from "./TransientMessage";

export const AppVersion = () => {
  const [label, setLabel] = useState(version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const taps = useRef<number[]>([]);
  const native = Capacitor.isNativePlatform();
  useEffect(() => {
    if (!native) {
      return;
    }
    let disposed = false;
    void Classroom.getAppVersion()
      .then((info) => {
        if (!disposed) {
          setLabel(`${info.name} (${info.code})`);
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, [native]);
  const tap = async () => {
    if (!native || busy) {
      return;
    }
    const now = Date.now();
    taps.current = [...taps.current.filter((time) => now - time < 2000), now];
    if (taps.current.length < 3) {
      return;
    }
    taps.current = [];
    setBusy(true);
    setError("");
    try {
      await Classroom.openDebugSettings();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fc-app-version">
      <button type="button" disabled={busy} onClick={() => void tap()}>
        {t("stats.version")} {label}
      </button>
      <TransientMessage message={error} role="alert" />
    </div>
  );
};
