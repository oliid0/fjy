import { useEffect, useRef, useState } from "react";
import { ToolbarExtras } from "@excalidraw/excalidraw";
import {
  CloseIcon,
  gridIcon,
  playerPlayIcon,
} from "@excalidraw/excalidraw/components/icons";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { insertionPoint, selectedPlot } from "./board";
import { classroomCommands } from "./commands";
import {
  configureWidget,
  readWidgets,
  renderWidget,
  teachingTools,
  widgetDefaults,
  widgetShapes,
  widgetTime,
} from "./widgets";

import type { Widget, WidgetKind, WidgetParams } from "./widgets";

const parameters: Partial<Record<WidgetKind, (keyof WidgetParams)[]>> = {
  cube: ["rotation", "size"],
  sphere: ["rotation", "size"],
  cylinder: ["rotation", "size"],
  cone: ["rotation", "size"],
  prism: ["rotation", "size"],
  pyramid: ["rotation", "size"],
  frustum: ["rotation", "size"],
  pendulum: ["length", "gravity", "angle"],
  projectile: ["vx", "vy", "gravity"],
};
const ranges = {
  rotation: [-180, 180, 1],
  size: [0.3, 2, 0.1],
  length: [0.2, 5, 0.1],
  gravity: [0.1, 30, 0.1],
  angle: [0, 30, 1],
  vx: [1, 50, 0.5],
  vy: [1, 50, 0.5],
};
const labels: Record<string, string> = {
  rotation: "旋转",
  size: "大小",
  length: "摆长 L（m）",
  gravity: "重力 g（m/s²）",
  angle: "初始角度 θ（°）",
  vx: "水平速度（m/s）",
  vy: "竖直速度（m/s）",
};

