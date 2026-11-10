import { t, useI18n } from "@fcboard/fcboard/i18n";
import { useEffect, useRef, useState } from "react";
import ButtonBase from "@mui/material/ButtonBase";
import { ToolbarExtras } from "@fcboard/fcboard";
import { getCommonBounds } from "@fcboard/element";
import {
  CloseIcon,
  playerPlayIcon,
  TextIcon,
  microphoneIcon,
} from "@fcboard/fcboard/components/icons";
import { FactoryIcon } from "@fcboard/fcboard/components/FactoryIcon";

import { useToolbarItems } from "@fcboard/fcboard/toolbarPreferences";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { TransientMessage } from "./TransientMessage";

import { NativeToolbarItems } from "./NativeToolbarItems";

import { MaterialPanel } from "./MaterialPanel";

import { insertionPoint, selectedPlot, objectSelection } from "./board";
import { placePanel } from "./floating";
import { classroomCommands } from "./commands";
import { animateSolid } from "./solidAnimation";
import { adaptGizmo, gizmoViewport } from "./adaptiveGizmo";
import { FactoryGizmos } from "./FactoryGizmos";
import { GizmoPicker } from "./GizmoPicker";
import { FactoryShapes } from "./FactoryShapes";
import { Calculator } from "./Calculator";
import { ToolTimer } from "./ToolTimer";
import { Curtain } from "./Curtain";
import { SplitBoard } from "./SplitBoard";
import { Voting } from "./Voting";
import { ToolMedia } from "./ToolMedia";
import curtainIcon from "./assets/curtain/icon.png";

import "./BuiltinTools.scss";
import {
  factoryGizmoColor,
  factoryGizmoKinds,
  GIZMO_UNIT,
} from "./factoryGizmoShapes";
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
  curtain: {
    label: "curtain",
    icon: <img src={curtainIcon} alt="" width={40} height={40} />,
  },
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

