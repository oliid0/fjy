import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@fcboard/fcboard/i18n";
import { CloseIcon, palette } from "@fcboard/fcboard/components/icons";

import { MaterialPanel } from "./MaterialPanel";

import { classroomCommands } from "./commands";
import first from "./assets/curtain/mubu01.jpg";
import second from "./assets/curtain/mubu02.jpg";
import third from "./assets/curtain/mubu03.jpg";

const themes = [first, second, third];
// DataTools.bgList and the original colors.xml.
const colors = [
  "#ff0040",
  "#ffa500",
  "#ffffe0",
  "#00ff00",
  "#0101df",
  "#000000",
];
type Bounds = { left: number; top: number; right: number; bottom: number };
type Edge = "left" | "right" | "top" | "bottom" | "move";
/** DragScaleView's four independent edges and bounded center movement. */
export const moveCurtain = (
  rect: Bounds,
  edge: Edge,
  dx: number,
  dy: number,
  width: number,
  height: number,
): Bounds => {
  const minWidth = Math.min(300, width);
  const minHeight = Math.min(300, height);
  if (edge === "move") {
    const x = Math.max(-rect.left, Math.min(width - rect.right, dx));
    const y = Math.max(-rect.top, Math.min(height - rect.bottom, dy));
    return {
      left: rect.left + x,
      right: rect.right + x,
      top: rect.top + y,
      bottom: rect.bottom + y,
    };
  }
  return {
    ...rect,
    left:
      edge === "left"
        ? Math.max(0, Math.min(rect.right - minWidth, rect.left + dx))
        : rect.left,
    right:
      edge === "right"
        ? Math.min(width, Math.max(rect.left + minWidth, rect.right + dx))
        : rect.right,
    top:
      edge === "top"
        ? Math.max(0, Math.min(rect.bottom - minHeight, rect.top + dy))
        : rect.top,
    bottom:
      edge === "bottom"
        ? Math.min(height, Math.max(rect.top + minHeight, rect.bottom + dy))
        : rect.bottom,
  };
};
export const Curtain = () => {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(0);
  const [color, setColor] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [controls, setControls] = useState(true);
  const hideControls = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const reveal = useCallback(() => {
    setControls(true);
    clearTimeout(hideControls.current);
    if (!settings) {
      hideControls.current = setTimeout(() => setControls(false), 3000);
    }
  }, [settings]);
  useEffect(() => {
    if (open) {
      reveal();
    }
    return () => clearTimeout(hideControls.current);
  }, [open, reveal]);
  const [tab, setTab] = useState<"color" | "theme">("color");
  const [rect, setRect] = useState<Bounds>({
    left: 0,
    top: 0,
    right: innerWidth,
    bottom: innerHeight,
  });
  const current = useRef(rect);
  current.current = rect;
  const drag = useRef<
    { id: number; edge: Edge; x: number; y: number; rect: Bounds } | undefined
  >(undefined);
  const frame = useRef(0);
  useEffect(() => {
    const stop = classroomCommands.register(
      "tools.curtain",
      "Built-in curtain. args.open=false closes; args.theme=0|1|2 or args.color=#RRGGBB; args.reset=true covers viewport. Drag center to move, four edge controls uncover board independently.",
      (args) => {
        if (
          (args.open !== undefined && typeof args.open !== "boolean") ||
          (args.theme !== undefined &&
            ![0, 1, 2].includes(Number(args.theme))) ||
          (args.color !== undefined &&
            (typeof args.color !== "string" ||
              !/^#[0-9a-f]{6}$/i.test(args.color)))
        ) {
          throw new Error(t("fcboard.invalid_style_parameters"));
        }
        if (args.theme !== undefined) {
          setTheme(Number(args.theme));
          setColor(null);
        }
        if (typeof args.color === "string") {
          setColor(args.color);
        }
        setSettings(false);
        if (args.reset === true) {
          setRect({ left: 0, top: 0, right: innerWidth, bottom: innerHeight });
        }
        setOpen(args.open !== false);
        return { open: args.open !== false };
      },
    );
    const resize = () => {
      drag.current = undefined;
      cancelAnimationFrame(frame.current);
      setRect((r) => ({
        left: Math.max(
          0,
          Math.min(r.left, innerWidth - Math.min(300, innerWidth)),
        ),
        top: Math.max(
          0,
          Math.min(r.top, innerHeight - Math.min(300, innerHeight)),
        ),
        right: Math.min(
          innerWidth,
          Math.max(r.right, Math.min(300, innerWidth)),
        ),
        bottom: Math.min(
          innerHeight,
          Math.max(r.bottom, Math.min(300, innerHeight)),
        ),
      }));
    };
    const key = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !(
          event.target instanceof Element &&
          event.target.closest(".fc-curtain-settings")
        )
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("resize", resize);
    window.addEventListener("keydown", key);
    return () => {
      stop();
      cancelAnimationFrame(frame.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", key);
    };
  }, []);
  const release = () => {
    drag.current = undefined;
    cancelAnimationFrame(frame.current);
  };
  return open ? (
    <>
      <section
        className="fc-curtain"
        aria-label={t("fcboard.curtain")}
        data-controls={controls}
        onPointerDownCapture={reveal}
        onKeyDownCapture={reveal}
        style={{
          left: rect.left,
          top: rect.top,
          width: rect.right - rect.left,
          height: rect.bottom - rect.top,
          backgroundImage: color ? "none" : `url(${themes[theme]})`,
          backgroundColor: color || undefined,
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (start?.id !== event.pointerId) {
            return;
          }
          const next = moveCurtain(
            start.rect,
            start.edge,
            event.clientX - start.x,
            event.clientY - start.y,
            innerWidth,
            innerHeight,
          );
          current.current = next;
          cancelAnimationFrame(frame.current);
          frame.current = requestAnimationFrame(() => setRect(next));
        }}
        onPointerUp={() => {
          if (drag.current) {
            setRect(current.current);
          }
          release();
        }}
        onPointerCancel={release}
        onLostPointerCapture={release}
      >
        {(["left", "right", "top", "bottom", "move"] as const).map((edge) => (
          <button
            type="button"
            key={edge}
            className={`fc-curtain-${edge}`}
            aria-label={t(`fcboard.curtain_${edge}`)}
            onPointerDown={(event) => {
              event.stopPropagation();
              drag.current = {
                id: event.pointerId,
                edge,
                x: event.clientX,
                y: event.clientY,
                rect,
              };
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onKeyDown={(event) => {
              const dx =
                event.key === "ArrowLeft"
                  ? -20
                  : event.key === "ArrowRight"
                  ? 20
                  : 0;
              const dy =
                event.key === "ArrowUp"
                  ? -20
                  : event.key === "ArrowDown"
                  ? 20
                  : 0;
              if (dx || dy) {
                event.preventDefault();
                setRect((r) =>
                  moveCurtain(r, edge, dx, dy, innerWidth, innerHeight),
                );
              }
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path
                d={
                  edge === "move"
                    ? "M3 12h18M12 3v18M3 12l4-4M3 12l4 4M21 12l-4-4M21 12l-4 4M12 3l-4 4M12 3l4 4M12 21l-4-4M12 21l4-4"
                    : ["left", "right"].includes(edge)
                    ? "M3 12h18M3 12l5-5M3 12l5 5M21 12l-5-5M21 12l-5 5"
                    : "M12 3v18M12 3l-5 5M12 3l5 5M12 21l-5-5M12 21l5-5"
                }
              />
            </svg>
          </button>
        ))}
        <div className="fc-curtain-actions">
          <button
            type="button"
            onClick={() => setSettings(true)}
            aria-label={t("fcboard.curtain_theme")}
          >
            {palette}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("buttons.close")}
          >
            {CloseIcon}
          </button>
        </div>
      </section>
      {settings && (
        <MaterialPanel
          centered
          role="dialog"
          aria-label={t("fcboard.curtain_theme")}
          className="fc-curtain-settings"
          onDismiss={() => setSettings(false)}
        >
          <header>
            <div role="tablist" aria-label={t("fcboard.curtain_theme")}>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "color"}
                onClick={() => setTab("color")}
              >
                {t("fcboard.colour")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "theme"}
                onClick={() => setTab("theme")}
              >
                {t("fcboard.background")}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setSettings(false)}
              aria-label={t("buttons.close")}
            >
              {CloseIcon}
            </button>
          </header>
          <div
            className="fc-curtain-gallery"
            role="group"
            aria-label={t(
              tab === "color" ? "fcboard.colour" : "fcboard.background",
            )}
          >
            {tab === "color"
              ? colors.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-label={value}
                    aria-pressed={color === value}
                    style={{ background: value }}
                    onClick={() => setColor(value)}
                  />
                ))
              : themes.map((image, index) => (
                  <button
                    key={image}
                    type="button"
                    aria-label={`${t("fcboard.curtain_theme")} ${index + 1}`}
                    aria-pressed={color === null && theme === index}
                    onClick={() => {
                      setColor(null);
                      setTheme(index);
                    }}
                  >
                    <img src={image} alt="" />
                  </button>
                ))}
          </div>
        </MaterialPanel>
      )}
    </>
  ) : null;
};
