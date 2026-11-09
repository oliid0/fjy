import React from "react";
import Popper from "@mui/material/Popper";
import Paper from "@mui/material/Paper";
import Dialog from "@mui/material/Dialog";
import ClickAwayListener from "@mui/material/ClickAwayListener";

import { CaptureUpdateAction } from "@fcboard/element";

import { t, useI18n } from "../i18n";

import { useUIAppState } from "../context/ui-appState";
import { useTunnels } from "../context/tunnels";
import { useToolbarItems } from "../toolbarPreferences";

import { useFcboardContainer } from "./App";
import { ToolButton } from "./ToolButton";
import { FactoryIcon } from "./FactoryIcon";
import { WhiteboardAerialView } from "./WhiteboardAerialView";
import cleaningIcon from "./xbh-toolbar-assets/eraser-thumb.png";
import { SHAPES } from "./shapes";

import type { ShapesSwitcher } from "./Actions";

/** Fixed drawing controls and one toolbox for all host insertion/teaching tools. */
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
  const toolbarItems = useToolbarItems();
  const [eraserOpen, setEraserOpen] = React.useState(false);
  const [clearProgress, setClearProgress] = React.useState(0);
  const [eraserExpanded, setEraserExpanded] = React.useState(false);
  const [popupGap, setPopupGap] = React.useState(6.7);
  const [eraserAnchor, setEraserAnchor] = React.useState<HTMLElement | null>(
    null,
  );
  const [insertAnchor, setInsertAnchor] = React.useState<HTMLElement | null>(
    null,
  );
  const updateGap = (anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const top =
      anchor.closest(".fc-unified-toolbar")?.getBoundingClientRect().top ??
      rect.top;
    setPopupGap(rect.top - top + (10 * rect.height) / 58);
  };
  const state = useUIAppState();
  const tunnels = useTunnels();
  const hasHostShapes = tunnels.ToolbarShapesTunnel.useHasEntries();
  const [shapesOpen, setShapesOpen] = React.useState(false);
  const lastShape = React.useRef<
    "rectangle" | "diamond" | "ellipse" | "arrow" | "line"
  >("line");
  const openingShape = React.useRef(false);
  const { container } = useFcboardContainer();
  const finishClear = (value: number) => {
    setClearProgress(0);
    if (value < 90) {
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
        setShapesOpen(false);
        setEraserOpen(false);
      }),
    [app],
  );
  React.useEffect(() => {
    if (
      ["rectangle", "diamond", "ellipse", "arrow", "line"].includes(
        activeTool.type,
      )
    ) {
      lastShape.current = activeTool.type as typeof lastShape.current;
    }
    if (openingShape.current && !state.toolbarHidden) {
      openingShape.current = false;
      return;
    }
    setOpen(false);
    setShapesOpen(false);
    if (activeTool.type !== "eraser" || state.toolbarHidden) {
      setEraserOpen(false);
    }
  }, [activeTool.type, activeTool.customType, state.toolbarHidden]);
  React.useEffect(() => {
    const close = () => {
      setOpen(false);
      setShapesOpen(false);
    };
    window.addEventListener("fcboard:shape-draw", close);
    return () => window.removeEventListener("fcboard:shape-draw", close);
  }, []);
  React.useEffect(() => {
    const show = () => {
      const anchor = container?.querySelector<HTMLElement>(
        "[data-board-insert], .fc-drawing-tools",
      );
      if (anchor) {
        setInsertAnchor(anchor);
        updateGap(anchor);
      }
      setShapesOpen(false);
      setOpen(true);
    };
    const hide = () => {
      setOpen(false);
      setShapesOpen(false);
    };
    window.addEventListener("fcboard:toolbox-open", show);
    window.addEventListener("fcboard:toolbox-close", hide);
    return () => {
      window.removeEventListener("fcboard:toolbox-open", show);
      window.removeEventListener("fcboard:toolbox-close", hide);
    };
  }, [container]);
  React.useEffect(() => {
    const dismiss = (event: Event) => {
      const target = (event as CustomEvent<HTMLElement>).detail;
      if (!target.closest("[data-toolbar-eraser]")) {
        setEraserOpen(false);
      }
      if (
        !target.closest(
          '[data-toolbar-item="shape"], [data-toolbar-item="toolbox"]',
        )
      ) {
        setOpen(false);
        setShapesOpen(false);
      }
    };
    window.addEventListener("fcboard:toolbar-action", dismiss);
    return () => window.removeEventListener("fcboard:toolbar-action", dismiss);
  }, []);
  return (
    <>
      <ToolButton
        type="button"
        className="fc-board-tool"
        data-toolbar-pen
        icon={
          <span className="fc-pen-icon">
            <FactoryIcon name="penBodyItalic" className="fc-pen-body" />
            <FactoryIcon
              name="penThinHead"
              className="fc-pen-thin"
              style={
                {
                  "--fc-pen-color":
                    (state.whiteboardPenTip || "fine") === "fine"
                      ? state.currentItemStrokeColor
                      : state.whiteboardPenTips?.fine?.color || "#d71e1e",
                } as React.CSSProperties
              }
            />
            {state.whiteboardDualPen && (
              <FactoryIcon
                name="penThickHead"
                className="fc-pen-thick"
                style={
                  {
                    "--fc-pen-color":
                      state.whiteboardPenTip === "thick"
                        ? state.currentItemStrokeColor
                        : state.whiteboardPenTips?.thick?.color || "#26c255",
                  } as React.CSSProperties
                }
              />
            )}
          </span>
        }
        aria-label={t("fcboard.pen")}
        showAriaLabel
        selected={activeTool.type === "freedraw"}
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
        data-toolbar-eraser
        icon={<FactoryIcon name="eraser" />}
        aria-label={t("fcboard.eraser")}
        showAriaLabel
        selected={activeTool.type === "eraser"}
        onClick={(event) => {
          updateGap(event.currentTarget as HTMLElement);
          setEraserAnchor(event.currentTarget as HTMLElement);
          app.setActiveTool({ type: "eraser" });
          setEraserExpanded(false);
          setClearProgress(0);
          setEraserOpen(true);
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
              {eraserExpanded && (
                <div className="fc-eraser-size-panel">
                  <div className="fc-eraser-size-preview">
                    <FactoryIcon
                      name="eraser"
                      style={{
                        width: state.eraserSize ?? 60,
                        height: (state.eraserSize ?? 60) * 0.6,
                      }}
                    />
                  </div>
                  <input
                    type="range"
                    min="0.24"
                    max="2"
                    step="0.01"
                    aria-label={t("fcboard.eraser_sizes")}
                    value={
                      (state.eraserSize ??
                        app.props.UIOptions.inkProfile?.eraserSize ??
                        60) / (app.props.UIOptions.inkProfile?.eraserSize ?? 60)
                    }
                    onChange={(event) =>
                      props.setAppState({
                        eraserSize:
                          Number(event.target.value) *
                          (app.props.UIOptions.inkProfile?.eraserSize ?? 60),
                      })
                    }
                  />
                </div>
              )}
              <div
                className="fc-native-eraser-row"
                role="group"
                aria-label={t("fcboard.erase_mode")}
              >
                <div className="fc-native-eraser-path">
                  <button
                    type="button"
                    aria-label={t("fcboard.erase_part_of_a_stroke")}
                    aria-pressed={
                      !state.eraserMode || state.eraserMode === "stroke"
                    }
                    onClick={() => {
                      props.setAppState({ eraserMode: "stroke" });
                      setEraserOpen(false);
                    }}
                  >
                    <FactoryIcon name="eraser" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("fcboard.eraser_sizes")}
                    aria-expanded={eraserExpanded}
                    onClick={() => setEraserExpanded((value) => !value)}
                  >
                    <FactoryIcon name="eraseSize" />
                  </button>
                </div>
                <button
                  type="button"
                  aria-label={t("fcboard.erase_entire_object")}
                  aria-pressed={state.eraserMode === "region"}
                  onClick={() => {
                    props.setAppState({ eraserMode: "region" });
                    setEraserOpen(false);
                  }}
                >
                  <FactoryIcon name="eraseChoose" />
                </button>
                <label className="fc-clear-slider">
                  <FactoryIcon name="eraseDirection" />
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
      {toolbarItems.includes("shape") && (
        <span
          className="fc-toolbar-shortcut"
          data-toolbar-item="shape"
          style={{ order: 10 + toolbarItems.indexOf("shape") }}
        >
          <ToolButton
            type="button"
            className="fc-board-tool"
            icon={<FactoryIcon name="shape" />}
            aria-label={t("fcboard.shape")}
            showAriaLabel
            selected={[
              "rectangle",
              "diamond",
              "ellipse",
              "arrow",
              "line",
              "custom",
            ].includes(activeTool.type)}
            onClick={(event) => {
              if (activeTool.type !== lastShape.current) {
                openingShape.current = true;
                app.setActiveTool({ type: lastShape.current });
              }
              updateGap(event.currentTarget as HTMLElement);
              setInsertAnchor(event.currentTarget as HTMLElement);
              setShapesOpen(true);
              setOpen(true);
            }}
          />
        </span>
      )}
      {toolbarItems.includes("toolbox") && (
        <span
          className="fc-toolbar-shortcut"
          data-toolbar-item="toolbox"
          style={{ order: 10 + toolbarItems.indexOf("toolbox") }}
        >
          <ToolButton
            type="button"
            className="fc-board-tool"
            icon={<FactoryIcon name="toolbox" />}
            aria-label={t("fcboard.toolbox")}
            data-board-insert
            data-teaching-tools
            selected={open && !shapesOpen}
            showAriaLabel
            onClick={(event) => {
              updateGap(event.currentTarget as HTMLElement);
              setInsertAnchor(event.currentTarget as HTMLElement);
              setShapesOpen(false);
              setOpen(true);
            }}
          />
        </span>
      )}
      {toolbarItems.includes("aerial") && (
        <span
          className="fc-toolbar-shortcut"
          data-toolbar-item="aerial"
          style={{ order: 10 + toolbarItems.indexOf("aerial") }}
        >
          <WhiteboardAerialView app={app} />
        </span>
      )}
      {open && !shapesOpen && (
        <ClickAwayListener onClickAway={() => setOpen(false)}>
          <Popper
            open
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
              className="fc-insert-tools fc-insert-picker fc-combined-toolbox"
              role="dialog"
              aria-label={t("fcboard.toolbox")}
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
                <tunnels.ToolbarInsertTunnel.Out />
                <tunnels.ToolbarToolboxTunnel.Out />
              </div>
            </Paper>
          </Popper>
        </ClickAwayListener>
      )}
      <Dialog
        open={open && shapesOpen}
        // Preserve the fade, but release the first drawing contact immediately.
        style={{ pointerEvents: open && shapesOpen ? undefined : "none" }}
        container={container}
        maxWidth={false}
        onClose={() => {
          setOpen(false);
          setShapesOpen(false);
        }}
        aria-label={t("fcboard.shape")}
        slotProps={{
          backdrop: {
            style: { pointerEvents: open && shapesOpen ? undefined : "none" },
          },
          paper: {
            style: { pointerEvents: open && shapesOpen ? undefined : "none" },
            "aria-label": t("fcboard.shape"),
            className:
              "fc-insert-tools fc-insert-picker fc-insert-picker-expanded",
            sx: { maxWidth: "calc(100% - 24px)" },
          },
        }}
      >
        <div
          className="fc-insert-shapes"
          onClick={(event) => {
            if (
              (event.target as Element).closest(
                '[data-testid^="factory-shape-"]',
              )
            ) {
              setOpen(false);
              setShapesOpen(false);
            }
          }}
        >
          {hasHostShapes ? (
            <tunnels.ToolbarShapesTunnel.Out />
          ) : (
            SHAPES.filter(({ value }) =>
              ["rectangle", "diamond", "ellipse", "arrow", "line"].includes(
                value,
              ),
            ).map(({ value, icon }) => (
              <ToolButton
                key={value}
                type="button"
                icon={icon}
                showAriaLabel
                aria-label={t(`toolBar.${value}`)}
                data-testid={`toolbar-${value}`}
                selected={activeTool.type === value}
                onClick={() => {
                  app.setActiveTool({ type: value });
                  setOpen(false);
                  setShapesOpen(false);
                }}
              />
            ))
          )}
        </div>
      </Dialog>
    </>
  );
};