export const TeachingTools = ({ api }: { api: FcboardImperativeAPI }) => {
  useI18n();
  const pinned = useToolbarItems();
  const [extended, setExtended] = useState(false);
  const setOpen = (value: boolean) => {
    if (!value) {
      setExtended(false);
    }
    window.dispatchEvent(
      new Event(value ? "fcboard:toolbox-open" : "fcboard:toolbox-close"),
    );
  };
  const [selected, setSelected] = useState<Widget | null>(null);
  const [lassoActive, setLassoActive] = useState(false);
  const selectedRef = useRef<Widget | null>(null);
  const [error, setError] = useState("");
  const factory = [
    "split",
    "vote",
    "calculator",
    "spotlight",
    "timer",
    "curtain",
  ] as const;
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
    if (solidWidgetKinds.has(kind) || factoryGizmoKinds.has(kind)) {
      const document = classroomCommands.read("document") as
        | { pen?: { color: string } }
        | undefined;
      widget.params.solid.stroke = factoryGizmoKinds.has(kind)
        ? factoryGizmoColor(
            document
              ? "#ffffff"
              : api.getAppState().viewBackgroundColor || "#ffffff",
          )
        : document?.pen?.color ||
          api.getAppState().currentItemStrokeColor ||
          "#17243c";
    }
    if (kind === "ruler" || kind === "setSquare") {
      const state = api.getAppState();
      const document = classroomCommands.read("document.layout") as
        | {
            scale?: number;
            viewport?: {
              left: number;
              top: number;
              right: number;
              bottom: number;
            };
          }
        | undefined;
      const scale = document?.scale || state.zoom.value;
      widget.params.factory = true;
      widget.params.size =
        1 / (GIZMO_UNIT * (window.devicePixelRatio || 1) * scale);
      widget.params.gizmo = {
        unit: 1 / ((window.devicePixelRatio || 1) * scale),
        density: window.devicePixelRatio || 1,
      };
      widget.position = document?.viewport
        ? {
            x: (document.viewport.left + document.viewport.right) / 2,
            y: (document.viewport.top + document.viewport.bottom) / 2,
          }
        : {
            x: -state.scrollX + state.width / (2 * state.zoom.value),
            y: -state.scrollY + state.height / (2 * state.zoom.value),
          };
    }
    if (kind === "protractor") {
      const state = api.getAppState();
      const document = classroomCommands.read("document.layout") as
        | {
            scale?: number;
            viewport?: {
              left: number;
              top: number;
              right: number;
              bottom: number;
            };
          }
        | undefined;
      const scale = document?.scale || state.zoom.value;
      const unit = 1 / ((window.devicePixelRatio || 1) * scale);
      // BitmapFactory scales hdpi (1.5) assets to display density; native
      // baseHalfW=bitmap.width/6 and initial protractorScale=0.7.
      const base = 1563 / 1.5 / 3 / 360 / scale;
      widget.params.size = base * 0.7;
      widget.params.factory = true;
      widget.params.gizmo = {
        unit,
        density: window.devicePixelRatio || 1,
        scaleUnit: base,
        needle: (600 * 0.7 * unit) / widget.params.size,
        ball: (80 * 0.7 * unit) / widget.params.size,
      };
      const center = document?.viewport
        ? {
            x:
              (document.viewport.left + document.viewport.right) / 2 +
              300 * unit,
            y:
              (document.viewport.top + document.viewport.bottom) / 2 +
              300 * unit,
          }
        : {
            x:
              -state.scrollX +
              state.width / (2 * state.zoom.value) +
              300 * unit,
            y:
              -state.scrollY +
              state.height / (2 * state.zoom.value) +
              300 * unit,
          };
      widget.position = {
        x: center.x - 180 * widget.params.size,
        y: center.y - 180 * widget.params.size,
      };
    }
    if (kind === "compass") {
      const state = api.getAppState();
      const document = classroomCommands.read("document.layout") as
        | {
            scale?: number;
            viewport?: {
              left: number;
              top: number;
              right: number;
              bottom: number;
            };
          }
        | undefined;
      const scale = document?.scale || state.zoom.value;
      const viewport = document?.viewport || {
        left: -state.scrollX,
        top: -state.scrollY,
        right: -state.scrollX + state.width / scale,
        bottom: -state.scrollY + state.height / scale,
      };
      const unit = 1 / ((window.devicePixelRatio || 1) * scale);
      const dp = unit * (window.devicePixelRatio || 1) * 0.66;
      const leg =
        (2 / 3) *
        Math.max(100 * dp, 0.15 * (viewport.right - viewport.left) + 40 * dp);
      const opening = 2 * leg * Math.sin((25 * Math.PI) / 180) * 1.1;
      widget.params.factory = true;
      widget.params.size = 1 / scale;
      widget.params.gizmo = {
        unit,
        density: window.devicePixelRatio || 1,
        leg: leg / widget.params.size,
        opening: opening / widget.params.size,
      };
      widget.position = {
        x: (viewport.left + viewport.right - opening) / 2,
        y:
          viewport.top +
          0.78 * (viewport.bottom - viewport.top) -
          300 * widget.params.size,
      };
    }
    const viewport = factoryGizmoKinds.has(kind)
      ? gizmoViewport(api)
      : undefined;
    const elements = renderWidget(
      api,
      viewport ? adaptGizmo(widget, viewport.viewport, viewport.scale) : widget,
      true,
      {
        exact: factoryGizmoKinds.has(kind),
      },
    );
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
    if (factoryGizmoKinds.has(kind)) {
      api.updateScene({
        appState: {
          selectedElementIds: {},
          selectedGroupIds: {},
          whiteboardSelection: undefined,
        },
      });
      api.setActiveTool({ type: "freedraw" });
      if (classroomCommands.has("document.tool")) {
        void classroomCommands.execute({
          name: "document.tool",
          args: { tool: "freedraw" },
        });
      }
    } else {
      api.setActiveTool({ type: "selection" });
    }
    const placed =
      readWidgets(api).find((item) => item.id === widget.id) || widget;
    selectedRef.current = placed;
    setSelected(placed);
    setOpen(false);
  };
  useEffect(() => {
    const registrations = [
      classroomCommands.register(
        "tools.extended",
        "打开已有扩展教学工具",
        async () => {
          if (classroomCommands.has("panel.close")) {
            await classroomCommands.execute({ name: "panel.close" });
          }
          window.dispatchEvent(new Event("fcboard:toolbox-close"));
          setExtended(true);
        },
      ),
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
              `打开应用内置教学工具，不依赖外部APK，args.tool=${factory.join(
                "|",
              )}，依次对应 ${factory
                .map((tool) => t(`fcboard.${factoryTools[tool].label}`))
                .join("、")}`,
              async (args) => {
                const tool = args.tool as FactoryTool;
                if (!(factory as readonly string[]).includes(tool)) {
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
                  await classroomCommands.execute({
                    name: `tools.${tool}`,
                    args: { signal: args.signal },
                  });
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
      data-close-insert
      data-native-tool={kind}
      aria-label={t("fcboard.insert_name", {
        name: t(`fcboard.${teachingTools[kind]}`),
      })}
      style={{
        order: (
          {
            ruler: 3,
            compass: 4,
            protractor: 5,
            setSquare: 6,
            timer: 9,
          } as Partial<Record<WidgetKind, number>>
        )[kind],
      }}
      onClick={() => attempt(() => insert(kind))}
    >
      {factoryGizmoKinds.has(kind) ? (
        <FactoryIcon
          name={
            kind === "setSquare"
              ? "setSquare"
              : (kind as "ruler" | "protractor" | "compass")
          }
        />
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
      data-close-insert
      data-native-tool={
        command === "canvas.summary"
          ? "summary"
          : command === "record.open"
          ? "record"
          : command === "voice.toggle"
          ? "voice"
          : command === "files.open"
          ? "files"
          : command === "assistant.open"
          ? "questions"
          : undefined
      }
      type="button"
      style={{
        order:
          command === "files.open"
            ? 0
            : command === "tools.spotlight"
            ? 8
            : undefined,
      }}
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
  const entries = Object.entries(teachingTools).filter(
    ([kind]) => kind !== "shape",
  ) as [WidgetKind, string][];
  const actions = [
    [t("fcboard.file_transfer"), "files.open", <FactoryIcon name="transfer" />],
    [t("fcboard.ai_summary"), "canvas.summary", TextIcon],
    [t("fcboard.recording"), "record.open", microphoneIcon],
    [t("fcboard.voice_commands"), "voice.toggle", microphoneIcon],
    [
      t("fcboard.ai_questions"),
      "assistant.open",
      <FactoryIcon name="questions" />,
    ],
  ] as const;
  const actionIds = {
    "files.open": "files",
    "canvas.summary": "summary",
    "record.open": "record",
    "assistant.open": "questions",
    "voice.toggle": "voice",
  } as const;
  const factoryButton = (tool: typeof factory[number]) => (
    <ButtonBase
      key={tool}
      type="button"
      data-close-insert
      data-native-tool={tool}
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
  );
  return (
    <>
      {extended && (
        <MaterialPanel
          centered
          role="dialog"
          className="fc-extended-tools"
          aria-label={t("fcboard.teaching_tools")}
          onDismiss={() => setExtended(false)}
        >
          <header>
            <h2>{t("fcboard.teaching_tools")}</h2>
            <button
              type="button"
              aria-label={t("buttons.close")}
              onClick={() => setExtended(false)}
            >
              {CloseIcon}
            </button>
          </header>
          <div className="fc-insert-grid">
            <div
              className="fc-factory-tools"
              role="group"
              aria-label={t("fcboard.display_tools")}
            >
              {factory.map(factoryButton)}
            </div>
            {entries
              .filter(
                ([kind]) => !factoryGizmoKinds.has(kind) || kind === "ruler",
              )
              .map((entry) =>
                entry[0] === "ruler" ? (
                  <GizmoPicker
                    key="gizmos"
                    onInsert={(kind) => attempt(() => insert(kind))}
                  />
                ) : (
                  widgetButton(entry)
                ),
              )}
            {actions.map(actionButton)}
          </div>
        </MaterialPanel>
      )}
      <NativeToolbarItems api={api} />
      <FactoryGizmos api={api} />
      <FactoryShapes api={api} />
      <Calculator />
      <ToolTimer />
      <Curtain />
      <SplitBoard />
      <Voting />
      <ToolMedia />
      <ToolbarExtras placement="toolbox">
        <div
          className="fc-factory-tools"
          role="group"
          aria-label={t("fcboard.display_tools")}
        >
          {factory
            .filter((tool) => tool !== "split" && !pinned.includes(tool))
            .map((tool) => factoryButton(tool))}
        </div>
        {entries
          .filter(([kind]) => kind === "ruler" && !pinned.includes("ruler"))
          .map(() => (
            <GizmoPicker
              key="gizmos"
              onInsert={(kind) => attempt(() => insert(kind))}
            />
          ))}
        {actions
          .filter((entry) => !pinned.includes(actionIds[entry[1]]))
          .map(actionButton)}
      </ToolbarExtras>
      {factory.map((tool) => (
        <ToolbarExtras key={tool} toolId={tool}>
          {factoryButton(tool)}
        </ToolbarExtras>
      ))}
      {entries
        .filter(([kind]) => factoryGizmoKinds.has(kind))
        .map((entry) => (
          <ToolbarExtras
            key={entry[0]}
            toolId={
              entry[0] as "ruler" | "compass" | "protractor" | "setSquare"
            }
          >
            {entry[0] === "ruler" ? (
              <GizmoPicker onInsert={(kind) => attempt(() => insert(kind))} />
            ) : (
              widgetButton(entry)
            )}
          </ToolbarExtras>
        ))}
      {actions.map((entry) => (
        <ToolbarExtras key={entry[1]} toolId={actionIds[entry[1]]}>
          {actionButton(entry)}
        </ToolbarExtras>
      ))}
      {!lassoActive &&
        selected &&
        !solidWidgetKinds.has(selected.kind) &&
        selected.kind !== "shape" &&
        !factoryGizmoKinds.has(selected.kind) && (
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
