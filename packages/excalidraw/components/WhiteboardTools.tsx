import React from "react";
import { Popover } from "radix-ui";

import { CaptureUpdateAction } from "@excalidraw/element";

import { t, useI18n } from "../i18n";

import { useUIAppState } from "../context/ui-appState";
import { useTunnels } from "../context/tunnels";

import { ShapesSwitcher } from "./Actions";
import { useExcalidrawContainer } from "./App";
import { ToolButton } from "./ToolButton";
import { FactoryIcon } from "./FactoryIcon";
import cleaningIcon from "./FactoryCleaning.svg?url";

/** Compact APK toolbar; all original insertion tools remain in the insertion popover. */
export const WhiteboardTools = ({
  app,
  activeTool,
  onProperties,
  children,
  ...props
}: React.ComponentProps<typeof ShapesSwitcher> & {
  children: React.ReactNode;
}) => {
  useI18n();
  const [open, setOpen] = React.useState(false);
  const [eraserOpen, setEraserOpen] = React.useState(false);
  const [clearProgress, setClearProgress] = React.useState(0);
  const [popupGap, setPopupGap] = React.useState(16);
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
      <Popover.Root open={eraserOpen} onOpenChange={setEraserOpen}>
        <Popover.Trigger asChild>
          <ToolButton
            type="button"
            className="fc-board-tool"
            icon={<FactoryIcon name="eraser" />}
            aria-label={t("fcboard.橡皮")}
            showAriaLabel
            selected={activeTool.type === "eraser"}
            onLongPress={(anchor) => {
              updateGap(anchor);
              app.setActiveTool({ type: "eraser" });
              setEraserOpen(true);
            }}
            onClick={(event) => {
              updateGap(event.currentTarget as HTMLElement);
              if (activeTool.type !== "eraser") {
                event.preventDefault();
                app.setActiveTool({ type: "eraser" });
              }
            }}
          />
        </Popover.Trigger>
        <Popover.Portal container={container}>
          <Popover.Content
            className="fc-insert-tools fc-eraser-settings"
            side="top"
            sideOffset={popupGap}
            collisionPadding={12}
            aria-label={t("fcboard.橡皮设置")}
            onEscapeKeyDown={(event) => event.stopPropagation()}
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
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <ToolButton
        type="button"
        className="fc-board-tool"
        icon={<FactoryIcon name="select" />}
        aria-label={t("fcboard.选择")}
        title={t("fcboard.选择 / 圈选：再次点击切换框选与套索")}
        showAriaLabel
        selected={["selection", "lasso"].includes(activeTool.type)}
        onClick={() =>
          app.setActiveTool({
            type: activeTool.type === "lasso" ? "selection" : "lasso",
          })
        }
      />
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <ToolButton
            type="button"
            className="fc-board-tool"
            icon={<FactoryIcon name="insert" />}
            aria-label={t("fcboard.插入")}
            data-board-insert
            showAriaLabel
            onClick={(event) => updateGap(event.currentTarget as HTMLElement)}
          />
        </Popover.Trigger>
        <Popover.Portal container={container}>
          <Popover.Content
            className={`fc-insert-tools fc-insert-picker${
              shapesOpen ? " fc-insert-picker-expanded" : ""
            }`}
            side="top"
            sideOffset={popupGap}
            collisionPadding={12}
            aria-label={t("fcboard.插入与工具")}
            onEscapeKeyDown={(event) => event.stopPropagation()}
          >
            <div
              className="fc-insert-grid"
              onClick={(event) => {
                if ((event.target as Element).closest("[data-close-insert]")) {
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
              <div className="fc-insert-shapes">
                <ShapesSwitcher
                  {...props}
                  app={app}
                  activeTool={activeTool}
                  onProperties={onProperties}
                />
              </div>
            )}
            {shapesOpen && children}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
};
