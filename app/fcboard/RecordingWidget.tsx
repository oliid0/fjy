import { useCallback, useEffect, useRef, useState } from "react";
import Paper from "@mui/material/Paper";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { t } from "@excalidraw/excalidraw/i18n";
import {
  playerPlayIcon,
  playerStopFilledIcon,
} from "@excalidraw/excalidraw/components/icons";

import { timestamp } from "./recording";

export const RecordingWidget = ({
  paused,
  elapsed,
  disabled,
  pauseDisabled,
  hidden = false,
  onPause,
  onStop,
  onRestore,
}: {
  paused: boolean;
  elapsed: number;
  disabled: boolean;
  pauseDisabled: boolean;
  hidden?: boolean;
  onPause: () => void;
  onStop: () => void;
  onRestore: () => void;
}) => {
  const [position, setPosition] = useState({
    x: Math.max(8, innerWidth / 2 - 140),
    y: Math.max(8, innerHeight - 150),
  });
  const panel = useRef<HTMLDivElement>(null);
  const size = useRef({ width: 280, height: 52 });
  const gesture = useRef<
    { id: number; x: number; y: number; before: typeof position } | undefined
  >(undefined);
  const bounded = useCallback((point: typeof position) => {
    size.current = {
      width: panel.current?.offsetWidth || size.current.width,
      height: panel.current?.offsetHeight || size.current.height,
    };
    return {
      x: Math.max(8, Math.min(innerWidth - size.current.width - 8, point.x)),
      y: Math.max(8, Math.min(innerHeight - size.current.height - 8, point.y)),
    };
  }, []);
  useEffect(() => {
    const resize = () => setPosition((point) => bounded(point));
    const cancel = () => {
      if (gesture.current) {
        setPosition(gesture.current.before);
        gesture.current = undefined;
      }
    };
    window.addEventListener("resize", resize);
    window.addEventListener("blur", cancel);
    resize();
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("blur", cancel);
    };
  }, [bounded, hidden]);
  const label = t(
    paused ? "fcboard.recording_resume" : "fcboard.recording_pause",
  );
  return (
    <Paper
      ref={panel}
      className="fc-recording-widget"
      elevation={5}
      role="toolbar"
      aria-label={t("fcboard.recording")}
      hidden={hidden}
      style={{
        left: position.x,
        top: position.y,
        display: hidden ? "none" : undefined,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div
        className="fc-recording-drag"
        role="button"
        tabIndex={0}
        aria-label={t("fcboard.recording")}
        onKeyDown={(event) => {
          const directions: Record<string, [number, number]> = {
            ArrowLeft: [-16, 0],
            ArrowRight: [16, 0],
            ArrowUp: [0, -16],
            ArrowDown: [0, 16],
          };
          const delta = directions[event.key];
          if (delta) {
            event.preventDefault();
            setPosition((point) =>
              bounded({ x: point.x + delta[0], y: point.y + delta[1] }),
            );
          }
        }}
        onPointerDown={(event) => {
          if (
            gesture.current ||
            event.isPrimary === false ||
            event.button > 0
          ) {
            return;
          }
          event.preventDefault();
          gesture.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            before: position,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = gesture.current;
          if (drag?.id === event.pointerId) {
            setPosition(
              bounded({
                x: drag.before.x + event.clientX - drag.x,
                y: drag.before.y + event.clientY - drag.y,
              }),
            );
          }
        }}
        onPointerUp={(event) => {
          if (gesture.current?.id === event.pointerId) {
            gesture.current = undefined;
          }
        }}
        onPointerCancel={() => {
          if (gesture.current) {
            setPosition(gesture.current.before);
          }
          gesture.current = undefined;
        }}
        onLostPointerCapture={() => {
          if (gesture.current) {
            setPosition(gesture.current.before);
          }
          gesture.current = undefined;
        }}
      >
        <span className="fc-recording-indicator" data-paused={paused} />
        <time>{timestamp(elapsed)}</time>
      </div>
      <Tooltip title={label}>
        <span>
          <IconButton
            disabled={disabled || pauseDisabled}
            aria-label={label}
            onClick={onPause}
          >
            {paused ? (
              playerPlayIcon
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M6 4h4v16H6zm8 0h4v16h-4z" />
              </svg>
            )}
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={t("fcboard.stop_recording")}>
        <span>
          <IconButton
            color="error"
            disabled={disabled}
            aria-label={t("fcboard.stop_recording")}
            onClick={onStop}
          >
            {playerStopFilledIcon}
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={t("fcboard.restore_recording_window")}>
        <IconButton
          aria-label={t("fcboard.restore_recording_window")}
          onClick={onRestore}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5"
              stroke="currentColor"
              strokeWidth="2"
              fill="none"
            />
          </svg>
        </IconButton>
      </Tooltip>
    </Paper>
  );
};
