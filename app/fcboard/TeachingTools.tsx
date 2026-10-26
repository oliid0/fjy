import { t, useI18n } from "@excalidraw/excalidraw/i18n";
import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import ButtonBase from "@mui/material/ButtonBase";
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

import { TransientMessage } from "./TransientMessage";

import { MaterialPanel } from "./MaterialPanel";

import { insertionPoint, selectedPlot, objectSelection } from "./board";
import { useAnchoredPanel, placePanel } from "./floating";
import { classroomCommands } from "./commands";
import { Classroom } from "./native";
import { animateSolid } from "./solidAnimation";
import {
  configureWidget,
  readWidgets,
  renderWidget,
  teachingTools,
  widgetDefaults,
  widgetShapes,
  widgetTime,
  solidWidgetKinds,
} from "./widgets";

import type { Widget, WidgetKind } from "./widgets";
import type { FactoryTool } from "./native";

const factoryTools = {
  transfer: { label: "file_transfer", icon: <FactoryIcon name="transfer" /> },
  split: { label: "split_screen", icon: <FactoryIcon name="split" /> },
  vote: { label: "vote", icon: <FactoryIcon name="vote" /> },
  calculator: { label: "calculator", icon: <FactoryIcon name="calculator" /> },
  spotlight: { label: "spotlight", icon: <FactoryIcon name="spotlight" /> },
  timer: { label: "timer", icon: <FactoryIcon name="timer" /> },
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
  rotation: "rotation",
  size: "size",
  length: "length_l_m",
  gravity: "gravity_g_m_s",
  angle: "initial_angle",
  vx: "horizontal_speed_m_s",
  vy: "vertical_speed_m_s",
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
  const animations = useRef(new Map<string, AbortController>());
  useEffect(() => {
    const active = animations.current;
    return () => {
      active.forEach((controller) => controller.abort());
      active.clear();
    };
  }, []);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    let disposed = false;
    Classroom.getFactoryTools()
      .then(({ available }) => {
        if (!disposed) {
          setFactory(
            (Object.keys(factoryTools) as FactoryTool[]).filter(
              (tool) => tool !== "transfer" && available.includes(tool),
            ),
          );
        }
      })
      .catch((failure) => {
        if (!disposed) {
          setError(
            t("fcboard.could_not_read_board_tools_error", {
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
  const change = async (changes: Record<string, unknown>, id?: string) => {
    const targetId = id || selectedRef.current?.id;
    if (targetId) {
      animations.current.get(targetId)?.abort();
    }
    let widget = readWidgets(api).find((item) => item.id === targetId);
    if (!widget) {
      throw new Error(t("fcboard.select_a_teaching_tool_first"));
    }
    if (changes.solid && !solidWidgetKinds.has(widget.kind)) {
      throw new Error(
        t("fcboard.teaching_tool_parameter_key_is_out_of_range", {
          key: "solid",
        }),
      );
    }
    const next = { ...widget, params: configureWidget(widget.params, changes) };
    if (
      !["cube", "cylinder"].includes(widget.kind) &&
      (next.params.solid.unfold !== widget.params.solid.unfold ||
        next.params.solid.net !== widget.params.solid.net ||
        JSON.stringify(next.params.solid.colors) !==
          JSON.stringify(widget.params.solid.colors))
    ) {
      throw new Error(
        t("fcboard.teaching_tool_parameter_key_is_out_of_range", {
          key: "solid",
        }),
      );
    }
    let ids: string[];
    if (
      changes.solid &&
      (widget.params.solid.unfold !== next.params.solid.unfold ||
        (widget.params.solid.net !== next.params.solid.net &&
          widget.params.solid.unfold > 0))
    ) {
      const rollback = widget;
      const document = classroomCommands.read("document") as
        | { ink: import("./documents").InkStroke[] }
        | undefined;
      const before = document?.ink.filter(
        (stroke) => stroke.widget?.id === widget!.id,
      );
      const controller = new AbortController();
      const signal =
        changes.signal instanceof AbortSignal ? changes.signal : undefined;
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) {
        controller.abort();
      }
      animations.current.set(widget.id, controller);
      const duration = matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : 600;
      try {
        if (
          widget.params.solid.net !== next.params.solid.net &&
          widget.params.solid.unfold > 0
        ) {
          await animateSolid(
            api,
            widget,
            {
              ...widget,
              params: {
                ...widget.params,
                solid: { ...widget.params.solid, unfold: 0 },
              },
            },
            controller.signal,
            duration,
            { remember: false },
          );
          widget = readWidgets(api).find((item) => item.id === targetId)!;
        }
        ids = (
          await animateSolid(api, widget, next, controller.signal, duration, {
            before,
            rollback,
          })
        ).ids;
      } finally {
        signal?.removeEventListener("abort", abort);
        if (animations.current.get(targetId!) === controller) {
          animations.current.delete(targetId!);
        }
      }
    } else {
      if (changes.signal instanceof AbortSignal) {
        changes.signal.throwIfAborted();
      }
      ids = renderWidget(api, next).map((element) => element.id);
    }
    const actual = readWidgets(api).find((item) => item.id === targetId);
    selectedRef.current = actual || null;
    setSelected(actual || null);
    return { ids };
  };
  const play = (enabled?: boolean, id?: string) => {
    const widget = id
      ? readWidgets(api).find((item) => item.id === id)
      : selectedRef.current;
    if (!widget || !["timer", "pendulum", "projectile"].includes(widget.kind)) {
      throw new Error(t("fcboard.select_a_timer_or_animated_experiment"));
    }
    const running = enabled === undefined ? !widget.params.running : enabled;
    return change(
      { running, elapsed: widgetTime(widget.params), started: Date.now() },
      widget.id,
    );
  };
  const random = (id?: string) => {
    const widget = id
      ? readWidgets(api).find((item) => item.id === id)
      : selectedRef.current;
    if (!widget || !["dice", "picker"].includes(widget.kind)) {
      throw new Error(t("fcboard.select_dice_or_random_picker"));
    }
    const choices =
      widget.kind === "dice"
        ? ["1", "2", "3", "4", "5", "6"]
        : widget.params.names
            .split(/[,，\n]/)
            .map((name) => name.trim())
            .filter(Boolean);
    if (!choices.length) {
      throw new Error(t("fcboard.enter_the_names_first"));
    }
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return change({ choice: choices[values[0] % choices.length] }, widget.id);
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
    if (solidWidgetKinds.has(kind)) {
      const document = classroomCommands.read("document") as
        | { pen?: { color: string } }
        | undefined;
      widget.params.solid.stroke =
        document?.pen?.color ||
        api.getAppState().currentItemStrokeColor ||
        "#17243c";
    }
    const elements = renderWidget(api, widget);
    if (classroomCommands.has("document.select")) {
      void classroomCommands.execute({
        name: "document.select",
        args: { ids: elements.map((el) => el.id) },
      });
    } else {
      api.updateScene({
        appState: objectSelection(elements),
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
            throw new Error(t("fcboard.this_teaching_tool_is_unavailable"));
          }
          insert(args.kind as WidgetKind);
        },
      ),
      classroomCommands.register(
        "tools.configure",
        "修改选中教学工具或args.id指定工具；参数 args.rotation,size,length,gravity,angle,vx,vy,duration(秒),names；图形可带solid:{stroke:十六进制颜色,border:boolean}；仅立方体/圆柱另支持solid:{unfold:0|1,net:从0开始的网格索引,colors:{面id:十六进制颜色}}；展开/合起有动画，颜色绑定物理面",
        (args) =>
          change(args, typeof args.id === "string" ? args.id : undefined),
      ),
      classroomCommands.register(
        "tools.delete",
        "删除args.id指定的整个教学对象，包含全部面和边",
        async (args) => {
          const id =
            typeof args.id === "string" ? args.id : selectedRef.current?.id;
          if (id) {
            animations.current.get(id)?.abort();
          }
          if (!id || !readWidgets(api).some((widget) => widget.id === id)) {
            throw new Error(t("fcboard.select_a_teaching_tool_first"));
          }
          const document = classroomCommands.read("document") as
            | { ink: { id: string; widget?: Widget }[] }
            | undefined;
          const ids = document
            ? document.ink
                .filter((stroke) => stroke.widget?.id === id)
                .map((stroke) => stroke.id)
            : api
                .getSceneElements()
                .filter((element) => element.customData?.fcWidget?.id === id)
                .map((element) => element.id);
          return classroomCommands.execute({
            name: "canvas.erase",
            args: { ids },
          });
        },
      ),
      classroomCommands.register(
        "tools.duplicate",
        "复制args.id指定的整个教学对象及逐面颜色，保留原对象",
        async (args) => {
          const id =
            typeof args.id === "string" ? args.id : selectedRef.current?.id;
          if (id) {
            animations.current.get(id)?.abort();
          }
          const widget = readWidgets(api).find((item) => item.id === id);
          if (!widget) {
            throw new Error(t("fcboard.select_a_teaching_tool_first"));
          }
          const clone = {
            ...widget,
            id: crypto.randomUUID(),
            params: configureWidget(widgetDefaults(), widget.params),
            position: { x: widget.position.x + 24, y: widget.position.y + 24 },
          };
          const elements = renderWidget(api, clone);
          const ids = elements.map((element) => element.id);
          if (classroomCommands.has("document.select")) {
            await classroomCommands.execute({
              name: "document.select",
              args: { ids },
            });
          } else {
            api.updateScene({
              appState: objectSelection(elements),
            });
          }
          return { id: clone.id, ids };
        },
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
                  throw new Error(
                    t("fcboard.this_tool_is_not_installed_on_this_display"),
                  );
                }
                if (factoryBusy.current) {
                  throw new Error(
                    t("fcboard.opening_the_display_tool_please_wait"),
                  );
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
  const attempt = (operation: () => unknown | Promise<unknown>) => {
    try {
      setError("");
      void Promise.resolve(operation()).catch((failure) => {
        if (
          !(failure instanceof DOMException && failure.name === "AbortError")
        ) {
          setError(String(failure));
        }
      });
    } catch (failure) {
      setError(String(failure));
    }
  };
  const widgetButton = ([kind, name]: [WidgetKind, string]) => (
    <ButtonBase
      key={kind}
      aria-label={t("fcboard.insert_name", {
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
    </ButtonBase>
  );
  const actionButton = ([label, command, icon]: readonly [
    string,
    string,
    React.ReactNode,
  ]) => (
    <ButtonBase
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
    </ButtonBase>
  );
  const entries = Object.entries(teachingTools) as [WidgetKind, string][];
  const solids = solidWidgetKinds;
  return (
    <>
      <ToolbarExtras placement="shapes">
        {entries.filter(([kind]) => solids.has(kind)).map(widgetButton)}
      </ToolbarExtras>
      <ToolbarExtras>
        <div className="fc-toolbar-extras">
          <button
            data-teaching-tools
            aria-label={t("fcboard.teaching_tools")}
            title={t("fcboard.teaching_tools")}
            aria-expanded={open}
            onClick={() => {
              if (classroomCommands.has("panel.close")) {
                void classroomCommands.execute({ name: "panel.close" });
              }
              setOpen(!open);
            }}
          >
            <FactoryIcon name="toolbox" />
            <span>{t("fcboard.toolbox")}</span>
          </button>
        </div>
      </ToolbarExtras>
      {open && (
        <MaterialPanel
          ref={panel}
          className="fc-tools-picker fc-surface"
          style={pickerStyle}
          role="dialog"
          aria-label={t("fcboard.teaching_tools")}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        >
          <header>
            <strong>{t("fcboard.teaching_tools")}</strong>
            <button
              aria-label={t("fcboard.close_teaching_tools")}
              onClick={() => setOpen(false)}
            >
              {CloseIcon}
            </button>
          </header>
          {factoryLoading && (
            <p role="status">{t("fcboard.loading_display_tools")}</p>
          )}
          {factory.some((tool) => tool !== "transfer") && (
            <>
              <div
                className="fc-tools-grid fc-factory-tools"
                role="group"
                aria-label={t("fcboard.display_tools")}
              >
                {factory
                  .filter((tool) => tool !== "transfer")
                  .map((tool) => (
                    <ButtonBase
                      key={tool}
                      type="button"
                      aria-label={t("fcboard.open_name", {
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
                          ? t("fcboard.opening")
                          : t(`fcboard.${factoryTools[tool].label}`)}
                      </span>
                    </ButtonBase>
                  ))}
              </div>
            </>
          )}
          <div className="fc-tools-grid">
            {entries
              .filter(
                ([kind]) =>
                  !solids.has(kind) &&
                  (kind !== "timer" || !factory.includes("timer")),
              )
              .map(widgetButton)}
            {(
              [
                [t("fcboard.ai_summary"), "canvas.summary", TextIcon],
                [t("fcboard.recording"), "record.open", microphoneIcon],
                [
                  t("fcboard.file_transfer"),
                  "files.open",
                  <FactoryIcon name="transfer" />,
                ],
                [t("fcboard.ai_questions"), "assistant.open", questionCircle],
                [
                  t("fcboard.spotlight"),
                  "tools.spotlight",
                  <FactoryIcon name="spotlight" />,
                ],
              ] as const
            )
              .filter(
                ([, command]) =>
                  command !== "tools.spotlight" ||
                  !factory.includes("spotlight"),
              )
              .map(actionButton)}
            {(
              [
                [t("fcboard.voice_commands"), "voice.toggle", microphoneIcon],
                [
                  t("fcboard.capture"),
                  "canvas.capture",
                  <FactoryIcon name="select" />,
                ],
              ] as const
            ).map(actionButton)}
          </div>
        </MaterialPanel>
      )}
      {!open &&
        !lassoActive &&
        selected &&
        !solidWidgetKinds.has(selected.kind) &&
        !["ruler", "protractor"].includes(selected.kind) && (
          <MaterialPanel
            className="fc-widget-panel fc-surface"
            style={{
              ...widgetPlacement,
              right: "auto",
              bottom: "auto",
              width: "min(280px, calc(100% - 24px))",
              maxHeight: `calc(100% - ${widgetPlacement.top + 92}px)`,
            }}
            role="dialog"
            aria-label={t("fcboard.name_controls", {
              name: t(`fcboard.${teachingTools[selected.kind]}`),
            })}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <header>
              <strong>{t(`fcboard.${teachingTools[selected.kind]}`)}</strong>
              <button
                aria-label={t("fcboard.close_tool_controls")}
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
                  {t("fcboard.duration_minutes")}
                  <input
                    aria-label={t("fcboard.countdown_duration_minutes")}
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
                        ? t("fcboard.pause_tool")
                        : t("fcboard.play_tool")
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
                    {t("fcboard.reset")}
                  </button>
                </div>
              )}
              {selected.kind === "pendulum" && (
                <small>{t("fcboard.small_angle_pendulum_model")}</small>
              )}
              {selected.kind === "picker" && (
                <label>
                  {t("fcboard.names")}
                  <textarea
                    aria-label={t("fcboard.picker_names")}
                    value={selected.params.names}
                    onChange={(event) =>
                      attempt(() => change({ names: event.target.value }))
                    }
                    placeholder={t("fcboard.separate_with_commas_or_new_lines")}
                  />
                </label>
              )}
              {["dice", "picker"].includes(selected.kind) && (
                <button onClick={() => attempt(() => random())}>
                  {selected.kind === "dice"
                    ? t("fcboard.roll_dice")
                    : t("fcboard.pick_one")}
                </button>
              )}
            </div>
          </MaterialPanel>
        )}
      <TransientMessage
        message={error}
        role="alert"
        className="fc-notice fc-error"
      />
    </>
  );
};
