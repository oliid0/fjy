import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@fcboard/fcboard/i18n";

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
    if (!open || full) {
      return;
    }
    const timer = setTimeout(
      () => setCompact(true),
      state.started === null ? 7000 : 5000,
    );
    return () => clearTimeout(timer);
  }, [open, full, state.started, interaction]);
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
  return open ? (
    <FloatingToolPanel
      title={t("fcboard.timer")}
      width={420}
      fullscreen={full}
      onClose={() => act({ action: "close" })}
    >
      <div
        className="fc-builtin-body"
        data-compact={compact && !full}
        onPointerDownCapture={reveal}
        onKeyDownCapture={reveal}
      >
        <output
          role="timer"
          tabIndex={compact && !full ? 0 : undefined}
          onClick={reveal}
          className="fc-timer-digits"
          style={{
            color: seconds < 5 ? "#d32f2f" : undefined,
            fontSize: full ? "clamp(40px, 10vw, 160px)" : undefined,
          }}
        >
          {text}
        </output>
        {(!compact || full) && (
          <>
            <label>
              {t("fcboard.timer_seconds")}
              <input
                type="number"
                min={1}
                max={359999}
                disabled={state.started !== null}
                value={state.duration / 1000}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (value >= 1 && value <= 359999) {
                    act({ action: "configure", seconds: value });
                  }
                }}
              />
            </label>
            <div className="fc-builtin-row">
              <button
                type="button"
                onClick={() => {
                  unlockSound();
                  act({ action: state.started === null ? "start" : "pause" });
                }}
              >
                {t(
                  state.started === null
                    ? "fcboard.play_tool"
                    : "fcboard.pause_tool",
                )}
              </button>
              <button type="button" onClick={() => act({ action: "reset" })}>
                {t("fcboard.reset")}
              </button>
              <button
                type="button"
                aria-pressed={full}
                onClick={() => setFull(!full)}
              >
                {t("fcboard.fullscreen")}
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={state.muted}
                  onChange={(event) =>
                    act({ action: "configure", muted: event.target.checked })
                  }
                />
                {t("fcboard.timer_mute")}
              </label>
            </div>
          </>
        )}
      </div>
    </FloatingToolPanel>
  ) : null;
};
