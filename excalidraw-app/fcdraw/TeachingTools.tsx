import { t, useI18n } from "@excalidraw/excalidraw/i18n";
import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { ToolbarExtras } from "@excalidraw/excalidraw";
import { getCommonBounds } from "@excalidraw/element";
import {
  CloseIcon,
  playerPlayIcon,
  TextIcon,
  microphoneIcon,
  questionCircle,
} from "@excalidraw/excalidraw/components/icons";
import { FactoryIcon } from "@excalidraw/excalidraw/components/FactoryIcon";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { insertionPoint, selectedPlot } from "./board";
import { useAnchoredPanel, placePanel } from "./floating";
import { classroomCommands } from "./commands";
import { Classroom } from "./native";
import {
  configureWidget,
  readWidgets,
  renderWidget,
  teachingTools,
  widgetDefaults,
  widgetShapes,
  widgetTime,
} from "./widgets";

import type { Widget, WidgetKind } from "./widgets";
import type { FactoryTool } from "./native";

const factoryTools = {
  transfer: { label: "快传", icon: <FactoryIcon name="transfer" /> },
  split: { label: "分屏", icon: <FactoryIcon name="split" /> },
  vote: { label: "投票", icon: <FactoryIcon name="vote" /> },
  calculator: { label: "计算器", icon: <FactoryIcon name="calculator" /> },
  spotlight: { label: "聚光灯", icon: <FactoryIcon name="spotlight" /> },
  timer: { label: "计时器", icon: <FactoryIcon name="timer" /> },
} as const;

