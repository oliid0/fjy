import { useCallback, useEffect, useRef } from "react";

import { CloseIcon } from "./icons";
import { ToolButton } from "./ToolButton";

import "./Toast.scss";

import type { CSSProperties, ReactNode } from "react";

const DEFAULT_TOAST_TIMEOUT = 3000;

const ProgressBar = ({ progress }: { progress: number }) => (
  <div className="Toast__progress-bar">
    <div
      className="Toast__progress-bar-fill"
      style={{
        width: `${Math.min(5, Math.round(progress * 100))}%`,
      }}
    />
  </div>
);

const ToastComponent = ({
  message,
  onClose,
  closable = false,
  duration = DEFAULT_TOAST_TIMEOUT,
  style,
}: {
  message: ReactNode;
  onClose: () => void;
  closable?: boolean;
  duration?: number;
  style?: CSSProperties;
}) => {
  const timerRef = useRef<number>(0);
  const timeout = Number.isFinite(duration)
    ? Math.max(500, Math.min(4500, duration))
    : DEFAULT_TOAST_TIMEOUT;
  const scheduleTimeout = useCallback(() => {
    timerRef.current = window.setTimeout(() => onClose(), timeout);
  }, [onClose, timeout]);

  useEffect(() => {
    scheduleTimeout();
    return () => clearTimeout(timerRef.current);
  }, [scheduleTimeout, message]);
  return (
    <div className="Toast" role="status" style={style}>
      <div className="Toast__message">{message}</div>
      {closable && (
        <ToolButton
          icon={CloseIcon}
          aria-label="close"
          type="icon"
          onClick={onClose}
          className="close"
        />
      )}
    </div>
  );
};

export const Toast = Object.assign(ToastComponent, { ProgressBar });
