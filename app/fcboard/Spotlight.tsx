import { t, useI18n } from "@excalidraw/excalidraw/i18n";
import { useEffect, useRef, useState } from "react";

import { classroomCommands } from "./commands";

/** A board-local spotlight also works on devices without the OEM spotlight app. */
export const Spotlight = () => {
  useI18n();
  const [state, setState] = useState({
    open: false,
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    radius: 150,
  });
  const dragging = useRef<number | undefined>(undefined);
  useEffect(() => {
    const release = classroomCommands.register(
      "tools.spotlight",
      "聚光灯：args.open=true|false，args.x/y 为屏幕坐标，args.radius=48..600；拖动可移动光圈",
      (args) => {
        if (
          (args.open !== undefined && typeof args.open !== "boolean") ||
          ["x", "y", "radius"].some(
            (key) =>
              args[key] !== undefined &&
              (typeof args[key] !== "number" || !Number.isFinite(args[key])),
          ) ||
          (typeof args.radius === "number" &&
            (args.radius < 48 || args.radius > 600))
        ) {
          throw new Error(t("fcboard.聚光灯参数无效"));
        }
        setState((previous) => ({
          open: args.open !== false,
          x: Math.max(
            0,
            Math.min(window.innerWidth, Number(args.x ?? previous.x)),
          ),
          y: Math.max(
            0,
            Math.min(window.innerHeight, Number(args.y ?? previous.y)),
          ),
          radius: Number(args.radius ?? previous.radius),
        }));
      },
    );
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setState((previous) => ({ ...previous, open: false }));
      }
    };
    window.addEventListener("keydown", escape);
    return () => {
      release();
      window.removeEventListener("keydown", escape);
    };
  }, []);
  if (!state.open) {
    return null;
  }
  return (
    <div
      className="fc-spotlight"
      role="region"
      aria-label={t("fcboard.聚光灯")}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        pointerEvents: "auto",
        touchAction: "none",
        background: `radial-gradient(circle ${state.radius}px at ${state.x}px ${state.y}px, transparent 99%, rgba(0,0,0,.78) 100%)`,
      }}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }
        event.stopPropagation();
        dragging.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        setState((previous) => ({
          ...previous,
          x: event.clientX,
          y: event.clientY,
        }));
      }}
      onPointerMove={(event) => {
        if (dragging.current === event.pointerId) {
          event.stopPropagation();
          setState((previous) => ({
            ...previous,
            x: event.clientX,
            y: event.clientY,
          }));
        }
      }}
      onPointerUp={() => {
        dragging.current = undefined;
      }}
      onPointerCancel={() => {
        dragging.current = undefined;
      }}
    >
      <div
        className="fc-surface"
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          display: "flex",
          gap: 12,
          padding: 12,
          alignItems: "center",
        }}
      >
        <input
          aria-label={t("fcboard.光圈大小")}
          type="range"
          min="48"
          max="600"
          value={state.radius}
          onChange={(event) =>
            setState((previous) => ({
              ...previous,
              radius: Number(event.target.value),
            }))
          }
        />
        <button
          onClick={() => setState((previous) => ({ ...previous, open: false }))}
        >
          {t("fcboard.关闭聚光灯")}
        </button>
      </div>
    </div>
  );
};
