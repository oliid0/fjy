import { useEffect, useRef, useState } from "react";
import Button from "@mui/material/Button";
import Slider from "@mui/material/Slider";
import Switch from "@mui/material/Switch";
import ClickAwayListener from "@mui/material/ClickAwayListener";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { t, useI18n } from "@excalidraw/excalidraw/i18n";
import { factoryBackgrounds } from "@excalidraw/excalidraw/whiteboardBackground";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { classroomCommands } from "./commands";
import { useAnchoredPanel } from "./floating";
import { MaterialPanel } from "./MaterialPanel";
import { useDeviceInkProfile } from "./ink";

export const BoardSettings = ({ api }: { api: ExcalidrawImperativeAPI }) => {
  useI18n();
  const device = useDeviceInkProfile();
  const [page, setPage] = useState<
    "home" | "background" | "pen" | "touch" | null
  >(null);
  const [state, setState] = useState(() => api.getAppState());
  const panel = useRef<HTMLElement>(null);
  const style = useAnchoredPanel(
    panel,
    '[data-testid="main-menu-trigger"]',
    !!page,
  );
  useEffect(() => {
    const release = classroomCommands.register(
      "board.settings",
      "打开原白板设置：背景图案、笔锋变化率和触控阈值",
      () => {
        setState(api.getAppState());
        setPage("home");
      },
    );
    const invalidate = classroomCommands.onInvalidate(() => setPage(null));
    return () => {
      release();
      invalidate();
    };
  }, [api]);
  useEffect(
    () => (page ? api.onChange(() => setState(api.getAppState())) : undefined),
    [api, page],
  );
  if (!page) {
    return null;
  }
  return (
    <ClickAwayListener onClickAway={() => setPage(null)}>
      <MaterialPanel
        ref={panel}
        className="fc-board-settings fc-surface"
        style={style}
        role="dialog"
        aria-label={t("fcboard.白板设置")}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            setPage(null);
          }
        }}
      >
        <header>
          <strong>
            {t(
              page === "background"
                ? "fcboard.背景"
                : page === "pen"
                ? "fcboard.画笔"
                : page === "touch"
                ? "fcboard.触控与橡皮设置"
                : "fcboard.白板设置",
            )}
          </strong>
          <Button onClick={() => setPage(null)} aria-label={t("buttons.close")}>
            ×
          </Button>
        </header>
        {page !== "home" && (
          <Button onClick={() => setPage("home")}>
            {t("fcboard.返回设置")}
          </Button>
        )}
        {page === "home" && (
          <div className="fc-settings-links">
            <Button onClick={() => setPage("background")}>
              {t("fcboard.背景")} ›
            </Button>
            <Button onClick={() => setPage("pen")}>
              {t("fcboard.画笔")} ›
            </Button>
            <Button onClick={() => setPage("touch")}>
              {t("fcboard.触控与橡皮设置")} ›
            </Button>
            <Button
              onClick={() => {
                setPage(null);
                void classroomCommands.execute({
                  name: "panel.open",
                  args: { panel: "settings" },
                });
              }}
            >
              {t("fcboard.AI 与语音设置")} ›
            </Button>
          </div>
        )}
        {page === "background" && (
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
                  api.updateScene({
                    appState: { viewBackgroundColor: event.target.value },
                    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
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
                  key={url}
                  aria-label={t("fcboard.背景图案 {{number}}", {
                    number: index + 1,
                  })}
                  aria-pressed={
                    state.whiteboardBackground?.pattern === index + 1
                  }
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
        )}
        {page === "pen" && (
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
        )}
        {page === "touch" && (
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
        )}
      </MaterialPanel>
    </ClickAwayListener>
  );
};
