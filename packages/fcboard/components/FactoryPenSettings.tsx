import { useId, useRef, useState } from "react";
import ClickAwayListener from "@mui/material/ClickAwayListener";
import Popper from "@mui/material/Popper";

import { DEFAULT_ELEMENT_PROPS } from "@fcboard/common";
import { rainbowInkStops } from "@fcboard/element/rainbowInk";
import { nativeInkPalettes } from "@fcboard/element/nativeInkColor";

import { t, useI18n } from "../i18n";

import { switchWhiteboardPen, switchWhiteboardTip } from "../whiteboardPen";

import { FactoryIcon } from "./FactoryIcon";
import { FactoryColorWheel } from "./FactoryColorWheel";

import type { FcboardImperativeAPI, UIAppState } from "../types";

const penPages = [
  [
    [
      "hard",
      "normal_brush",
      "#334155",
      "M5 19l2-5L17 4l3 3L10 17l-5 2Zm8-11 3 3",
    ],
    [
      "brush",
      "fountain",
      "#6335a7",
      "M12 3 5 14l4 5h6l4-5-7-11Zm0 4v6m-3 6v2h6v-2",
    ],
    [
      "highlighter",
      "highlighter",
      "#a55c00",
      "m5 15 9-11 6 5-9 11-6-5Zm4-4 6 5M6 16l-2 4h6",
    ],
    ["dashed", "dashed_pen", "#316475", "M3 17h4m3-3 4-3m3-3 4-3"],
    [
      "rainbow",
      "rainbow_pen",
      "#9f397a",
      "M3 17a9 9 0 0 1 18 0M6 17a6 6 0 0 1 12 0m-9 0a3 3 0 0 1 6 0",
    ],
    [
      "laser",
      "laser_pen",
      "#b62e35",
      "m4 20 9-9 2 2-9 9-2-2Zm12-14 2-3m-1 6 4-1m-5 4 2 3",
    ],
  ],
  [
    [
      "magic",
      "magic_pen",
      "#7739a8",
      "m4 20 10-10 2 2L6 22l-2-2Zm13-17 1.1 3.9L22 8l-3.9 1.1L17 13l-1.1-3.9L12 8l3.9-1.1L17 3ZM5 5v4M3 7h4",
    ],
    [
      "shape",
      "shape_pen",
      "#13705e",
      "m3 13 5-9 5 9H3Zm12 1h6v6h-6Zm-8 1a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
    ],
    ["text", "text_pen", "#355d96", "M5 8V5h14v3m-7-3v14m-4 0h8"],
    ["function", "function_pen", "#006caa", "M5 3v16h16M7 16c6 0 3-12 14-12"],
    [
      "calculation",
      "calculation_pen",
      "#976200",
      "M6 3h12v18H6zm3 4h6m-6 5h1m4 0h1m-6 5h1m4 0h1",
    ],
    [
      "language",
      "language_pen",
      "#ac4064",
      "M3 4h18v13H11l-5 4v-4H3Zm4 10 3-7 3 7m-5-2h4m4-4h2m-1 0v6",
    ],
  ],
] as const;
const colors = [
  "#f3f3f3",
  "#7b7b7b",
  "#000000",
  "#ff964f",
  "#7fec50",
  "#ff0000",
  "#3b52c8",
  "#eecf00",
  "#15c5c3",
  "#fe09fd",
  "#0b24fe",
];

