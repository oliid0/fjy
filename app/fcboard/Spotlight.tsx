import { t, useI18n } from "@excalidraw/excalidraw/i18n";
import { useEffect, useRef, useState } from "react";
import {
  CloseIcon,
  fullscreenIcon,
  palette,
} from "@excalidraw/excalidraw/components/icons";

import { classroomCommands } from "./commands";

import "./Spotlight.scss";

/** A board-local spotlight also works on devices without the OEM spotlight app. */
export const Spotlight = () => {
  useI18n();
  const [state, setState] = useState({
    open: false,
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    radius: Math.max(
      48,
      Math.min(600, Math.min(window.innerWidth, window.innerHeight) * 0.32),
    ),
  });
  const [maskColor, setMaskColor] = useState("#000000");
  const dragging = useRef<{ id: number; resize: boolean } | undefined>(
    undefined,
  );
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
          throw new Error(t("fcboard.invalid_spotlight_parameters"));
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
    const cancel = () => {
      dragging.current = undefined;
    };
    const resize = () =>
      setState((previous) => ({
        ...previous,
        x: Math.min(window.innerWidth, previous.x),
        y: Math.min(window.innerHeight, previous.y),
      }));
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", resize);
    return () => {
      release();
      window.removeEventListener("keydown", escape);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", resize);
    };
  }, []);
  if (!state.open) {
    return null;
  }
  return (
    <div
      className="fc-spotlight"
      role="region"
      aria-label={t("fcboard.spotlight")}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        pointerEvents: "auto",
        touchAction: "none",
        background: `radial-gradient(circle ${state.radius}px at ${state.x}px ${state.y}px, transparent 99.5%, ${maskColor}c7 100%)`,
      }}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }
        event.stopPropagation();
        dragging.current = { id: event.pointerId, resize: false };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setState((previous) => ({
          ...previous,
          x: event.clientX,
          y: event.clientY,
        }));
      }}
      onPointerMove={(event) => {
        if (dragging.current?.id === event.pointerId) {
          event.stopPropagation();
          const resize = dragging.current.resize;
          setState((previous) =>
            resize
              ? {
                  ...previous,
                  radius: Math.max(
                    48,
                    Math.min(
                      600,
                      Math.hypot(
                        event.clientX - previous.x,
                        event.clientY - previous.y,
                      ),
                    ),
                  ),
                }
              : {
                  ...previous,
                  x: Math.max(0, Math.min(window.innerWidth, event.clientX)),
                  y: Math.max(0, Math.min(window.innerHeight, event.clientY)),
                },
          );
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
      <div
        className="fc-spotlight-ring"
        style={{
          left: state.x - state.radius,
          top: state.y - state.radius,
          width: state.radius * 2,
          height: state.radius * 2,
        }}
      />
      <div
        className="fc-spotlight-controls"
        style={{
          left: Math.max(
            12,
            Math.min(window.innerWidth - 60, state.x + state.radius + 16),
          ),
          top: Math.max(12, Math.min(window.innerHeight - 132, state.y)),
        }}
      >
        <label className="fc-spotlight-color" title={t("fcboard.colour")}>
          {palette}
          <input
            type="color"
            aria-label={t("fcboard.colour")}
            value={maskColor}
            onChange={(event) => setMaskColor(event.target.value)}
          />
        </label>
        <button
          aria-label={t("fcboard.close_spotlight")}
          onClick={() => setState((previous) => ({ ...previous, open: false }))}
        >
          {CloseIcon}
        </button>
      </div>
      <button
        className="fc-spotlight-resize"
        role="slider"
        aria-label={t("fcboard.spotlight_size")}
        aria-valuemin={48}
        aria-valuemax={600}
        aria-valuenow={Math.round(state.radius)}
        style={{
          left: Math.max(
            8,
            Math.min(
              window.innerWidth - 52,
              state.x + state.radius * Math.SQRT1_2 - 22,
            ),
          ),
          top: Math.max(
            8,
            Math.min(
              window.innerHeight - 52,
              state.y + state.radius * Math.SQRT1_2 - 22,
            ),
          ),
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
          dragging.current = { id: event.pointerId, resize: true };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onKeyDown={(event) => {
          if (
            [
              "ArrowUp",
              "ArrowRight",
              "ArrowDown",
              "ArrowLeft",
              "Home",
              "End",
            ].includes(event.key)
          ) {
            event.preventDefault();
            setState((previous) => ({
              ...previous,
              radius:
                event.key === "Home"
                  ? 48
                  : event.key === "End"
                  ? 600
                  : Math.max(
                      48,
                      Math.min(
                        600,
                        previous.radius +
                          (["ArrowUp", "ArrowRight"].includes(event.key)
                            ? 12
                            : -12),
                      ),
                    ),
            }));
          }
        }}
      >
        {fullscreenIcon}
      </button>
    </div>
  );
};
