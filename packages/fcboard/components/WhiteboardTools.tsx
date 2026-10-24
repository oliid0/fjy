import React from "react";
import Popper from "@mui/material/Popper";
import Paper from "@mui/material/Paper";
import ClickAwayListener from "@mui/material/ClickAwayListener";

import { CaptureUpdateAction } from "@excalidraw/element";

import { t, useI18n } from "../i18n";

import { useUIAppState } from "../context/ui-appState";
import { useTunnels } from "../context/tunnels";

import { useExcalidrawContainer } from "./App";
import { ToolButton } from "./ToolButton";
import { FactoryIcon } from "./FactoryIcon";
import cleaningIcon from "./FactoryCleaning.svg?url";
import { SHAPES } from "./shapes";

import type { ShapesSwitcher } from "./Actions";

/** Compact APK toolbar; all original insertion tools remain in the insertion popover. */
export const WhiteboardTools = ({
  app,
  activeTool,
  onProperties,
  children: _children,
  ...props
}: React.ComponentProps<typeof ShapesSwitcher> & {
  children?: React.ReactNode;
}) => {
  useI18n();
  const [open, setOpen] = React.useState(false);
  const [eraserOpen, setEraserOpen] = React.useState(false);
  const [clearProgress, setClearProgress] = React.useState(0);
  const [popupGap, setPopupGap] = React.useState(16);
  const [eraserAnchor, setEraserAnchor] = React.useState<HTMLElement | null>(
    null,
  );
  const [insertAnchor, setInsertAnchor] = React.useState<HTMLElement | null>(
    null,
  );
  const updateGap = (anchor: HTMLElement) =>
    setPopupGap((16 * anchor.getBoundingClientRect().height) / 48);
  const state = useUIAppState();
  const tunnels = useTunnels();
  const [shapesOpen, setShapesOpen] = React.useState(false);
  const { container } = useExcalidrawContainer();
  const finishClear = (value: number) => {
    setClearProgress(0);
    if (value < 98) {
      return;
    }
    app.api.updateScene({
      elements: [],
      appState: { selectedElementIds: {} },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    app.setActiveTool({ type: "freedraw" });
    setEraserOpen(false);
  };
  React.useEffect(
    () =>
      app.onPointerDownEmitter.on(() => {
        setOpen(false);
        setEraserOpen(false);
      }),
    [app],
  );
  React.useEffect(() => {
    setOpen(false);
    setShapesOpen(false);
    if (activeTool.type !== "eraser" || state.toolbarHidden) {
      setEraserOpen(false);
    }
  }, [activeTool.type, state.toolbarHidden]);
  return (
    <>
      <ToolButton
        type="button"
        className="fc-board-tool"
        icon={<FactoryIcon name="pen" />}
        aria-label={t("fcboard.画笔")}
        showAriaLabel
        selected={activeTool.type === "freedraw"}
        onLongPress={(anchor) => {
          app.setActiveTool({ type: "freedraw" });
          onProperties?.(anchor);
        }}
        onClick={(event) => {
          if (activeTool.type === "freedraw") {
            if (event.currentTarget instanceof HTMLElement) {
              onProperties?.(event.currentTarget);
            }
          } else {
            app.setActiveTool({ type: "freedraw" });
          }
        }}
      />
      <ToolButton
        type="button"
        className="fc-board-tool"
        icon={<FactoryIcon name="eraser" />}
        aria-label={t("fcboard.橡皮")}
        showAriaLabel
        selected={activeTool.type === "eraser"}
        onLongPress={(anchor) => {
          setEraserAnchor(anchor);
          updateGap(anchor);
          app.setActiveTool({ type: "eraser" });
          setEraserOpen(true);
        }}
        onClick={(event) => {
          updateGap(event.currentTarget as HTMLElement);
          setEraserAnchor(event.currentTarget as HTMLElement);
          if (activeTool.type !== "eraser") {
            app.setActiveTool({ type: "eraser" });
          } else {
            setEraserOpen(!eraserOpen);
          }
        }}
      />
      {eraserOpen && (
        <ClickAwayListener onClickAway={() => setEraserOpen(false)}>
          <Popper
            open={eraserOpen}
            anchorEl={eraserAnchor}
            container={container}
            placement="top"
            sx={{ zIndex: 1300 }}
            modifiers={[
              { name: "offset", options: { offset: [0, popupGap] } },
              { name: "preventOverflow", options: { padding: 12 } },
            ]}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setEraserOpen(false);
              }
            }}
          >
            <Paper
              className="fc-insert-tools fc-eraser-settings"
              role="dialog"
              aria-label={t("fcboard.橡皮设置")}
            >
              <label className="fc-clear-slider">
                <span>{t("fcboard.滑动清屏")}</span>
                <input
                  type="range"
                  aria-label={t("fcboard.滑动清空当前白板")}
                  style={
                    {
                      "--fc-cleaning-icon": `url("${cleaningIcon}")`,
                    } as React.CSSProperties
                  }
                  min="0"
                  max="100"
                  value={clearProgress}
                  onChange={(event) =>
                    setClearProgress(Number(event.target.value))
                  }
                  onPointerUp={(event) =>
                    finishClear(Number(event.currentTarget.value))
                  }
                  onKeyUp={(event) => {
                    if (["ArrowRight", "End", "Enter"].includes(event.key)) {
                      finishClear(Number(event.currentTarget.value));
                    }
                  }}
                  onPointerCancel={() => setClearProgress(0)}
                />
              </label>
              <div
                className="fc-eraser-presets"
                role="group"
                aria-label={t("fcboard.橡皮大小预设")}
              >
                <button
                  type="button"
                  aria-label={t("fcboard.整个对象擦除")}
                  aria-pressed={state.eraserMode === "object"}
                  onClick={() => {
                    props.setAppState({ eraserMode: "object" });
                    setEraserOpen(false);
                  }}
                >
                  <FactoryIcon name="areaErase" />
                </button>
                {(
                  [
                    [100, "小"],
                    [150, "中"],
                    [200, "大"],
                  ] as const
                ).map(([pixels, label]) => (
                  <button
                    key={pixels}
                    type="button"
                    aria-label={t(`fcboard.${label}橡皮`)}
                    aria-pressed={
                      state.eraserMode !== "object" &&
                      Math.abs(
                        (state.eraserSize ??
                          app.props.UIOptions.inkProfile?.eraserSize ??
                          60) -
                          (pixels / 150) *
                            (app.props.UIOptions.inkProfile?.eraserSize ?? 60),
                      ) < 1
                    }
                    onClick={() => {
                      props.setAppState({
                        eraserMode: "stroke",
                        eraserSize:
                          (pixels / 150) *
                          (app.props.UIOptions.inkProfile?.eraserSize ?? 60),
                      });
                      setEraserOpen(false);
                    }}
                  >
                    <span
                      className="fc-eraser-dot"
                      style={
                        { "--fc-dot-size": pixels / 5 } as React.CSSProperties
                      }
                    />
                  </button>
                ))}
              </div>
              <details className="fc-eraser-advanced">
                <summary>{t("fcboard.触控与橡皮设置")}</summary>
                <label>
                  {t("fcboard.擦除方式")}
                  <select
                    value={state.eraserMode || "stroke"}
                    onChange={(event) =>
                      props.setAppState({
                        eraserMode: event.target.value as "stroke" | "object",
                      })
                    }
                  >
                    <option value="stroke">{t("fcboard.局部擦除笔迹")}</option>
                    <option value="object">{t("fcboard.整个对象擦除")}</option>
                  </select>
                </label>
                <label>
                  {t("fcboard.橡皮大小（屏幕像素）")}
                  <input
                    type="range"
                    min="12"
                    max="240"
                    step="2"
                    value={
                      state.eraserSize ??
                      app.props.UIOptions.inkProfile?.eraserSize ??
                      60
                    }
                    onChange={(event) =>
                      props.setAppState({
                        eraserSize: Number(event.target.value),
                      })
                    }
                  />
                  <output>
                    {state.eraserSize ??
                      app.props.UIOptions.inkProfile?.eraserSize ??
                      60}
                  </output>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={state.palmEraser !== false}
                    onChange={(event) =>
                      props.setAppState({ palmEraser: event.target.checked })
                    }
                  />
                  {t("fcboard.手掌 / 手背擦除")}
                </label>
                <label>
                  {t("fcboard.大面积触点阈值（屏幕像素）")}
                  <input
                    type="range"
                    min="16"
                    max="120"
                    value={
                      state.palmEraserThreshold ??
                      app.props.UIOptions.inkProfile?.palmThreshold ??
                      36
                    }
                    disabled={state.palmEraser === false}
                    onChange={(event) =>
                      props.setAppState({
                        palmEraserThreshold: Number(event.target.value),
                      })
                    }
                  />
                  <output>
                    {state.palmEraserThreshold ??
                      app.props.UIOptions.inkProfile?.palmThreshold ??
                      36}
                  </output>
                </label>
              </details>
            </Paper>
          </Popper>
        </ClickAwayListener>
      )}
      <ToolButton
        type="button"
        className="fc-board-tool"
        icon={<FactoryIcon name="select" />}
        aria-label={t("fcboard.选择")}
        title={t("fcboard.选择")}
        showAriaLabel
        selected={["selection", "lasso"].includes(activeTool.type)}
        onClick={() =>
          app.setActiveTool(
            {
              type: "lasso",
            },
            ["selection", "lasso"].includes(activeTool.type),
          )
        }
      />
      <ToolButton
        type="button"
        className="fc-board-tool"
        icon={<FactoryIcon name="insert" />}
        aria-label={t("fcboard.插入")}
        data-board-insert
        selected={open}
        showAriaLabel
        onClick={(event) => {
          updateGap(event.currentTarget as HTMLElement);
          setInsertAnchor(event.currentTarget as HTMLElement);
          setOpen(!open);
        }}
      />
      {open && (
        <ClickAwayListener onClickAway={() => setOpen(false)}>
          <Popper
            open={open}
            anchorEl={insertAnchor}
            container={container}
            placement="top"
            sx={{ zIndex: 1300 }}
            modifiers={[
              { name: "offset", options: { offset: [0, popupGap] } },
              { name: "preventOverflow", options: { padding: 12 } },
            ]}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setOpen(false);
              }
            }}
          >
            <Paper
              className={`fc-insert-tools fc-insert-picker${
                shapesOpen ? " fc-insert-picker-expanded" : ""
              }`}
              role="dialog"
              aria-label={t("fcboard.插入与工具")}
            >
              <div
                className="fc-insert-grid"
                onClick={(event) => {
                  if (
                    (event.target as Element).closest("[data-close-insert]")
                  ) {
                    setOpen(false);
                  }
                }}
              >
                <button
                  type="button"
                  aria-expanded={shapesOpen}
                  onClick={() => setShapesOpen(!shapesOpen)}
                >
                  <FactoryIcon name="shape" />
                  <span>{t("fcboard.图形")}</span>
                </button>
                <tunnels.ToolbarInsertTunnel.Out />
              </div>
              {shapesOpen && (
                <div
                  className="fc-insert-shapes"
                  onClick={(event) => {
                    if ((event.target as Element).closest("button")) {
                      setOpen(false);
                    }
                  }}
                >
                  {SHAPES.filter(({ value }) =>
                    [
                      "rectangle",
                      "diamond",
                      "ellipse",
                      "arrow",
                      "line",
                    ].includes(value),
                  ).map(({ value, icon }) => (
                    <ToolButton
                      key={value}
                      type="button"
                      icon={icon}
                      showAriaLabel
                      aria-label={t(`toolBar.${value}`)}
                      data-testid={`toolbar-${value}`}
                      selected={activeTool.type === value}
                      onClick={() => app.setActiveTool({ type: value })}
                    />
                  ))}
                  <tunnels.ToolbarShapesTunnel.Out />
                </div>
              )}
            </Paper>
          </Popper>
        </ClickAwayListener>
      )}
    </>
  );
};
