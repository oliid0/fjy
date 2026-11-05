import { t, useI18n } from "@fcboard/fcboard/i18n";
import { useEffect, useId, useRef, useState } from "react";
import {
  CloseIcon,
  fullscreenIcon,
  palette,
} from "@fcboard/fcboard/components/icons";

import { classroomCommands } from "./commands";

import "./Spotlight.scss";

/** A board-local spotlight also works on devices without the OEM spotlight app. */
export const Spotlight = () => {
  useI18n();
  const maskId = useId();
  const shapes = { circle: "○", rectangle: "□", triangle: "△", star: "☆" };
  const [shape, setShape] = useState<keyof typeof shapes>("circle");
  const [popup, setPopup] = useState<"shape" | "settings" | null>(null);
  const [alpha, setAlpha] = useState(0);
  const [state, setState] = useState({
    open: false,
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    radius: Math.max(
      48,
      Math.min(
        600,
        window.innerHeight / (window.innerWidth >= window.innerHeight ? 4 : 5),
      ),
    ),
  });
  const [maskColor, setMaskColor] = useState("#000000");
  const dragging = useRef<
    | {
        id: number;
        resize: boolean;
        x: number;
        y: number;
        state: typeof state;
      }
    | undefined
  >(undefined);
  const frame = useRef(0);
  const pending = useRef<typeof state | undefined>(undefined);
  const flush = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    if (pending.current) {
      setState(pending.current);
      pending.current = undefined;
    }
    dragging.current = undefined;
  };
  useEffect(() => {
    const release = classroomCommands.register(
      "tools.spotlight",
      "聚光灯：args.open=true|false，args.x/y 为屏幕坐标，args.radius=48..600，args.shape=circle|rectangle|triangle|star，args.color=#RRGGBB，args.alpha=0..255（光圈内白色遮罩）；从光圈内按住拖动",
      (args) => {
        if (
          (args.shape !== undefined &&
            !["circle", "rectangle", "triangle", "star"].includes(
              String(args.shape),
            )) ||
          (args.open !== undefined && typeof args.open !== "boolean") ||
          (args.color !== undefined &&
            (typeof args.color !== "string" ||
              !/^#[0-9a-f]{6}$/i.test(args.color))) ||
          (args.alpha !== undefined &&
            (typeof args.alpha !== "number" ||
              !Number.isInteger(args.alpha) ||
              args.alpha < 0 ||
              args.alpha > 255)) ||
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
        if (typeof args.shape === "string") {
          setShape(args.shape as keyof typeof shapes);
        }
        cancelAnimationFrame(frame.current);
        frame.current = 0;
        pending.current = undefined;
        dragging.current = undefined;
        setPopup(null);
        if (typeof args.color === "string") {
          setMaskColor(args.color);
        }
        if (typeof args.alpha === "number") {
          setAlpha(args.alpha);
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
        cancel();
        setPopup(null);
        setState((previous) => ({ ...previous, open: false }));
      }
    };
    const cancel = () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      pending.current = undefined;
      dragging.current = undefined;
    };
    const resize = () => {
      cancel();
      setState((previous) => ({
        ...previous,
        x: Math.min(window.innerWidth, previous.x),
        y: Math.min(window.innerHeight, previous.y),
      }));
    };
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", resize);
    return () => {
      release();
      cancel();
      window.removeEventListener("keydown", escape);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", resize);
    };
  }, []);
  if (!state.open) {
    return null;
  }
  const controlsX = Math.max(
    12,
    Math.min(window.innerWidth - 60, state.x + state.radius + 16),
  );
  const controlsY = Math.max(12, Math.min(window.innerHeight - 210, state.y));
  const popupWidth = Math.min(280, window.innerWidth - 24);
  const aperture =
    shape === "circle" ? (
      <circle r="1" />
    ) : shape === "rectangle" ? (
      <rect x="-1" y="-1" width="2" height="2" />
    ) : (
      <polygon
        points={
          shape === "triangle"
            ? "0,-1 1,1 -1,1"
            : Array.from({ length: 10 }, (_, i) => {
                const radius = i % 2 ? 0.382 : 1;
                const angle = (i * Math.PI) / 5 - Math.PI / 2;
                return `${Math.cos(angle) * radius},${
                  Math.sin(angle) * radius
                }`;
              }).join(" ")
        }
      />
    );
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
      }}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }
        event.stopPropagation();
        setPopup(null);
        // MarkSizeView only moves an existing mark when the press starts inside it.
        if (
          dragging.current ||
          Math.abs(event.clientX - state.x) > state.radius ||
          Math.abs(event.clientY - state.y) > state.radius
        ) {
          return;
        }
        dragging.current = {
          id: event.pointerId,
          resize: false,
          x: event.clientX,
          y: event.clientY,
          state,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = dragging.current;
        if (start?.id !== event.pointerId) {
          return;
        }
        event.stopPropagation();
        pending.current = start.resize
          ? {
              ...start.state,
              radius: Math.max(
                48,
                Math.min(
                  600,
                  Math.hypot(
                    event.clientX - start.state.x,
                    event.clientY - start.state.y,
                  ),
                ),
              ),
            }
          : {
              ...start.state,
              x: Math.max(
                0,
                Math.min(
                  window.innerWidth,
                  start.state.x + event.clientX - start.x,
                ),
              ),
              y: Math.max(
                0,
                Math.min(
                  window.innerHeight,
                  start.state.y + event.clientY - start.y,
                ),
              ),
            };
        if (!frame.current) {
          frame.current = requestAnimationFrame(() => {
            frame.current = 0;
            if (pending.current) {
              setState(pending.current);
              pending.current = undefined;
            }
          });
        }
      }}
      onPointerUp={(event) => {
        if (dragging.current?.id === event.pointerId) {
          flush();
        }
      }}
      onPointerCancel={(event) => {
        if (dragging.current?.id === event.pointerId) {
          flush();
        }
      }}
      onLostPointerCapture={(event) => {
        if (dragging.current?.id === event.pointerId) {
          flush();
        }
      }}
    >
      <svg
        aria-hidden="true"
        width="100%"
        height="100%"
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      >
        <defs>
          <mask id={maskId}>
            <rect width="100%" height="100%" fill="white" />
            <g
              transform={`translate(${state.x} ${state.y}) scale(${state.radius})`}
              fill="black"
            >
              {aperture}
            </g>
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill={maskColor}
          mask={`url(#${maskId})`}
        />
        <g
          transform={`translate(${state.x} ${state.y}) scale(${state.radius})`}
          fill="white"
          fillOpacity={alpha / 255}
          stroke="#9f9f9f"
          strokeWidth={5 / state.radius}
        >
          {aperture}
        </g>
      </svg>
      <div
        className="fc-spotlight-ring"
        style={{
          left: state.x - state.radius,
          top: state.y - state.radius,
          width: state.radius * 2,
          height: state.radius * 2,
          border: "none",
        }}
      />
      <div
        className="fc-spotlight-controls"
        style={{
          left: controlsX,
          top: controlsY,
        }}
      >
        <button
          type="button"
          aria-label={t("fcboard.spotlight_shape")}
          aria-expanded={popup === "shape"}
          onClick={() => setPopup(popup === "shape" ? null : "shape")}
        >
          {shapes[shape]}
        </button>
        <button
          type="button"
          aria-label={t("fcboard.settings")}
          aria-expanded={popup === "settings"}
          onClick={() => setPopup(popup === "settings" ? null : "settings")}
        >
          {palette}
        </button>
        {popup && (
          <div
            className="fc-spotlight-popup"
            data-shapes={popup === "shape"}
            style={{
              width: popupWidth,
              left: Math.max(
                12,
                Math.min(
                  window.innerWidth - popupWidth - 12,
                  controlsX - popupWidth - 12 >= 12
                    ? controlsX - popupWidth - 12
                    : controlsX + 72,
                ),
              ),
              top: Math.max(12, Math.min(window.innerHeight - 210, controlsY)),
            }}
            role="group"
            aria-label={t(
              popup === "shape"
                ? "fcboard.spotlight_shape"
                : "fcboard.settings",
            )}
          >
            {popup === "shape" ? (
              (Object.keys(shapes) as (keyof typeof shapes)[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={shape === value}
                  onClick={() => {
                    setShape(value);
                    setPopup(null);
                  }}
                >
                  {shapes[value]}
                </button>
              ))
            ) : (
              <>
                <div className="fc-spotlight-swatches">
                  {["#000000", "#ff0000", "#00a1ea"].map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={color}
                      aria-pressed={maskColor.toLowerCase() === color}
                      style={{ background: color }}
                      onClick={() => setMaskColor(color)}
                    />
                  ))}
                  <label
                    className="fc-spotlight-color"
                    title={t("fcboard.colour")}
                  >
                    {palette}
                    <input
                      type="color"
                      aria-label={t("fcboard.colour")}
                      value={maskColor}
                      onChange={(event) => setMaskColor(event.target.value)}
                    />
                  </label>
                </div>
                <label className="fc-spotlight-alpha">
                  {t("labels.opacity")}
                  <input
                    type="range"
                    min={0}
                    max={255}
                    value={alpha}
                    onChange={(event) => setAlpha(Number(event.target.value))}
                  />
                </label>
              </>
            )}
          </div>
        )}
        <button
          aria-label={t("fcboard.close_spotlight")}
          onClick={() => {
            flush();
            setState((previous) => ({ ...previous, open: false }));
          }}
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
          if (dragging.current) {
            return;
          }
          setPopup(null);
          dragging.current = {
            id: event.pointerId,
            resize: true,
            x: event.clientX,
            y: event.clientY,
            state,
          };
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
