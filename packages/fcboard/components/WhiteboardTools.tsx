import React from "react";
import Popper from "@mui/material/Popper";
import Paper from "@mui/material/Paper";
import ClickAwayListener from "@mui/material/ClickAwayListener";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";

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
  const hasHostShapes = tunnels.ToolbarShapesTunnel.useHasEntries();
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
    if (
      state.toolbarHidden ||
      activeTool.type !== "custom" ||
      !activeTool.customType?.startsWith("factory-shape:")
    ) {
      setOpen(false);
      setShapesOpen(false);
    }
    if (activeTool.type !== "eraser" || state.toolbarHidden) {
      setEraserOpen(false);
    }
  }, [activeTool.type, activeTool.customType, state.toolbarHidden]);
  React.useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener("fcboard:shape-draw", close);
    return () => window.removeEventListener("fcboard:shape-draw", close);
  }, []);
  return (
    <>
      <ToolButton
        type="button"
        className="fc-board-tool"
        icon={<FactoryIcon name="pen" />}
        aria-label={t("fcboard.pen")}
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
        aria-label={t("fcboard.eraser")}
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
              aria-label={t("fcboard.eraser_settings")}
            >
              <label className="fc-clear-slider">
                <span>{t("fcboard.slide_to_erase")}</span>
                <input
                  type="range"
                  aria-label={t("fcboard.slide_to_clear_this_board")}
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
                aria-label={t("fcboard.eraser_sizes")}
              >
                <button
                  type="button"
                  aria-label={t("fcboard.erase_entire_object")}
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
                    [100, "small_eraser"],
                    [150, "medium_eraser"],
                    [200, "large_eraser"],
                  ] as const
                ).map(([pixels, label]) => (
                  <button
                    key={pixels}
                    type="button"
                    aria-label={t(`fcboard.${label}`)}
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
                        {
                          "--fc-dot-size":
                            pixels === 100 ? 14 : pixels === 150 ? 21 : 29,
                        } as React.CSSProperties
                      }
                    />
                  </button>
                ))}
              </div>
              <div className="fc-eraser-mode">
                <span>{t("fcboard.erase_mode")}</span>
                <ToggleButtonGroup
                  aria-label={t("fcboard.erase_mode")}
                  value={state.eraserMode || "stroke"}
                  exclusive
                  size="small"
                  orientation="horizontal"
                  onKeyDown={(event) => {
                    if (
                      event.key === "ArrowLeft" ||
                      event.key === "ArrowRight"
                    ) {
                      event.preventDefault();
                      props.setAppState({
                        eraserMode:
                          event.key === "ArrowLeft" ? "stroke" : "object",
                      });
                    }
                  }}
                  onChange={(_event, value: "stroke" | "object" | null) => {
                    if (value) {
                      props.setAppState({ eraserMode: value });
                    }
                  }}
                >
                  <ToggleButton
                    value="stroke"
                    aria-label={t("fcboard.erase_part_of_a_stroke")}
                  >
                    {t("fcboard.erase_part_of_a_stroke")}
                  </ToggleButton>
                  <ToggleButton
                    value="object"
                    aria-label={t("fcboard.erase_entire_object")}
                  >
                    {t("fcboard.erase_entire_object")}
                  </ToggleButton>
                </ToggleButtonGroup>
              </div>
            </Paper>
          </Popper>
        </ClickAwayListener>
      )}
      <ToolButton
        type="button"
        className="fc-board-tool"
        icon={<FactoryIcon name="select" />}
        aria-label={t("fcboard.select")}
        title={t("fcboard.select")}
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
        aria-label={t("fcboard.insert")}
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
              aria-label={t("fcboard.insert_tools")}
            >
              {!shapesOpen && (
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
                    onClick={() => {
                      if (
                        !shapesOpen &&
                        hasHostShapes &&
                        (activeTool.type !== "custom" ||
                          !activeTool.customType?.startsWith("factory-shape:"))
                      ) {
                        app.setActiveTool({
                          type: "custom",
                          customType: "factory-shape:0",
                        });
                      }
                      setShapesOpen(!shapesOpen);
                    }}
                  >
                    <FactoryIcon name="shape" />
                    <span>{t("fcboard.shape")}</span>
                  </button>
                  <tunnels.ToolbarInsertTunnel.Out />
                </div>
              )}
              {shapesOpen && (
                <div className="fc-insert-shapes">
                  {hasHostShapes ? (
                    <tunnels.ToolbarShapesTunnel.Out />
                  ) : (
                    SHAPES.filter(({ value }) =>
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
                    ))
                  )}
                </div>
              )}
            </Paper>
          </Popper>
        </ClickAwayListener>
      )}
    </>
  );
};