/** The preview geometry and pressure envelope follow PenPreviewView.java. */
const PenPreview = ({
  state,
  thickness,
}: {
  state: UIAppState;
  thickness: number;
}) => {
  const id = useId();
  const palette =
    state.currentItemInkGradient &&
    nativeInkPalettes[state.currentItemInkGradient];
  const stops = palette
    ? palette.map(
        (color, index) => [index / (palette.length - 1), color] as const,
      )
    : rainbowInkStops;
  const gradient = !!palette || state.currentItemPenMode === "rainbow";
  const width = Math.max(1.5, Math.min(26 * 0.42, thickness * 0.24 + 1.3));
  const left = width / 2 + 2;
  const right = 187 - left;
  const mid = 13;
  const amplitude = 26 * 0.28;
  const d = `M${left + 187 * 0.02},${mid - 0.75 * amplitude} C${187 * 0.18},${
    mid + 1.1 * amplitude
  } ${187 * 0.38},${mid + 0.9 * amplitude} ${187 * 0.55},${
    mid + 0.2 * amplitude
  } C${187 * 0.68},${mid - 0.35 * amplitude} ${187 * 0.78},${
    mid - 0.2 * amplitude
  } ${right - 187 * 0.02},${mid + 0.85 * amplitude}`;
  const cubic = (a: number, b: number, c: number, d: number, t: number) =>
    (1 - t) ** 3 * a +
    3 * (1 - t) ** 2 * t * b +
    3 * (1 - t) * t * t * c +
    t ** 3 * d;
  return (
    <svg
      viewBox="0 0 187 26"
      role="img"
      aria-label={t("fcboard.current_pen_preview")}
      style={{ color: state.currentItemStrokeColor }}
    >
      <defs>
        <linearGradient id={id}>
          {stops.map(([offset, color]) => (
            <stop key={color} offset={offset} stopColor={color} />
          ))}
        </linearGradient>
      </defs>
      {state.currentItemPenMode === "brush" ? (
        <g
          fill={gradient ? `url(#${id})` : "currentColor"}
          opacity={state.currentItemOpacity / 100}
        >
          {Array.from({ length: 45 }, (_, index) => {
            const t = index / 44;
            const pressure =
              t < 0.12
                ? (t / 0.12) * 0.35 + 0.55
                : t > 0.82
                ? Math.max(0.08, (1 - (t - 0.82) / 0.18) * 0.9)
                : 0.9 - t * 0.24;
            const diameter = Math.max(
              1.2,
              pressure * Math.max(4, 1.45 * width),
            );
            return (
              <ellipse
                key={index}
                cx={cubic(
                  left + 187 * 0.03,
                  187 * 0.26,
                  187 * 0.56,
                  right - 187 * 0.03,
                  t,
                )}
                cy={cubic(
                  mid - 0.45 * amplitude,
                  mid + amplitude,
                  mid - 0.35 * amplitude,
                  mid + 0.55 * amplitude,
                  t,
                )}
                rx={diameter / 2}
                ry={diameter / 4}
              />
            );
          })}
        </g>
      ) : (
        <path
          d={d}
          fill="none"
          stroke={gradient ? `url(#${id})` : "currentColor"}
          strokeWidth={width}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={
            (state.currentItemOpacity / 100) *
            (state.currentItemPenMode === "highlighter" ? 110 / 255 : 1)
          }
          strokeDasharray={
            state.currentItemPenMode === "dashed"
              ? `${Math.max(1.6 * width, 8)} ${Math.max(1.8 * width, 10)}`
              : undefined
          }
        />
      )}
    </svg>
  );
};