export const TeachingTools = ({ api }: { api: ExcalidrawImperativeAPI }) => {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Widget | null>(null);
  const selectedRef = useRef<Widget | null>(null);
  const panel = useRef<HTMLElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const refresh = () => {
      const state = api.getAppState();
      const document = classroomCommands.read("document") as
        | { selection?: string[]; ink: { id: string; widget?: Widget }[] }
        | undefined;
      const ids = document
        ? new Set(
            document.ink
              .filter((stroke) => document.selection?.includes(stroke.id))
              .map((stroke) => stroke.widget?.id)
              .filter(Boolean),
          )
        : new Set(
            api
              .getSceneElements()
              .filter((el) => state.selectedElementIds[el.id])
              .map((el) => el.customData?.fcWidget?.id)
              .filter(Boolean),
          );
      const next =
        ids.size === 1 && (document || !selectedPlot(api))
          ? readWidgets(api).find((widget) => ids.has(widget.id)) || null
          : null;
      selectedRef.current = next;
      setSelected((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    };
    const unsubscribe = api.onChange(refresh);
    const documentChanged = classroomCommands.watch("document", refresh);
    refresh();
    const timer = setInterval(() => {
      for (const widget of readWidgets(api)) {
        if (!widget.params.running) {
          continue;
        }
        if (
          widget.kind === "timer" &&
          widgetTime(widget.params) >= widget.params.duration
        ) {
          renderWidget(
            api,
            {
              ...widget,
              params: {
                ...widget.params,
                running: false,
                elapsed: widget.params.duration,
              },
            },
            false,
          );
        } else if (["timer", "pendulum", "projectile"].includes(widget.kind)) {
          renderWidget(api, widget, false);
        }
      }
    }, 100);
    return () => {
      clearInterval(timer);
      unsubscribe();
      documentChanged();
    };
  }, [api]);
  useEffect(() => {
    if (!open) {
      return;
    }
    const dismiss = (event: PointerEvent) => {
      if (
        !panel.current?.contains(event.target as Node) &&
        !(event.target as Element).closest?.("[data-teaching-tools]")
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [open]);
  const change = (changes: Record<string, unknown>, id?: string) => {
    const widget = id
      ? readWidgets(api).find((item) => item.id === id)
      : selectedRef.current;
    if (!widget) {
      throw new Error("请先选择一个教学工具");
    }
    const next = { ...widget, params: configureWidget(widget.params, changes) };
    renderWidget(api, next);
    selectedRef.current = next;
    setSelected(next);
  };
  const play = (enabled?: boolean, id?: string) => {
    const widget = id
      ? readWidgets(api).find((item) => item.id === id)
      : selectedRef.current;
    if (!widget || !["timer", "pendulum", "projectile"].includes(widget.kind)) {
      throw new Error("请选择计时器或动态实验");
    }
    const running = enabled === undefined ? !widget.params.running : enabled;
    change(
      { running, elapsed: widgetTime(widget.params), started: Date.now() },
      widget.id,
    );
  };
  const random = (id?: string) => {
    const widget = id
      ? readWidgets(api).find((item) => item.id === id)
      : selectedRef.current;
    if (!widget || !["dice", "picker"].includes(widget.kind)) {
      throw new Error("请选择骰子或随机抽取工具");
    }
    const choices =
      widget.kind === "dice"
        ? ["1", "2", "3", "4", "5", "6"]
        : widget.params.names
            .split(/[,，\n]/)
            .map((name) => name.trim())
            .filter(Boolean);
    if (!choices.length) {
      throw new Error("请先输入抽取名单");
    }
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    change({ choice: choices[values[0] % choices.length] }, widget.id);
  };
  const insert = (kind: WidgetKind) => {
    const widget: Widget = {
      id: crypto.randomUUID(),
      kind,
      params: widgetDefaults(),
      position: classroomCommands.has("document.widget")
        ? { x: 60, y: 60 }
        : insertionPoint(api),
    };
    const elements = renderWidget(api, widget);
    if (classroomCommands.has("document.select")) {
      void classroomCommands.execute({
        name: "document.select",
        args: { ids: elements.map((el) => el.id) },
      });
    } else {
      api.updateScene({
        appState: {
          selectedElementIds: Object.fromEntries(
            elements.map((el) => [el.id, true]),
          ),
        },
      });
    }
    api.setActiveTool({ type: "selection" });
    selectedRef.current = widget;
    setSelected(widget);
    setOpen(false);
  };
  useEffect(() => {
    const registrations = [
      classroomCommands.register("tools.open", "展开教学工具", () => {
        if (classroomCommands.has("panel.close")) {
          void classroomCommands.execute({ name: "panel.close" });
        }
        setOpen(true);
      }),
      classroomCommands.register(
        "tools.insert",
        `插入原生教学工具，args.kind=${Object.keys(teachingTools).join("|")}`,
        (args) => {
          if (!(String(args.kind) in teachingTools)) {
            throw new Error("教学工具不存在");
          }
          insert(args.kind as WidgetKind);
        },
      ),
      classroomCommands.register(
        "tools.configure",
        "修改选中教学工具或args.id指定工具；参数 args.rotation,size,length,gravity,angle,vx,vy,duration(秒),names(逗号分隔)",
        (args) =>
          change(args, typeof args.id === "string" ? args.id : undefined),
      ),
      classroomCommands.register(
        "tools.play",
        "开始或暂停计时器、实验；args.enabled 布尔值，可带args.id",
        (args) =>
          play(
            typeof args.enabled === "boolean" ? args.enabled : undefined,
            typeof args.id === "string" ? args.id : undefined,
          ),
      ),
      classroomCommands.register(
        "tools.random",
        "掷骰子或随机抽取，可带args.id",
        (args) => random(typeof args.id === "string" ? args.id : undefined),
      ),
      classroomCommands.context("tools", () => ({
        selected: selected?.id,
        widgets: readWidgets(api),
      })),
    ];
    return () => registrations.forEach((stop) => stop());
  });
  const attempt = (operation: () => void) => {
    try {
      setError("");
      operation();
    } catch (failure) {
      setError(String(failure));
    }
  };
  return (
    <>
      <ToolbarExtras>
        <div className="fc-toolbar-extras">
          <button
            data-teaching-tools
            aria-label="教学工具"
            title="教学工具"
            aria-expanded={open}
            onClick={() => {
              if (classroomCommands.has("panel.close")) {
                void classroomCommands.execute({ name: "panel.close" });
              }
              setOpen(!open);
            }}
          >
            {gridIcon}
          </button>
        </div>
      </ToolbarExtras>
      {open && (
        <section
          ref={panel}
          className="fc-tools-picker fc-surface"
          role="dialog"
          aria-label="教学工具"
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        >
          <header>
            <strong>教学工具</strong>
            <button aria-label="关闭教学工具" onClick={() => setOpen(false)}>
              {CloseIcon}
            </button>
          </header>
          <div className="fc-tools-grid">
            {(Object.entries(teachingTools) as [WidgetKind, string][]).map(
              ([kind, name]) => (
                <button
                  key={kind}
                  aria-label={`插入${name}`}
                  onClick={() => attempt(() => insert(kind))}
                >
                  <svg viewBox="-10 -20 380 280" aria-hidden="true">
                    {widgetShapes({
                      id: "preview",
                      kind,
                      params: { ...widgetDefaults(), duration: 180 },
                      position: { x: 0, y: 0 },
                    }).map((shape, index) =>
                      shape.type === "line" && shape.points ? (
                        <polyline
                          key={index}
                          points={shape.points
                            .map(
                              ([x, y]) =>
                                `${x + (shape.x || 0)},${y + (shape.y || 0)}`,
                            )
                            .join(" ")}
                          stroke="#245bd6"
                          strokeWidth="3"
                          fill="none"
                        />
                      ) : shape.type === "ellipse" ||
                        shape.type === "rectangle" ? (
                        <rect
                          key={index}
                          x={shape.x}
                          y={shape.y}
                          width={shape.width}
                          height={shape.height}
                          rx={
                            shape.type === "ellipse"
                              ? (shape.width || 0) / 2
                              : 4
                          }
                          stroke="#245bd6"
                          strokeWidth="3"
                          fill="none"
                        />
                      ) : shape.type === "text" ? (
                        <text
                          key={index}
                          x={shape.x}
                          y={(shape.y || 0) + (shape.fontSize || 18)}
                          fontSize={shape.fontSize}
                        >
                          {shape.text}
                        </text>
                      ) : null,
                    )}
                  </svg>
                  <span>{name}</span>
                </button>
              ),
            )}
          </div>
        </section>
      )}
      {!open && selected && !["ruler", "protractor"].includes(selected.kind) && (
        <section
          className="fc-widget-panel fc-surface"
          role="dialog"
          aria-label={`${teachingTools[selected.kind]}参数`}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <header>
            <strong>{teachingTools[selected.kind]}</strong>
            <button
              aria-label="收起工具参数"
              onClick={() => {
                if (classroomCommands.has("document.select")) {
                  void classroomCommands.execute({
                    name: "document.select",
                    args: { ids: [] },
                  });
                } else {
                  api.updateScene({ appState: { selectedElementIds: {} } });
                }
              }}
            >
              {CloseIcon}
            </button>
          </header>
          <div className="fc-widget-body">
            {(parameters[selected.kind] || []).map((key) => {
              const limits = ranges[key as keyof typeof ranges];
              return (
                <label key={key}>
                  {labels[key]}{" "}
                  <output>{Number(selected.params[key]).toFixed(1)}</output>
                  <input
                    aria-label={labels[key]}
                    type="range"
                    min={limits[0]}
                    max={limits[1]}
                    step={limits[2]}
                    value={Number(selected.params[key])}
                    onChange={(event) =>
                      attempt(() =>
                        change({ [key]: Number(event.target.value) }),
                      )
                    }
                  />
                </label>
              );
            })}
            {selected.kind === "timer" && (
              <label>
                时长（分钟）
                <input
                  aria-label="倒计时时长（分钟）"
                  type="number"
                  min="0.1"
                  max="120"
                  step="0.5"
                  value={selected.params.duration / 60}
                  onChange={(event) =>
                    attempt(() =>
                      change({
                        duration: Number(event.target.value) * 60,
                        elapsed: 0,
                        started: Date.now(),
                      }),
                    )
                  }
                />
              </label>
            )}
            {["timer", "pendulum", "projectile"].includes(selected.kind) && (
              <div className="fc-actions">
                <button
                  aria-label={selected.params.running ? "暂停工具" : "播放工具"}
                  onClick={() => attempt(() => play())}
                >
                  {selected.params.running ? "Ⅱ" : playerPlayIcon}
                </button>
                <button
                  onClick={() =>
                    attempt(() => change({ elapsed: 0, started: Date.now() }))
                  }
                >
                  重置
                </button>
              </div>
            )}
            {selected.kind === "pendulum" && <small>小角度单摆模型</small>}
            {selected.kind === "picker" && (
              <label>
                名单
                <textarea
                  aria-label="抽取名单"
                  value={selected.params.names}
                  onChange={(event) =>
                    attempt(() => change({ names: event.target.value }))
                  }
                  placeholder="用逗号或换行分开"
                />
              </label>
            )}
            {["dice", "picker"].includes(selected.kind) && (
              <button onClick={() => attempt(() => random())}>
                {selected.kind === "dice" ? "掷一下" : "抽一个"}
              </button>
            )}
          </div>
        </section>
      )}
      {error && (
        <div className="fc-notice fc-error" role="alert">
          <span>{error}</span>
          <button aria-label="关闭工具提示" onClick={() => setError("")}>
            {CloseIcon}
          </button>
        </div>
      )}
    </>
  );
};
