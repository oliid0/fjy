import { useId } from "react";

import { DEFAULT_ELEMENT_PROPS } from "@excalidraw/common";
import { rainbowInkStops } from "@excalidraw/element/rainbowInk";

import { t, useI18n } from "../i18n";

import { switchWhiteboardPen, switchWhiteboardTip } from "../whiteboardPen";

import hard from "./factory-pen-icons/hard.svg?url";
import hardSelected from "./factory-pen-icons/hard-selected.svg?url";
import brush from "./factory-pen-icons/brush.svg?url";
import brushSelected from "./factory-pen-icons/brush-selected.svg?url";
import highlighter from "./factory-pen-icons/highlighter.svg?url";
import highlighterSelected from "./factory-pen-icons/highlighter-selected.svg?url";
import dashed from "./factory-pen-icons/dashed.svg?url";
import dashedSelected from "./factory-pen-icons/dashed-selected.svg?url";
import text from "./factory-pen-icons/text.svg?url";
import textSelected from "./factory-pen-icons/text-selected.svg?url";
import shape from "./factory-pen-icons/shape.svg?url";
import shapeSelected from "./factory-pen-icons/shape-selected.svg?url";
import magic from "./factory-pen-icons/magic.svg?url";
import magicSelected from "./factory-pen-icons/magic-selected.svg?url";
import rainbow from "./factory-pen-icons/rainbow.svg?url";
import rainbowSelected from "./factory-pen-icons/rainbow-selected.svg?url";

import type { ExcalidrawImperativeAPI, UIAppState } from "../types";

const pens = [
  ["hard", "画笔", hard, hardSelected],
  ["brush", "钢笔", brush, brushSelected],
  ["highlighter", "荧光笔", highlighter, highlighterSelected],
  ["dashed", "虚线笔", dashed, dashedSelected],
  ["text", "文字笔", text, textSelected],
  ["shape", "图形笔", shape, shapeSelected],
  ["magic", "魔术笔", magic, magicSelected],
  ["rainbow", "彩虹笔", rainbow, rainbowSelected],
  ["function", "函数笔", shape, shapeSelected],
  ["calculation", "算式笔", text, textSelected],
] as const;
const colors = [
  "#000000",
  "#ffffff",
  "#ff0000",
  "#ffff00",
  "#00ff00",
  "#ff8e45",
  "#62fdff",
  "#0c00ff",
  "#e100ff",
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
      aria-label={t("fcboard.当前画笔预览")}
      style={{ color: state.currentItemStrokeColor }}
    >
      <defs>
        <linearGradient id={id}>
          {rainbowInkStops.map(([offset, color]) => (
            <stop key={color} offset={offset} stopColor={color} />
          ))}
        </linearGradient>
      </defs>
      {state.currentItemPenMode === "brush" ? (
        <g fill="currentColor">
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
          stroke={
            state.currentItemPenMode === "rainbow"
              ? `url(#${id})`
              : "currentColor"
          }
          strokeWidth={width}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={state.currentItemPenMode === "highlighter" ? 110 / 255 : 1}
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
    api: Pick<ExcalidrawImperativeAPI, "updateScene">;
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
  return (
    <div className="fc-factory-pen-settings">
      <div
        className="fc-pen-tip-tabs"
        role="group"
        aria-label={t("fcboard.笔尖")}
      >
        {(["fine", "thick"] as const).map((tip) => (
          <button
            key={tip}
            type="button"
            aria-pressed={(state.whiteboardPenTip || "fine") === tip}
            onClick={() =>
              app.api.updateScene({ appState: switchWhiteboardTip(state, tip) })
            }
          >
            {t(tip === "fine" ? "fcboard.细笔" : "fcboard.粗笔")}
          </button>
        ))}
      </div>
      <div className="fc-pen-heading">{t("fcboard.画笔")}</div>
      <div role="group" aria-label={t("fcboard.笔型")} className="fc-pen-types">
        {pens.map(([mode, label, normal, selected]) => (
          <button
            key={mode}
            type="button"
            aria-label={t(`fcboard.${label}`)}
            aria-pressed={active === mode}
            title={
              ["text", "shape", "magic", "function", "calculation"].includes(
                mode,
              )
                ? t("fcboard.{{name}}：停笔后识别，原笔迹在识别完成前保留", {
                    name: t(`fcboard.${label}`),
                  })
                : t(`fcboard.${label}`)
            }
            onClick={() => {
              if (
                mode === "text" ||
                mode === "shape" ||
                mode === "magic" ||
                mode === "function" ||
                mode === "calculation"
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
              close();
            }}
          >
            <img src={active === mode ? selected : normal} alt="" />
            <span>{t(`fcboard.${label}`)}</span>
          </button>
        ))}
      </div>
      <label className="fc-pen-mode">
        <span>{t("fcboard.粗细")}</span>
        <input
          aria-label={t("fcboard.书写粗细")}
          type="range"
          min="2"
          max={app.props.UIOptions.inkProfile?.penWidthMax ?? 40}
          step="1"
          value={thickness}
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
      <div className="fc-pen-heading">{t("fcboard.颜色")}</div>
      <div
        className="fc-pen-colors"
        role="group"
        aria-label={t("fcboard.画笔颜色")}
      >
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={t("fcboard.画笔颜色 {{color}}", { color })}
            aria-pressed={state.currentItemStrokeColor.toLowerCase() === color}
            onClick={() => {
              app.api.updateScene({
                appState: { currentItemStrokeColor: color },
              });
              close();
            }}
          >
            <span style={{ background: color }} />
          </button>
        ))}
        <label title={t("fcboard.自定义颜色")} className="fc-pen-custom-color">
          <input
            type="color"
            aria-label={t("fcboard.自定义画笔颜色")}
            value={state.currentItemStrokeColor}
            onChange={(event) =>
              app.api.updateScene({
                appState: { currentItemStrokeColor: event.target.value },
              })
            }
          />
        </label>
      </div>
      <div className="fc-pen-heading">{t("fcboard.预览")}</div>
      <PenPreview state={state} thickness={thickness} />
    </div>
  );
};