export const FactoryPenSettings = ({
  app,
  state,
  close,
}: {
  app: {
    api: Pick<FcboardImperativeAPI, "updateScene" | "setActiveTool">;
    props: { UIOptions: { inkProfile?: { penWidthMax?: 20 | 40 } } };
  };
  state: UIAppState;
  close: () => void;
}) => {
  useI18n();
  const base = state.currentItemPenMode === "brush" ? 15 : 4;
  const thickness =
    (state.currentItemStrokeWidth / DEFAULT_ELEMENT_PROPS.strokeWidth) * base;
  const active =
    state.activeTool.type === "laser"
      ? "laser"
      : state.currentItemInkAssist || state.currentItemPenMode || "hard";
  const [page, setPage] = useState(() =>
    penPages[1].some(([mode]) => mode === active) ? 1 : 0,
  );
  const swipe = useRef<{ id: number; x: number; y: number }>(undefined);
  const swiped = useRef(false);
  const [wheel, setWheel] = useState(false);
  const colorButton = useRef<HTMLButtonElement>(null);
  return (
    <div className="fc-factory-pen-settings">
      <div
        className="fc-pen-tip-tabs"
        role="group"
        aria-label={t("fcboard.pen_tip")}
      >
        {(["fine", "thick"] as const).map((tip) => (
          <button
            key={tip}
            type="button"
            aria-pressed={(state.whiteboardPenTip || "thick") === tip}
            onClick={() =>
              app.api.updateScene({
                appState: switchWhiteboardTip(state, tip),
              })
            }
          >
            <FactoryIcon
              name={tip === "fine" ? "penThinHead" : "penThickHead"}
            />
            {t(tip === "fine" ? "fcboard.fine_pen" : "fcboard.thick_pen")}
          </button>
        ))}
      </div>
      <div
        role="group"
        aria-label={t("fcboard.pen_type")}
        className="fc-pen-page"
        onPointerDown={(event) => {
          if (
            (event.pointerType !== "mouse" || event.button === 0) &&
            !swipe.current
          ) {
            swiped.current = false;
            swipe.current = {
              id: event.pointerId,
              x: event.clientX,
              y: event.clientY,
            };
          }
        }}
        onPointerMove={(event) => {
          const start = swipe.current;
          if (!start || start.id !== event.pointerId || swiped.current) {
            return;
          }
          const x = event.clientX - start.x;
          const y = event.clientY - start.y;
          if (Math.abs(x) < 28 || Math.abs(x) <= Math.abs(y)) {
            return;
          }
          swiped.current = true;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setPage(x < 0 ? 1 : 0);
        }}
        onPointerUp={(event) => {
          if (swipe.current?.id === event.pointerId) {
            swipe.current = undefined;
          }
        }}
        onPointerLeave={() => {
          if (!swiped.current) {
            swipe.current = undefined;
          }
        }}
        onPointerCancel={() => {
          swipe.current = undefined;
        }}
        onClickCapture={(event) => {
          if (swiped.current && event.detail !== 0) {
            event.stopPropagation();
          }
        }}
      >
        {penPages[page].map(([mode, label, color, path]) => (
          <button
            key={mode}
            type="button"
            aria-label={t(`fcboard.${label}`)}
            aria-pressed={active === mode}
            title={
              page === 1
                ? t(
                    "fcboard.name_recognized_after_writing_pauses_original_ink_is_kept_until_recognition_finishes",
                    {
                      name: t(`fcboard.${label}`),
                    },
                  )
                : t(`fcboard.${label}`)
            }
            onClick={() => {
              if (mode === "laser") {
                app.api.setActiveTool({ type: "laser" });
                close();
                return;
              }
              if (
                mode === "text" ||
                mode === "shape" ||
                mode === "magic" ||
                mode === "function" ||
                mode === "calculation" ||
                mode === "language"
              ) {
                app.api.updateScene({
                  appState: {
                    ...switchWhiteboardPen(state, "hard"),
                    currentItemInkAssist: mode,
                    multiStroke: false,
                  },
                });
              } else {
                app.api.updateScene({
                  appState: {
                    ...switchWhiteboardPen(state, mode),
                    currentItemInkAssist: undefined,
                  },
                });
              }
              close();
            }}
          >
            <span className="fc-pen-icon" style={{ color }} aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={path} />
              </svg>
            </span>
            <span>{t(`fcboard.${label}`)}</span>
          </button>
        ))}
      </div>
      <div className="fc-pen-page-dots">
        {penPages.map(([first], index) => (
          <button
            key={first[0]}
            type="button"
            aria-label={t("fcboard.page_page", { page: index + 1 })}
            aria-pressed={page === index}
            onClick={() => setPage(index)}
          />
        ))}
      </div>
      <label className="fc-pen-mode">
        <span>{t("fcboard.thickness")}</span>
        <input
          aria-label={t("fcboard.pen_thickness")}
          type="range"
          min="2"
          max={app.props.UIOptions.inkProfile?.penWidthMax ?? 40}
          step="1"
          value={thickness}
          style={
            {
              "--fc-pen-progress": `${
                (100 * (thickness - 2)) /
                ((app.props.UIOptions.inkProfile?.penWidthMax ?? 40) - 2)
              }%`,
            } as React.CSSProperties
          }
          onChange={(event) =>
            app.api.updateScene({
              appState: {
                currentItemStrokeWidth:
                  (Number(event.target.value) / base) *
                  DEFAULT_ELEMENT_PROPS.strokeWidth,
              },
            })
          }
        />
        <output>{Math.round(thickness * 100) / 100}</output>
      </label>
      <div className="fc-pen-heading">{t("fcboard.colour")}</div>
      <div
        className="fc-pen-colors"
        role="group"
        aria-label={t("fcboard.pen_colour")}
      >
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={t("fcboard.pen_colour_color", { color })}
            aria-pressed={
              !state.currentItemInkGradient &&
              state.currentItemStrokeColor.toLowerCase() === color
            }
            onClick={() => {
              app.api.updateScene({
                appState: {
                  currentItemStrokeColor: color,
                  currentItemInkGradient: undefined,
                },
              });
            }}
          >
            <span style={{ background: color }} />
          </button>
        ))}
        {Object.entries(nativeInkPalettes).map(([name, palette]) => {
          const gradient = name as keyof typeof nativeInkPalettes;
          return (
            <button
              key={name}
              type="button"
              aria-label={t("fcboard.pen_colour_color", {
                color: palette.join("_"),
              })}
              aria-pressed={state.currentItemInkGradient === gradient}
              onClick={() =>
                app.api.updateScene({
                  appState: {
                    currentItemStrokeColor: palette[0],
                    currentItemInkGradient: gradient,
                  },
                })
              }
            >
              <span
                style={{
                  background: `linear-gradient(to bottom, ${palette.join(
                    ",",
                  )})`,
                }}
              />
            </button>
          );
        })}
        <ClickAwayListener onClickAway={() => setWheel(false)}>
          <div className="fc-pen-color-picker">
            <button
              ref={colorButton}
              type="button"
              className="fc-pen-custom-color"
              aria-label={t("fcboard.custom_pen_colour")}
              aria-expanded={wheel}
              onClick={() => setWheel(!wheel)}
            />
            <Popper
              open={wheel}
              anchorEl={colorButton.current}
              placement="right-start"
              modifiers={[
                {
                  name: "flip",
                  options: { fallbackPlacements: ["top-end", "left-start"] },
                },
                { name: "preventOverflow", options: { padding: 12 } },
              ]}
              sx={{ zIndex: 1400 }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setWheel(false);
                  colorButton.current?.focus();
                }
              }}
            >
              <FactoryColorWheel
                value={state.currentItemStrokeColor}
                opacity={state.currentItemOpacity}
                onChange={(color) =>
                  app.api.updateScene({
                    appState: {
                      currentItemStrokeColor: color,
                      currentItemInkGradient: undefined,
                    },
                  })
                }
                onOpacityChange={(opacity) =>
                  app.api.updateScene({
                    appState: { currentItemOpacity: opacity },
                  })
                }
              />
            </Popper>
          </div>
        </ClickAwayListener>
      </div>
      <div className="fc-pen-heading">{t("fcboard.preview")}</div>
      <PenPreview state={state} thickness={thickness} />
    </div>
  );
};
