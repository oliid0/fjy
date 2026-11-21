import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@fcboard/fcboard/i18n";
import {
  playerPlayIcon,
  playerStopFilledIcon,
  settingsIcon,
  fullscreenIcon,
  resetZoom,
} from "@fcboard/fcboard/components/icons";

import { TimerWheel } from "./TimerWheel";

import { classroomCommands } from "./commands";
import { FloatingToolPanel } from "./FloatingToolPanel";

/** TimerFloatingService: remaining = saved time - (wall clock - start), not interval ticks. */
export const timerValue = (
  state: { elapsed: number; started: number | null },
  now = Date.now(),
) =>
  state.elapsed +
  (state.started === null ? 0 : Math.max(0, now - state.started));
export const ToolTimer = () => {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [compact, setCompact] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState([0, 1, 0]);
  const [interaction, setInteraction] = useState(0);
  const reveal = useCallback(() => {
    setCompact(false);
    setInteraction((value) => value + 1);
  }, []);
  const [state, setState] = useState({
    duration: 60000,
    elapsed: 0,
    started: null as number | null,
    muted: false,
  });
  const current = useRef(state);
  current.current = state;
  const [now, setNow] = useState(Date.now);
  const sound = useRef<AudioContext | undefined>(undefined);
  const unlockSound = () => {
    if (typeof AudioContext === "undefined") {
      return;
    }
    sound.current ??= new AudioContext();
    void sound.current.resume().catch(() => {});
  };
  useEffect(
    () => () => {
      void sound.current?.close();
    },
    [],
  );
  useEffect(() => {
    if (state.started === null) {
      return;
    }
    const tick = () => {
      const clock = Date.now();
      setNow(clock);
      if (timerValue(current.current, clock) >= current.current.duration) {
        setState((value) => ({
          ...value,
          elapsed: value.duration,
          started: null,
        }));
      }
    };
    tick();
    const id = window.setInterval(tick, 100);
    return () => clearInterval(id);
  }, [state.started]);
  // TimerFloatingService.mCountdownTone rings immediately and every minute until stopped.
  useEffect(() => {
    const audio = sound.current;
    if (
      !open ||
      state.started !== null ||
      state.elapsed < state.duration ||
      state.muted ||
      audio?.state !== "running"
    ) {
      return;
    }
    const active = new Set<OscillatorNode>();
    const ring = () => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.12, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 1.5);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.onended = () => {
        active.delete(oscillator);
        oscillator.disconnect();
        gain.disconnect();
      };
      active.add(oscillator);
      oscillator.start();
      oscillator.stop(audio.currentTime + 1.5);
    };
    ring();
    const repeat = window.setInterval(ring, 60000);
    return () => {
      clearInterval(repeat);
      active.forEach((oscillator) => oscillator.stop());
    };
  }, [open, state.started, state.elapsed, state.duration, state.muted]);
  // TimerFloatingService.vanish: 5s after start, otherwise 7s; tapping restores controls.
  useEffect(() => {
    if (!open || full || editing) {
      return;
    }
    const timer = setTimeout(
      () => setCompact(true),
      state.started === null ? 7000 : 5000,
    );
    return () => clearTimeout(timer);
  }, [open, full, editing, state.started, interaction]);
  const act = useCallback(
    (args: Record<string, unknown>) => {
      const action = args.action ?? "open";
      if (
        ![
          "open",
          "close",
          "read",
          "start",
          "pause",
          "reset",
          "configure",
        ].includes(String(action)) ||
        (args.seconds !== undefined &&
          (typeof args.seconds !== "number" ||
            !Number.isFinite(args.seconds) ||
            args.seconds < 1 ||
            args.seconds > 359999)) ||
        (args.muted !== undefined && typeof args.muted !== "boolean")
      ) {
        throw new Error(t("fcboard.invalid_style_parameters"));
      }
      const clock = Date.now();
      const previous = current.current;
      let next = { ...previous };
      if (args.seconds !== undefined) {
        next = {
          ...next,
          duration: Number(args.seconds) * 1000,
          elapsed: 0,
          started: null,
        };
      }
      if (typeof args.muted === "boolean") {
        next.muted = args.muted;
      }
      if (action === "close" || action === "start") {
        setEditing(false);
      }
      if (action === "close") {
        setFull(false);
      }
      if (action === "start" && next.started === null) {
        next.started = clock;
        if (next.elapsed >= next.duration) {
          next.elapsed = 0;
        }
      }
      if (action === "pause") {
        next.elapsed = Math.min(next.duration, timerValue(next, clock));
        next.started = null;
      }
      if (action === "reset" || action === "close") {
        next.elapsed = 0;
        next.started = null;
      }
      current.current = next;
      setState(next);
      setNow(clock);
      if (action !== "read") {
        reveal();
        setOpen(action !== "close");
      }
      return {
        ...next,
        remaining: Math.max(0, next.duration - timerValue(next, clock)) / 1000,
        running: next.started !== null,
      };
    },
    [reveal],
  );
  useEffect(
    () =>
      classroomCommands.register(
        "tools.timer",
        "Built-in countdown. args.action=open|close|read|start|pause|reset|configure; seconds=1..359999, muted=boolean. Continues while other board tools are used.",
        act,
      ),
    [act],
  );
  const seconds = Math.ceil(
    Math.max(0, state.duration - timerValue(state, now)) / 1000,
  );
  const text = [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
  if (!open) {
    return null;
  }
  if (full) {
    return (
      <section
        className="fc-timer-full"
        role="dialog"
        aria-label={t("fcboard.timer")}
        tabIndex={0}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => {
          setFull(false);
          reveal();
        }}
        onKeyDown={(event) => {
          if (["Escape", "Enter", " "].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            setFull(false);
            reveal();
          }
        }}
      >
        <output
          role="timer"
          style={{ color: seconds < 5 ? "#ff0000" : "#ffffff" }}
        >
          {text}
        </output>
      </section>
    );
  }
  const setTime = () => {
    const remaining = Math.ceil(
      Math.max(0, current.current.duration - timerValue(current.current)) /
        1000,
    );
    act({ action: "pause" });
    setDraft([
      Math.min(23, Math.floor(remaining / 3600)),
      Math.floor(remaining / 60) % 60,
      remaining % 60,
    ]);
    setEditing(true);
  };
  return (
    <FloatingToolPanel
      title={t("fcboard.timer")}
      width={420}
      hideHeader={compact && !editing}
      className={`fc-native-timer ${compact && !editing ? "is-compact" : ""} ${
        editing ? "is-editing" : ""
      }`}
      headerActions={
        <button
          type="button"
          className="fc-timer-mute"
          aria-label={t("fcboard.timer_mute")}
          aria-pressed={state.muted}
          onClick={() => act({ action: "configure", muted: !state.muted })}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d="M10 5 5 9H2v6h3l5 4z" />
            {state.muted ? (
              <path d="m15 9 6 6m0-6-6 6" />
            ) : (
              <path d="M14 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
            )}
          </svg>
        </button>
      }
      onClose={() => act({ action: "close" })}
    >
      <div
        className="fc-timer-body"
        onPointerDownCapture={reveal}
        onKeyDownCapture={reveal}
      >
        {editing ? (
          <div
            className="fc-timer-wheels"
            role="group"
            aria-label={t("fcboard.timer_seconds")}
          >
            {draft.map((value, index) => (
              <span key={index}>
                {index > 0 && <b aria-hidden="true">:</b>}
                <TimerWheel
                  label={["HH", "MM", "SS"][index]}
                  max={index === 0 ? 23 : 59}
                  value={value}
                  onChange={(next) =>
                    setDraft((previous) =>
                      previous.map((part, position) =>
                        position === index ? next : part,
                      ),
                    )
                  }
                />
              </span>
            ))}
          </div>
        ) : (
          <output
            role="timer"
            tabIndex={0}
            onClick={reveal}
            className="fc-timer-digits"
            style={{ color: seconds < 5 ? "#ff0000" : undefined }}
          >
            {text}
          </output>
        )}
        {(!compact || editing) && (
          <div className="fc-timer-actions">
            <button
              type="button"
              aria-label={t(editing ? "fcboard.reset" : "fcboard.settings")}
              onClick={editing ? () => setDraft([0, 0, 0]) : setTime}
            >
              {editing ? resetZoom : settingsIcon}
            </button>
            <button
              type="button"
              aria-label={t(
                state.started === null
                  ? "fcboard.play_tool"
                  : "fcboard.pause_tool",
              )}
              disabled={editing && !draft.some(Boolean)}
              onClick={() => {
                unlockSound();
                if (editing) {
                  act({
                    action: "configure",
                    seconds: draft[0] * 3600 + draft[1] * 60 + draft[2],
                  });
                }
                act({ action: state.started === null ? "start" : "pause" });
              }}
            >
              {state.started === null ? playerPlayIcon : playerStopFilledIcon}
            </button>
            {!editing && (
              <button
                type="button"
                aria-label={t("fcboard.fullscreen")}
                onClick={() => setFull(true)}
              >
                {fullscreenIcon}
              </button>
            )}
          </div>
        )}
      </div>
    </FloatingToolPanel>
  );
};
