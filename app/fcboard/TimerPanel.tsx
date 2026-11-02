import { useEffect, useRef, useState } from "react";

import { classroomCommands } from "./commands";

import "./TimerPanel.scss";

/** TimerFloatingService: elapsed time comes from the clock, never interval ticks. */
export const TimerPanel = () => {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [duration, setDuration] = useState(60);
  const [remaining, setRemaining] = useState(60);
  const [running, setRunning] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [position, setPosition] = useState({ x: 24, y: 80 });
  const audio = useRef<AudioContext | undefined>(undefined);
  const deadline = useRef(0);
  const value = useRef({ remaining, running });
  value.current = { remaining, running };
  const dragging = useRef<{ id: number; x: number; y: number } | undefined>(
    undefined,
  );
  const panel = useRef<HTMLDivElement>(null);
  const activateAudio = () => {
    if (typeof AudioContext !== "undefined") {
      audio.current ||= new AudioContext();
      void audio.current
        .resume()
        .catch(() => setError("提示音不可用，倒计时结束会显示提醒。"));
    }
  };
  const start = (seconds = value.current.remaining) => {
    activateAudio();
    const next = seconds > 0 ? seconds : duration;
    setRemaining(next);
    deadline.current = Date.now() + next * 1000;
    setRunning(true);
  };
  const actions = useRef({ start });
  actions.current = { start };
  useEffect(() => {
    const release = classroomCommands.register(
      "tools.timer",
      "打开内置倒计时浮窗；可设args.seconds=1..359999、args.start=true开始。支持暂停/继续/重置/静音/全屏，无需外部APK。",
      (args) => {
        if (
          args.seconds !== undefined &&
          (typeof args.seconds !== "number" ||
            !Number.isFinite(args.seconds) ||
            args.seconds < 1 ||
            args.seconds > 359999)
        ) {
          throw new Error("倒计时应为1至359999秒");
        }
        setOpen(true);
        if (typeof args.seconds === "number") {
          setDuration(args.seconds);
          setRemaining(args.seconds);
          setRunning(false);
        }
        if (args.start === true) {
          actions.current.start(
            typeof args.seconds === "number" ? args.seconds : undefined,
          );
        }
        return { opened: true };
      },
    );
    return () => {
      release();
      void audio.current?.close();
    };
  }, []);
  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = setInterval(() => {
      const next = Math.max(0, (deadline.current - Date.now()) / 1000);
      setRemaining(next);
      if (!next) {
        setRunning(false);
      }
    }, 200);
    return () => clearInterval(timer);
  }, [running]);
  useEffect(() => {
    if (!open || remaining !== 0 || muted) {
      return;
    }
    const ring = () => {
      const context = audio.current;
      if (!context || context.state !== "running") {
        return;
      }
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.8);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.8);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    };
    ring();
    const timer = setInterval(ring, 60000);
    return () => clearInterval(timer);
  }, [open, remaining, muted]);
  if (!open) {
    return null;
  }
  const displayed = Math.ceil(remaining);
  const fields = [
    Math.floor(duration / 3600),
    Math.floor(duration / 60) % 60,
    duration % 60,
  ];
  return (
    <div
      className={`fc-timer-panel${full ? " fc-timer-full" : ""}`}
      ref={panel}
      role="region"
      aria-label="计时器"
      style={full ? undefined : { left: position.x, top: position.y }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header
        onPointerDown={(event) => {
          if (full || (event.target as HTMLElement).closest("button")) {
            return;
          }
          event.preventDefault();
          dragging.current = {
            id: event.pointerId,
            x: event.clientX - position.x,
            y: event.clientY - position.y,
          };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          const gesture = dragging.current;
          if (gesture?.id === event.pointerId) {
            const bounds = panel.current?.getBoundingClientRect();
            setPosition({
              x: Math.max(
                0,
                Math.min(
                  innerWidth - (bounds?.width || 300),
                  event.clientX - gesture.x,
                ),
              ),
              y: Math.max(
                0,
                Math.min(
                  innerHeight - (bounds?.height || 240),
                  event.clientY - gesture.y,
                ),
              ),
            });
          }
        }}
        onPointerUp={() => {
          dragging.current = undefined;
        }}
        onPointerCancel={() => {
          dragging.current = undefined;
        }}
        onLostPointerCapture={() => {
          dragging.current = undefined;
        }}
      >
        <strong>计时器</strong>
        <button
          onClick={() => {
            setRunning(false);
            setOpen(false);
          }}
        >
          关闭
        </button>
      </header>
      <output
        aria-live={remaining === 0 ? "assertive" : "off"}
        aria-label="剩余时间"
      >
        {String(Math.floor(displayed / 3600)).padStart(2, "0")}:
        {String(Math.floor(displayed / 60) % 60).padStart(2, "0")}:
        {String(displayed % 60).padStart(2, "0")}
      </output>
      {remaining === 0 && <p role="status">倒计时结束</p>}
      <div className="fc-timer-duration">
        {["小时", "分钟", "秒"].map((label, index) => (
          <label key={label}>
            {label}
            <input
              aria-label={label}
              type="number"
              min={0}
              max={index ? 59 : 99}
              disabled={running}
              value={fields[index]}
              onChange={(event) => {
                const next = [...fields];
                next[index] = Math.max(
                  0,
                  Math.min(
                    index ? 59 : 99,
                    Math.floor(Number(event.target.value) || 0),
                  ),
                );
                const seconds = next[0] * 3600 + next[1] * 60 + next[2];
                setDuration(seconds);
                setRemaining(seconds);
              }}
            />
          </label>
        ))}
      </div>
      <div className="fc-timer-actions">
        <button
          disabled={!running && !remaining && !duration}
          onClick={() => {
            if (running) {
              setRemaining(Math.max(0, (deadline.current - Date.now()) / 1000));
              setRunning(false);
            } else {
              start();
            }
          }}
        >
          {running ? "暂停" : "开始 / 继续"}
        </button>
        <button
          onClick={() => {
            setRunning(false);
            setRemaining(duration);
          }}
        >
          重置
        </button>
        <button
          aria-pressed={muted}
          onClick={() => {
            if (muted) {
              activateAudio();
            }
            setMuted(!muted);
          }}
        >
          {muted ? "开启声音" : "静音"}
        </button>
        <button onClick={() => setFull(!full)}>
          {full ? "恢复浮窗" : "全屏"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
};
