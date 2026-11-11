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

// menu_pen_select.xml icons and spacing, extended to the requested 12 pens.
const pens = [
  ["hard", "normal_brush", "penCommonBody", "penNormalNib"],
  ["brush", "fountain", "penCommonBody", "penInkNib"],
  ["highlighter", "highlighter", "penCommonBody", "penMarkerNib"],
  ["text", "text_pen", "penTextBody", "penNormalNib"],
  ["shape", "shape_pen", "penShapeBody", "penNormalNib"],
  ["laser", "laser_pen", "penLaserBody", "penLaserNib"],
  ["magic", "magic_pen", "penMagicBody", "penMagicNib"],
  ["dashed", "dashed_pen", "penCommonBody", "penNormalNib"],
  ["rainbow", "rainbow_pen", "penCommonBody", "penNormalNib"],
  ["function", "function_pen", "penShapeBody", "penNormalNib"],
  ["calculation", "calculation_pen", "penTextBody", "penNormalNib"],
  ["language", "language_pen", "penTextBody", "penNormalNib"],
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
    state.currentItemInkAssist || state.currentItemPenMode || "hard";
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
        className="fc-pen-types"
      >
        {pens.map(([mode, label, body, nib]) => (
          <button
            key={mode}
            type="button"
            aria-label={t(`fcboard.${label}`)}
            aria-pressed={active === mode}
            title={
              [
                "text",
                "shape",
                "magic",
                "function",
                "calculation",
                "language",
              ].includes(mode)
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
            }}
          >
            <span
              className="fc-native-pen-graphic"
              style={{ color: state.currentItemStrokeColor }}
            >
              <FactoryIcon name={nib} gradient={state.currentItemInkGradient} />
              <FactoryIcon name={body} />
            </span>
            <span>{t(`fcboard.${label}`)}</span>
          </button>
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
