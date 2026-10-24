import { useEffect, useState } from "react";
import Slider from "@mui/material/Slider";
import Switch from "@mui/material/Switch";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { t, useI18n } from "@excalidraw/excalidraw/i18n";
import { factoryBackgrounds } from "@excalidraw/excalidraw/whiteboardBackground";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { SettingsSection } from "./SettingsNavigation";
import { useDeviceInkProfile } from "./ink";

export const BoardSettings = ({ api }: { api: ExcalidrawImperativeAPI }) => {
  useI18n();
  const device = useDeviceInkProfile();
  const [state, setState] = useState(() => api.getAppState());
  useEffect(() => api.onChange(() => setState(api.getAppState())), [api]);
  return (
    <>
      <SettingsSection id="background">
        <>
          <label>
            {t("fcboard.背景")}
            <input
              type="color"
              value={
                /^#[\da-f]{6}$/i.test(state.viewBackgroundColor)
                  ? state.viewBackgroundColor
                  : "#ffffff"
              }
              onChange={(event) =>
                api.executeAction("changeViewBackgroundColor", {
                  viewBackgroundColor: event.target.value,
                })
              }
            />
          </label>
          <div
            className="fc-background-picker"
            role="group"
            aria-label={t("fcboard.背景")}
          >
            <button
              type="button"
              aria-pressed={!state.whiteboardBackground}
              onClick={() =>
                api.updateScene({
                  appState: {
                    whiteboardBackground: undefined,
                    gridModeEnabled: false,
                  },
                  captureUpdate: CaptureUpdateAction.IMMEDIATELY,
                })
              }
            >
              {t("fcboard.无背景图案")}
            </button>
            {factoryBackgrounds.map((url, index) => (
              <button
                type="button"
                key={url}
                aria-label={t("fcboard.背景图案 {{number}}", {
                  number: index + 1,
                })}
                aria-pressed={state.whiteboardBackground?.pattern === index + 1}
                onClick={() =>
                  api.updateScene({
                    appState: {
                      whiteboardBackground: {
                        pattern: index + 1,
                        width: state.width / state.zoom.value,
                        height: state.height / state.zoom.value,
                      },
                      gridModeEnabled: false,
                    },
                    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
                  })
                }
              >
                <img src={url} alt="" />
              </button>
            ))}
          </div>
        </>
      </SettingsSection>
      <SettingsSection id="pen">
        <>
          <label>
            {t("fcboard.粗笔接触阈值（px）")}
            <input
              type="number"
              min="1"
              max="240"
              value={
                state.whiteboardThickThreshold ?? device?.thickThreshold ?? ""
              }
              onChange={(event) => {
                const value = event.target.valueAsNumber;
                if (Number.isFinite(value) && value > 0 && value <= 240) {
                  api.updateScene({
                    appState: { whiteboardThickThreshold: value },
                  });
                }
              }}
            />
          </label>
          <label>
            {t("fcboard.自动识别笔尖")}
            <Switch
              checked={state.whiteboardDualPen ?? device?.dualPen ?? false}
              disabled={
                !(state.whiteboardThickThreshold ?? device?.thickThreshold)
              }
              onChange={(_, value) =>
                api.updateScene({ appState: { whiteboardDualPen: value } })
              }
            />
          </label>
          <label>
            {t("fcboard.笔锋变化率")}
            <Slider
              aria-label={t("fcboard.笔锋变化率")}
              min={0}
              max={50}
              valueLabelDisplay="auto"
              value={state.whiteboardBrushVariation ?? 45}
              onChange={(_, value) =>
                api.updateScene({
                  appState: { whiteboardBrushVariation: value as number },
                })
              }
            />
            <output>{state.whiteboardBrushVariation ?? 45}</output>
          </label>
        </>
      </SettingsSection>
      <SettingsSection id="touch">
        <>
          <label>
            {t("fcboard.手掌 / 手背擦除")}
            <Switch
              checked={state.palmEraser !== false}
              onChange={(_, checked) =>
                api.updateScene({ appState: { palmEraser: checked } })
              }
            />
          </label>
          <label>
            {t("fcboard.手背擦除阈值")}
            <Slider
              aria-label={t("fcboard.手背擦除阈值")}
              min={16}
              max={120}
              valueLabelDisplay="auto"
              value={state.palmEraserThreshold ?? device?.palmThreshold ?? 36}
              onChange={(_, value) =>
                api.updateScene({
                  appState: { palmEraserThreshold: value as number },
                })
              }
            />
            <output>
              {state.palmEraserThreshold ?? device?.palmThreshold ?? 36}px
            </output>
          </label>
        </>
      </SettingsSection>
    </>
  );
};
