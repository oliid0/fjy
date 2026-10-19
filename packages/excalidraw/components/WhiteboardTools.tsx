import React from "react";
import { Popover } from "radix-ui";

import { CaptureUpdateAction } from "@excalidraw/element";

import { useUIAppState } from "../context/ui-appState";

import { ShapesSwitcher } from "./Actions";
import { useExcalidrawContainer } from "./App";
import { ToolButton } from "./ToolButton";
import {
  EraserIcon,
  FreedrawIcon,
  LassoIcon,
  PlusIcon,
  SelectionIcon,
} from "./icons";

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
  const [open, setOpen] = React.useState(false);
  const [eraserOpen, setEraserOpen] = React.useState(false);
  const [clearProgress, setClearProgress] = React.useState(0);
  const state = useUIAppState();
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
    setEraserOpen(false);
  }, [activeTool.type, state.toolbarHidden]);
  return (
    <>
      <ToolButton
        type="button"
        className="fc-board-tool"
        icon={FreedrawIcon}
        aria-label="画笔"
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
      <Popover.Root open={eraserOpen} onOpenChange={setEraserOpen}>
        <Popover.Trigger asChild>
          <ToolButton
            type="button"
            className="fc-board-tool"
            icon={EraserIcon}
            aria-label="橡皮"
            showAriaLabel
            selected={activeTool.type === "eraser"}
            onClick={(event) => {
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
            sideOffset={12}
            collisionPadding={12}
            aria-label="橡皮设置"
            onEscapeKeyDown={(event) => event.stopPropagation()}
          >
            <label>
              滑动清屏
              <input
                type="range"
                aria-label="滑动清空当前白板"
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
              className="fc-pen-types"
              role="group"
              aria-label="橡皮大小预设"
            >
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
                  aria-label={`${label}橡皮`}
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
                  {label}
                </button>
              ))}
            </div>
            <label>
              擦除方式
              <select
                value={state.eraserMode || "stroke"}
                onChange={(event) =>
                  props.setAppState({
                    eraserMode: event.target.value as "stroke" | "object",
                  })
                }
              >
                <option value="stroke">局部擦除笔迹</option>
                <option value="object">整个对象擦除</option>
              </select>
            </label>
            <label>
              橡皮大小（屏幕像素）
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
                  props.setAppState({ eraserSize: Number(event.target.value) })
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
              手掌 / 手背擦除
            </label>
            <label>
              大面积触点阈值（屏幕像素）
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
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <ToolButton
        type="button"
        className="fc-board-tool"
        icon={activeTool.type === "lasso" ? LassoIcon : SelectionIcon}
        aria-label="选择"
        title="选择 / 圈选：再次点击切换框选与套索"
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
            icon={PlusIcon}
            aria-label="插入"
            showAriaLabel
            selected={open}
          />
        </Popover.Trigger>
        <Popover.Portal container={container}>
          <Popover.Content
            className="fc-insert-tools"
            side="top"
            sideOffset={12}
            collisionPadding={12}
            aria-label="插入与工具"
            onEscapeKeyDown={(event) => event.stopPropagation()}
          >
            <div className="fc-insert-shapes">
              <ShapesSwitcher
                {...props}
                app={app}
                activeTool={activeTool}
                onProperties={onProperties}
              />
            </div>
            {children}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
};