const parameters: Partial<Record<WidgetKind, (keyof typeof ranges)[]>> = {
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
const labels = {
  rotation: "旋转",
  size: "大小",
  length: "摆长 L（m）",
  gravity: "重力 g（m/s²）",
  angle: "初始角度 θ（°）",
  vx: "水平速度（m/s）",
  vy: "竖直速度（m/s）",
} as const;

export const TeachingTools = ({ api }: { api: ExcalidrawImperativeAPI }) => {
  useI18n();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Widget | null>(null);
  const [lassoActive, setLassoActive] = useState(false);
  const selectedRef = useRef<Widget | null>(null);
  const panel = useRef<HTMLElement>(null);
  const pickerStyle = useAnchoredPanel(panel, "[data-teaching-tools]", open);
  const [error, setError] = useState("");
  const [factory, setFactory] = useState<FactoryTool[]>([]);
  const [factoryLoading, setFactoryLoading] = useState(
    Capacitor.isNativePlatform,
  );
  const [factoryPending, setFactoryPending] = useState<FactoryTool>();
  const factoryBusy = useRef(false);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    let disposed = false;
    Classroom.getFactoryTools()
      .then(({ available }) => {
        if (!disposed) {
          setFactory(
            (Object.keys(factoryTools) as FactoryTool[]).filter((tool) =>
              available.includes(tool),
            ),
          );
        }
      })
      .catch((failure) => {
        if (!disposed) {
          setError(
            t("fcboard.无法读取大屏工具：{{error}}", {
              error: String(failure),
            }),
          );
        }
      })
      .finally(() => {
        if (!disposed) {
          setFactoryLoading(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, []);
  const [widgetPlacement, setWidgetPlacement] = useState({ left: 12, top: 12 });
  useEffect(() => {
    const refresh = () => {
      const state = api.getAppState();
      setLassoActive(state.activeTool?.type === "lasso");
      if (state.toolbarHidden) {
        setOpen(false);
      }
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
      if (next) {
        const stage = window.document
          .querySelector(".fc-document-stage")
          ?.getBoundingClientRect();
        const items = api
          .getSceneElements()
          .filter((el) => el.customData?.fcWidget?.id === next.id);
        if ((document && stage) || items.length) {
          const bounds =
            document && stage
              ? [
                  next.position.x - 200,
                  next.position.y - 200,
                  next.position.x + 220,
                  next.position.y + 240,
                ]
              : getCommonBounds(items);
          const scale =
            document && stage ? stage.width / 1000 : state.zoom.value;
          const x =
            document && stage
              ? stage.left - state.offsetLeft
              : state.scrollX * scale;
          const y =
            document && stage
              ? stage.top - state.offsetTop
              : state.scrollY * scale;
          const placement = placePanel(
            {
              left: x + bounds[0] * scale,
              top: y + bounds[1] * scale,
              right: x + bounds[2] * scale,
              bottom: y + bounds[3] * scale,
            },
            { width: state.width, height: state.height - 92 },
          );
          setWidgetPlacement((previous) =>
            previous.left === placement.left && previous.top === placement.top
              ? previous
              : { left: placement.left, top: placement.top },
          );
        }
      }
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
      throw new Error(t("fcboard.请先选择一个教学工具"));
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
      throw new Error(t("fcboard.请选择计时器或动态实验"));
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
      throw new Error(t("fcboard.请选择骰子或随机抽取工具"));
    }
    const choices =
      widget.kind === "dice"
        ? ["1", "2", "3", "4", "5", "6"]
        : widget.params.names
            .split(/[,，\n]/)
            .map((name) => name.trim())
            .filter(Boolean);
    if (!choices.length) {
      throw new Error(t("fcboard.请先输入抽取名单"));
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
    const placed =
      readWidgets(api).find((item) => item.id === widget.id) || widget;
    selectedRef.current = placed;
    setSelected(placed);
    setOpen(false);
  };
  useEffect(() => {
    const registrations = [
      classroomCommands.register("tools.open", "展开教学工具", () => {
        if (classroomCommands.has("panel.close")) {
          void classroomCommands.execute({ name: "panel.close" });
        }
        api.updateScene({ appState: { toolbarHidden: false } });
        setOpen(true);
      }),
      classroomCommands.register(
        "tools.insert",
        `插入原生教学工具，args.kind=${Object.keys(teachingTools).join("|")}`,
        (args) => {
          if (!(String(args.kind) in teachingTools)) {
            throw new Error(t("fcboard.教学工具不存在"));
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
        factory,
      })),
      ...(factory.length
        ? [
            classroomCommands.register(
              "tools.factory",
              `打开大屏原厂应用，args.tool=${factory.join(
                "|",
              )}，依次对应 ${factory
                .map((tool) => t(`fcboard.${factoryTools[tool].label}`))
                .join("、")}`,
              async (args) => {
                const tool = args.tool as FactoryTool;
                if (!factory.includes(tool)) {
                  throw new Error(t("fcboard.当前设备没有这项大屏工具"));
                }
                if (factoryBusy.current) {
                  throw new Error(t("fcboard.正在打开大屏工具，请稍候"));
                }
                factoryBusy.current = true;
                setFactoryPending(tool);
                setError("");
                try {
                  await Classroom.openFactoryTool({ tool });
                  setOpen(false);
                  return { opened: tool };
                } catch (failure) {
                  setError(String(failure));
                  throw failure;
                } finally {
                  factoryBusy.current = false;
                  setFactoryPending(undefined);
                }
              },
            ),
          ]
        : []),
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
  const widgetButton = ([kind, name]: [WidgetKind, string]) => (
    <button
      key={kind}
      aria-label={t("fcboard.插入{{name}}", {
        name: t(`fcboard.${teachingTools[kind]}`),
      })}
      onClick={() => attempt(() => insert(kind))}
    >
      {kind === "ruler" || kind === "protractor" ? (
        <FactoryIcon name={kind} />
      ) : (
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
                    ([x, y]) => `${x + (shape.x || 0)},${y + (shape.y || 0)}`,
                  )
                  .join(" ")}
                stroke="#245bd6"
                strokeWidth="3"
                fill="none"
              />
            ) : shape.type === "ellipse" || shape.type === "rectangle" ? (
              <rect
                key={index}
                x={shape.x}
                y={shape.y}
                width={shape.width}
                height={shape.height}
                rx={shape.type === "ellipse" ? (shape.width || 0) / 2 : 4}
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
      )}
      <span>{t(`fcboard.${teachingTools[kind]}`)}</span>
    </button>
  );
  const actionButton = ([label, command, icon]: readonly [
    string,
    string,
    React.ReactNode,
  ]) => (
    <button
      key={command}
      type="button"
      onClick={() => {
        setOpen(false);
        void classroomCommands
          .execute({
            name: "ui.invoke",
            args: { command, origin: "tools" },
          })
          .catch((failure) => setError(String(failure)));
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
  const entries = Object.entries(teachingTools) as [WidgetKind, string][];
  const primary = new Set<WidgetKind>([
    "ruler",
    "protractor",
    ...(!factory.includes("timer") ? ["timer" as const] : []),
  ]);
  return (
    <>
      <ToolbarExtras>
        <div className="fc-toolbar-extras">
          <button
            data-teaching-tools
            aria-label={t("fcboard.教学工具")}
            title={t("fcboard.教学工具")}
            aria-expanded={open}
            onClick={() => {
              if (classroomCommands.has("panel.close")) {
                void classroomCommands.execute({ name: "panel.close" });
              }
              setOpen(!open);
            }}
          >
            <FactoryIcon name="toolbox" />
            <span>{t("fcboard.工具箱")}</span>
          </button>
        </div>
      </ToolbarExtras>
      {open && (
        <section
          ref={panel}
          className="fc-tools-picker fc-surface"
          style={pickerStyle}
          role="dialog"
          aria-label={t("fcboard.教学工具")}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        >
          <header>
            <strong>{t("fcboard.教学工具")}</strong>
            <button
              aria-label={t("fcboard.关闭教学工具")}
              onClick={() => setOpen(false)}
            >
              {CloseIcon}
            </button>
          </header>
          {factoryLoading && (
            <p role="status">{t("fcboard.正在读取大屏工具…")}</p>
          )}
          {!factoryLoading &&
            Capacitor.isNativePlatform() &&
            !factory.length && (
              <p role="status">
                {t("fcboard.当前设备未提供出厂工具，可继续使用白板教具。")}
              </p>
            )}
          {factory.length > 0 && (
            <>
              <div
                className="fc-tools-grid fc-factory-tools"
                role="group"
                aria-label={t("fcboard.大屏工具")}
              >
                {factory.map((tool) => (
                  <button
                    key={tool}
                    type="button"
                    aria-label={t("fcboard.打开{{name}}", {
                      name: t(`fcboard.${factoryTools[tool].label}`),
                    })}
                    disabled={!!factoryPending}
                    aria-busy={factoryPending === tool}
                    onClick={() => {
                      void classroomCommands
                        .execute({ name: "tools.factory", args: { tool } })
                        .catch((failure) => setError(String(failure)));
                    }}
                  >
                    {factoryTools[tool].icon}
                    <span>
                      {factoryPending === tool
                        ? t("fcboard.正在打开…")
                        : t(`fcboard.${factoryTools[tool].label}`)}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="fc-tools-grid">
            {entries.filter(([kind]) => primary.has(kind)).map(widgetButton)}
            {(
              [
                [t("fcboard.AI 总结"), "canvas.summary", TextIcon],
                [t("fcboard.课堂录制"), "record.open", microphoneIcon],
                [
                  t("fcboard.快传"),
                  "files.open",
                  <FactoryIcon name="transfer" />,
                ],
                [t("fcboard.AI 问答"), "assistant.open", questionCircle],
              ] as const
            )
              .filter(
                ([, command]) =>
                  command !== "files.open" || !factory.includes("transfer"),
              )
              .map(actionButton)}
          </div>
          <details className="fc-tools-more">
            <summary>{t("fcboard.更多工具")}</summary>
            <div className="fc-tools-grid">
              {entries.filter(([kind]) => !primary.has(kind)).map(widgetButton)}
              {(
                [
                  [t("fcboard.语音指令"), "voice.toggle", microphoneIcon],
                  [
                    t("fcboard.截屏"),
                    "canvas.capture",
                    <FactoryIcon name="select" />,
                  ],
                ] as const
              ).map(actionButton)}
            </div>
          </details>
        </section>
      )}
      {!open &&
        !lassoActive &&
        selected &&
        !["ruler", "protractor"].includes(selected.kind) && (
          <section
            className="fc-widget-panel fc-surface"
            style={{
              ...widgetPlacement,
              right: "auto",
              bottom: "auto",
              width: "min(280px, calc(100% - 24px))",
              maxHeight: `calc(100% - ${widgetPlacement.top + 92}px)`,
            }}
            role="dialog"
            aria-label={t("fcboard.{{name}}参数", {
              name: t(`fcboard.${teachingTools[selected.kind]}`),
            })}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <header>
              <strong>{t(`fcboard.${teachingTools[selected.kind]}`)}</strong>
              <button
                aria-label={t("fcboard.收起工具参数")}
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
                    {t(`fcboard.${labels[key]}`)}{" "}
                    <output>{Number(selected.params[key]).toFixed(1)}</output>
                    <input
                      aria-label={t(`fcboard.${labels[key]}`)}
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
                  {t("fcboard.时长（分钟）")}
                  <input
                    aria-label={t("fcboard.倒计时时长（分钟）")}
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
                    aria-label={
                      selected.params.running
                        ? t("fcboard.暂停工具")
                        : t("fcboard.播放工具")
                    }
                    onClick={() => attempt(() => play())}
                  >
                    {selected.params.running ? "Ⅱ" : playerPlayIcon}
                  </button>
                  <button
                    onClick={() =>
                      attempt(() => change({ elapsed: 0, started: Date.now() }))
                    }
                  >
                    {t("fcboard.重置")}
                  </button>
                </div>
              )}
              {selected.kind === "pendulum" && (
                <small>{t("fcboard.小角度单摆模型")}</small>
              )}
              {selected.kind === "picker" && (
                <label>
                  {t("fcboard.名单")}
                  <textarea
                    aria-label={t("fcboard.抽取名单")}
                    value={selected.params.names}
                    onChange={(event) =>
                      attempt(() => change({ names: event.target.value }))
                    }
                    placeholder={t("fcboard.用逗号或换行分开")}
                  />
                </label>
              )}
              {["dice", "picker"].includes(selected.kind) && (
                <button onClick={() => attempt(() => random())}>
                  {selected.kind === "dice"
                    ? t("fcboard.掷一下")
                    : t("fcboard.抽一个")}
                </button>
              )}
            </div>
          </section>
        )}
      {error && (
        <div className="fc-notice fc-error" role="alert">
          <span>{error}</span>
          <button
            aria-label={t("fcboard.关闭工具提示")}
            onClick={() => setError("")}
          >
            {CloseIcon}
          </button>
        </div>
      )}
    </>
  );
};
