import { useEffect, useRef, useState } from "react";
import { t, useI18n } from "@fcboard/fcboard/i18n";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { classroomCommands } from "./commands";
import {
  factoryGizmoKinds,
  gizmoLayout,
  gizmoPoint,
  GIZMO_UNIT,
  compassGeometry,
} from "./factoryGizmoShapes";
import { readWidgets, renderWidget } from "./widgets";
import {
  adaptGizmo,
  compactGizmoControl,
  gizmoViewport,
} from "./adaptiveGizmo";
import deleteIcon from "./factory-gizmo-icons/delete.svg?url";
import rotateIcon from "./factory-gizmo-icons/rotate.svg?url";
import stretchIcon from "./factory-gizmo-icons/stretch.svg?url";
import compassStretchIcon from "./factory-gizmo-icons/compass_stretch.svg?url";
import compassRotateIcon from "./factory-gizmo-icons/rotate_button.svg?url";
import drawAngleIcon from "./factory-gizmo-icons/draw_angle.svg?url";
import drawAngleDownIcon from "./factory-gizmo-icons/draw_angle_down.svg?url";
import drawSectorIcon from "./factory-gizmo-icons/draw_complete_arc.svg?url";
import drawSectorDownIcon from "./factory-gizmo-icons/draw_complete_arc_down.svg?url";
import drawArcIcon from "./factory-gizmo-icons/draw_arc.svg?url";
import drawArcDownIcon from "./factory-gizmo-icons/draw_arc_down.svg?url";
import { TransientMessage } from "./TransientMessage";
import { forwardEraseContact } from "./canvasContact";

import type { PointerEvent as ReactPointerEvent } from "react";

import type { InkStroke } from "./documents";
import type { Widget } from "./widgets";

type Action =
  | "move"
  | "delete"
  | "pinch"
  | "rotate"
  | "resize"
  | "line"
  | "verticalLine"
  | "needle"
  | "drawArc";
type Gesture = {
  id: number;
  action: Action;
  original: Widget;
  next: Widget;
  start: [number, number];
  points: [number, number][];
  before?: InkStroke[];
  target: string;
  revision: number;
  lastAngle?: number;
  sweep: number;
  pinch?: { span: number };
};
const degrees = (value: number) => ((value + 540) % 360) - 180;

/** Native GizmoLayer actions share the existing widget transaction and ink commands.
 * The transparent body moves the tool; its outside edge draws constrained ink. */
export const FactoryGizmos = ({ api }: { api: FcboardImperativeAPI }) => {
  useI18n();
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [view, setView] = useState({
    x: 0,
    y: 0,
    scale: 1,
    hidden: false,
    selecting: false,
    document: false,
  });
  const [preview, setPreview] = useState<[number, number][]>([]);
  const [error, setError] = useState("");
  const [pressed, setPressed] = useState("");
  const contacts = useRef(new Map<number, [number, number]>());
  const actionPress = useRef<
    { id: string; mode: string; pointer: number } | undefined
  >(undefined);
  const gesture = useRef<Gesture | undefined>(undefined);
  const liveWidgetIds = useRef(new Set<string>());
  const layer = useRef<SVGSVGElement>(null);
  const previewFrame = useRef<number | undefined>(undefined);
  const cancelPreview = () => {
    if (previewFrame.current !== undefined) {
      cancelAnimationFrame(previewFrame.current);
      previewFrame.current = undefined;
    }
  };
  const handlers = useRef<
    | {
        move: (event: ReactPointerEvent) => void;
        finish: (event: ReactPointerEvent) => void;
      }
    | undefined
  >(undefined);
  const identity = () => {
    const document = classroomCommands.read("document") as
      | { id?: string; page?: number }
      | undefined;
    const board = classroomCommands.read("boards") as
      | { active?: string }
      | undefined;
    return document
      ? `document:${document.id}:${document.page}`
      : `board:${board?.active || api.id}`;
  };
  const restore = () => {
    cancelPreview();
    contacts.current.clear();
    actionPress.current = undefined;
    setPressed("");
    const active = gesture.current;
    gesture.current = undefined;
    setPreview([]);
    if (
      active &&
      active.target === identity() &&
      active.revision === classroomCommands.revision &&
      readWidgets(api).some((item) => item.id === active.original.id)
    ) {
      try {
        renderWidget(api, active.original, false, { preview: true });
      } catch (failure) {
        setError(String(failure));
      }
    }
  };
  useEffect(() => {
    const refresh = () => {
      const state = api.getAppState();
      const document = classroomCommands.read("document") as
        | { zoom?: number; tool?: string }
        | undefined;
      const stage = document
        ? window.document
            .querySelector(".fc-document-stage")
            ?.getBoundingClientRect()
        : undefined;
      const nextView = {
        x: stage
          ? stage.left - state.offsetLeft
          : state.scrollX * state.zoom.value,
        y: stage
          ? stage.top - state.offsetTop
          : state.scrollY * state.zoom.value,
        scale: stage ? stage.width / 1000 : state.zoom.value,
        hidden: !!state.viewModeEnabled,
        document: !!document,
        selecting: ["selection", "lasso"].includes(
          document?.tool || state.activeTool.type,
        ),
      };
      setView((previous) =>
        previous.x === nextView.x &&
        previous.y === nextView.y &&
        previous.scale === nextView.scale &&
        previous.hidden === nextView.hidden &&
        previous.selecting === nextView.selecting &&
        previous.document === nextView.document
          ? previous
          : nextView,
      );
      const nextWidgets = readWidgets(api).filter((widget) =>
        factoryGizmoKinds.has(widget.kind),
      );
      liveWidgetIds.current = new Set(nextWidgets.map((widget) => widget.id));
      setWidgets((previous) =>
        JSON.stringify(previous) === JSON.stringify(nextWidgets)
          ? previous
          : nextWidgets,
      );
    };
    const stop = api.onChange(refresh);
    const document = classroomCommands.watch("document", refresh);
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const resize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        restore();
        const { viewport, scale } = gizmoViewport(api);
        for (const widget of readWidgets(api).filter((item) =>
          factoryGizmoKinds.has(item.kind),
        )) {
          const next = adaptGizmo(widget, viewport, scale);
          if (JSON.stringify(next) !== JSON.stringify(widget)) {
            renderWidget(api, next, false);
          }
        }
        refresh();
      }, 120);
    };
    const blur = () => restore();
    const outsideMove = (event: PointerEvent) => {
      if (
        !(event.target instanceof Node) ||
        !layer.current?.contains(event.target)
      ) {
        handlers.current?.move(event as unknown as ReactPointerEvent);
      }
    };
    const outsideUp = (event: PointerEvent) => {
      if (
        !(event.target instanceof Node) ||
        !layer.current?.contains(event.target)
      ) {
        handlers.current?.finish(event as unknown as ReactPointerEvent);
      }
    };
    window.addEventListener("resize", resize);
    window.addEventListener("blur", blur);
    window.addEventListener("pointermove", outsideMove);
    window.addEventListener("pointerup", outsideUp);
    window.addEventListener("pointercancel", blur);
    refresh();
    return () => {
      restore();
      stop();
      document();
      window.removeEventListener("resize", resize);
      clearTimeout(resizeTimer);
      window.removeEventListener("blur", blur);
      window.removeEventListener("pointermove", outsideMove);
      window.removeEventListener("pointerup", outsideUp);
      window.removeEventListener("pointercancel", blur);
    };
    // Restore uses the live command target and gesture ref, never a captured pose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);
  const point = (event: ReactPointerEvent): [number, number] => {
    const bounds = layer.current!.getBoundingClientRect();
    return [
      (event.clientX - bounds.left - view.x) / view.scale,
      (event.clientY - bounds.top - view.y) / view.scale,
    ];
  };
  const local = (widget: Widget, point: [number, number]): [number, number] => {
    const angle = (-widget.params.rotation * Math.PI) / 180;
    const x = (point[0] - widget.position.x) / widget.params.size;
    const y = (point[1] - widget.position.y) / widget.params.size;
    return [
      x * Math.cos(angle) - y * Math.sin(angle),
      x * Math.sin(angle) + y * Math.cos(angle),
    ];
  };
  const ink = (points: [number, number][]) => {
    if (
      points.length < 2 ||
      (Math.hypot(
        points.at(-1)![0] - points[0][0],
        points.at(-1)![1] - points[0][1],
      ) < 1 &&
        points.length === 2)
    ) {
      return;
    }
    void classroomCommands
      .execute({
        name: "canvas.ink",
        args: { strokes: [points], select: false },
      })
      .catch((failure) => setError(String(failure)));
  };
  const begin = (event: ReactPointerEvent, widget: Widget, action: Action) => {
    if (forwardEraseContact(api, event)) {
      return;
    }
    if (view.selecting || event.button > 0) {
      return;
    }
    const active = gesture.current;
    if (active) {
      if (
        widget.kind !== "protractor" ||
        action !== "move" ||
        active.original.id !== widget.id ||
        contacts.current.has(event.pointerId) ||
        contacts.current.size !== 1
      ) {
        return;
      }
      const next = point(event);
      contacts.current.set(event.pointerId, next);
      const [first, second] = [...contacts.current.values()];
      active.action = "pinch";
      active.pinch = {
        span: Math.max(
          1,
          Math.hypot(first[0] - second[0], first[1] - second[1]),
        ),
      };
      event.preventDefault();
      event.stopPropagation();
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch (failure) {
        if (!(failure instanceof Error) || failure.name !== "NotFoundError") {
          restore();
          setError(String(failure));
        }
      }
      return;
    }
    contacts.current.set(event.pointerId, point(event));
    event.preventDefault();
    event.stopPropagation();
    setError("");
    const document = classroomCommands.read("document") as
      | { ink: InkStroke[] }
      | undefined;
    gesture.current = {
      id: event.pointerId,
      action,
      original: widget,
      next: widget,
      start: point(event),
      points: [],
      before: document?.ink.filter((stroke) => stroke.widget?.id === widget.id),
      target: identity(),
      revision: classroomCommands.revision,
      sweep: 0,
    };
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch (failure) {
      // A device can cancel the contact between dispatch and capture.
      if (!(failure instanceof Error) || failure.name !== "NotFoundError") {
        restore();
        setError(String(failure));
      }
    }
  };
  const move = (event: ReactPointerEvent) => {
    const active = gesture.current;
    if (
      !active ||
      (active.action === "pinch"
        ? !contacts.current.has(event.pointerId)
        : active.id !== event.pointerId)
    ) {
      return;
    }
    if (
      active.target !== identity() ||
      active.revision !== classroomCommands.revision ||
      !liveWidgetIds.current.has(active.original.id)
    ) {
      restore();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const current = point(event);
    contacts.current.set(event.pointerId, current);
    const original = active.original;
    const layout = gizmoLayout(original.kind, original.params.stretchX);
    const pivot = gizmoPoint(original, layout.pivot[0], layout.pivot[1]);
    const pose = (rotation: number, size = original.params.size) => {
      const angle = (rotation * Math.PI) / 180;
      return {
        ...original,
        params: { ...original.params, rotation, size },
        position: {
          x:
            pivot[0] -
            size *
              (layout.pivot[0] * Math.cos(angle) -
                layout.pivot[1] * Math.sin(angle)),
          y:
            pivot[1] -
            size *
              (layout.pivot[0] * Math.sin(angle) +
                layout.pivot[1] * Math.cos(angle)),
        },
      };
    };
    if (active.action === "delete") {
      return;
    }
    if (active.action === "pinch" && active.pinch) {
      const [first, second] = [...contacts.current.values()];
      if (!second) {
        return;
      }
      const base = active.next;
      const span = Math.hypot(first[0] - second[0], first[1] - second[1]);
      const size = Math.max(
        0.5 * (base.params.gizmo?.scaleUnit ?? 1 / 0.7),
        Math.min(
          1.5 * (base.params.gizmo?.scaleUnit ?? 1 / 0.7),
          (base.params.size * span) / active.pinch.span,
        ),
      );
      active.pinch.span = Math.max(1, span);
      // ProtractorLayer applies only changes >= 0.8%, but rebases every sample,
      // including clamped samples, so reversing at a limit responds immediately.
      if (Math.abs(size - base.params.size) < base.params.size * 0.008) {
        return;
      }
      const center = gizmoPoint(base, 180, 180);
      const radians = (base.params.rotation * Math.PI) / 180;
      active.next = {
        ...base,
        params: { ...base.params, size },
        position: {
          x:
            center[0] -
            size * (180 * Math.cos(radians) - 180 * Math.sin(radians)),
          y:
            center[1] -
            size * (180 * Math.sin(radians) + 180 * Math.cos(radians)),
        },
      };
    } else if (active.action === "line" || active.action === "verticalLine") {
      const start = local(original, active.start);
      const end = local(original, current);
      const zero = original.kind === "ruler" && start[0] < 90 * GIZMO_UNIT;
      active.points =
        active.action === "line"
          ? [
              gizmoPoint(
                original,
                zero ? 25 * GIZMO_UNIT : start[0],
                -10 * GIZMO_UNIT,
              ),
              gizmoPoint(original, end[0], -10 * GIZMO_UNIT),
            ]
          : [
              gizmoPoint(original, -10 * GIZMO_UNIT, start[1]),
              gizmoPoint(original, -10 * GIZMO_UNIT, end[1]),
            ];
      const length =
        Math.hypot(
          active.points[1][0] - active.points[0][0],
          active.points[1][1] - active.points[0][1],
        ) / original.params.size;
      active.next = {
        ...original,
        params: {
          ...original.params,
          measurement: Math.round((length / (140 * GIZMO_UNIT)) * 100) / 100,
        },
      };
      if (previewFrame.current === undefined) {
        previewFrame.current = requestAnimationFrame(() => {
          previewFrame.current = undefined;
          if (gesture.current === active) {
            setPreview([...active.points]);
            renderWidget(api, active.next, false, { preview: true });
          }
        });
      }
      return;
    } else if (active.action === "move") {
      active.next = {
        ...original,
        position: {
          x: original.position.x + current[0] - active.start[0],
          y: original.position.y + current[1] - active.start[1],
        },
      };
    } else if (active.action === "resize") {
      if (original.kind === "ruler") {
        const before = local(original, active.start);
        const after = local(original, current);
        active.next = {
          ...original,
          params: {
            ...original.params,
            stretchX:
              Math.max(
                original.params.gizmo?.layout
                  ? (144 * original.params.gizmo.unit) / original.params.size
                  : 400 * GIZMO_UNIT,
                Math.min(
                  original.params.gizmo?.layout
                    ? (gizmoViewport(api).viewport.right -
                        gizmoViewport(api).viewport.left) /
                        original.params.size -
                        24
                    : Infinity,
                  layout.width + after[0] - before[0],
                ),
              ) / 360,
          },
        };
      } else if (original.kind === "compass") {
        const geometry = compassGeometry(original);
        const before = local(original, active.start);
        const after = local(original, current);
        active.next = {
          ...original,
          params: {
            ...original.params,
            gizmo: {
              unit:
                original.params.gizmo?.unit ??
                GIZMO_UNIT * original.params.size,
              ...original.params.gizmo,
              leg: geometry.leg,
              opening: Math.max(
                40 * geometry.dp,
                Math.min(
                  2 * geometry.leg - 24 * geometry.dp,
                  geometry.radius + after[0] - before[0],
                ),
              ),
            },
          },
        };
      } else {
        // TrianglePlateLayer stretches both catheti, retaining physical tick
        // spacing and button dimensions; it does not scale the whole object.
        const rotation = (original.params.rotation + 360) % 360;
        const dx = (current[0] - active.start[0]) / original.params.size;
        const dy = (current[1] - active.start[1]) / original.params.size;
        const delta =
          rotation > 60 && rotation < 150
            ? dy
            : rotation > 150 && rotation < 250
            ? -dx
            : rotation > 150 && rotation < 330
            ? -dy
            : dx;
        const localUnit =
          (original.params.gizmo?.unit ?? GIZMO_UNIT * original.params.size) /
          original.params.size;
        const available =
          ((api.getAppState().width - view.x) / view.scale -
            original.position.x) /
            original.params.size -
          10 * localUnit;
        const minimum = original.params.gizmo?.layout ? 144 * localUnit : 360;
        const width = Math.max(
          minimum,
          Math.min(Math.max(minimum, available), layout.width + delta),
        );
        active.next = {
          ...original,
          params: { ...original.params, stretchX: width / 360 },
        };
      }
    } else if (active.action === "needle") {
      const [x, y] = local(original, current);
      active.next = {
        ...original,
        params: {
          ...original.params,
          sweep: ((Math.atan2(180 - y, x - 180) * 180) / Math.PI + 360) % 360,
        },
      };
    } else {
      const angle =
        (Math.atan2(current[1] - pivot[1], current[0] - pivot[0]) * 180) /
        Math.PI;
      const previous =
        active.lastAngle ??
        (Math.atan2(active.start[1] - pivot[1], active.start[0] - pivot[0]) *
          180) /
          Math.PI;
      active.sweep = Math.max(
        -360,
        Math.min(360, active.sweep + degrees(angle - previous)),
      );
      active.lastAngle = angle;
      const delta = active.sweep;
      active.next = pose(degrees(original.params.rotation + delta));
      if (active.action === "drawArc") {
        const radius = compassGeometry(original).radius * original.params.size;
        const start = (original.params.rotation * Math.PI) / 180;
        const count = Math.max(2, Math.ceil(Math.abs(delta)) + 1);
        active.points = Array.from({ length: count }, (_, index) => {
          const angle =
            start + (((delta * Math.PI) / 180) * index) / (count - 1);
          return [
            pivot[0] + radius * Math.cos(angle),
            pivot[1] + radius * Math.sin(angle),
          ];
        });
      }
    }
    if (previewFrame.current === undefined) {
      previewFrame.current = requestAnimationFrame(() => {
        previewFrame.current = undefined;
        if (gesture.current !== active) {
          return;
        }
        try {
          if (active.action === "drawArc") {
            setPreview([...active.points]);
          }
          renderWidget(api, active.next, false, { preview: true });
        } catch (failure) {
          restore();
          setError(String(failure));
        }
      });
    }
  };
  const finish = (event: ReactPointerEvent) => {
    const active = gesture.current;
    if (
      !active ||
      (active.action === "pinch"
        ? !contacts.current.has(event.pointerId)
        : active.id !== event.pointerId)
    ) {
      return;
    }
    move(event);
    cancelPreview();
    if (gesture.current !== active) {
      return;
    }
    gesture.current = undefined;
    contacts.current.clear();
    setPreview([]);
    if (active.action === "delete") {
      void classroomCommands
        .execute({ name: "tools.delete", args: { id: active.original.id } })
        .catch((failure) => setError(String(failure)));
    } else if (active.action === "line" || active.action === "verticalLine") {
      renderWidget(api, active.next, false, { preview: true });
      ink(active.points);
    } else if (active.action === "drawArc") {
      renderWidget(api, active.next, false, { preview: true });
      ink(active.points);
    } else if (
      JSON.stringify(active.next) !== JSON.stringify(active.original)
    ) {
      renderWidget(api, active.next, true, { before: active.before });
    }
  };
  handlers.current = { move, finish };
  const anglePoints = (widget: Widget, mode: "angle" | "sector" | "arc") => {
    const sweep = degrees(widget.params.sweep);
    const count = Math.max(2, Math.ceil(Math.abs(sweep)) + 1);
    const arc = Array.from({ length: count }, (_, index) => {
      const angle = (((sweep * Math.PI) / 180) * index) / (count - 1);
      return gizmoPoint(
        widget,
        180 + 180 * Math.cos(angle),
        180 - 180 * Math.sin(angle),
      );
    });
    return mode === "angle"
      ? [arc[0], gizmoPoint(widget, 180, 180), arc.at(-1)!]
      : mode === "sector"
      ? [gizmoPoint(widget, 180, 180), ...arc, gizmoPoint(widget, 180, 180)]
      : arc;
  };
  const drawAngle = (widget: Widget, mode: "angle" | "sector" | "arc") => {
    setPreview([]);
    ink(anglePoints(widget, mode));
  };
  return (
    <>
      <svg
        ref={layer}
        className="fc-factory-gizmos"
        aria-label={t("fcboard.teaching_tools")}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          overflow: "visible",
          pointerEvents: "none",
          // SVG paths are not CSS layout boxes. Disable native panning on the
          // SVG viewport so a real touch drag is not cancelled after its slop.
          touchAction: "none",
          zIndex: view.document ? 22 : "var(--zIndex-svgLayer)",
          visibility: view.hidden || view.selecting ? "hidden" : "visible",
          // Hidden SVG descendants can override visibility or pointer-events.
          // Remove this interaction layer from hit testing during object selection.
          display: view.hidden || view.selecting ? "none" : undefined,
        }}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={restore}
        onLostPointerCapture={() => {
          if (gesture.current) {
            restore();
          }
        }}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {preview.length > 1 && (
            <polyline
              points={preview.map((point) => point.join(",")).join(" ")}
              fill="none"
              stroke={api.getAppState().currentItemStrokeColor || "#000"}
              strokeWidth={api.getAppState().currentItemStrokeWidth || 2}
            />
          )}
          {widgets.map((widget) => {
            const { width, height } = gizmoLayout(
              widget.kind,
              widget.params.stretchX,
            );
            const compass = compassGeometry(widget);
            const nativeUnit =
              (widget.params.gizmo?.unit ?? GIZMO_UNIT * widget.params.size) /
              widget.params.size;
            const needle = widget.params.gizmo?.needle ?? 190;
            const ball = widget.params.gizmo?.ball ?? 18;
            const handle = (
              action: Action | "delete",
              x: number,
              y: number,
              icon: string,
              label: string,
            ) => {
              const compact = compactGizmoControl(widget, action);
              if (compact) {
                [x, y] = compact;
              }
              const touchUnit = Math.max(
                nativeUnit,
                1 / (view.scale * widget.params.size),
              );
              return (
                <g
                  key={action}
                  data-gizmo-action={action}
                  role="button"
                  tabIndex={0}
                  aria-label={label}
                  style={{
                    pointerEvents: "auto",
                    cursor: action === "delete" ? "pointer" : "grab",
                    touchAction: "none",
                  }}
                  onPointerDown={(event) => begin(event, widget, action)}
                  onKeyDown={(event) => {
                    if (
                      action === "rotate" &&
                      ["ArrowLeft", "ArrowRight", "Enter", " "].includes(
                        event.key,
                      )
                    ) {
                      event.preventDefault();
                      const layout = gizmoLayout(
                        widget.kind,
                        widget.params.stretchX,
                      );
                      const pivot = gizmoPoint(
                        widget,
                        layout.pivot[0],
                        layout.pivot[1],
                      );
                      const rotation = degrees(
                        widget.params.rotation +
                          (event.key === "ArrowLeft" ? -15 : 15),
                      );
                      const radians = (rotation * Math.PI) / 180;
                      renderWidget(api, {
                        ...widget,
                        params: { ...widget.params, rotation },
                        position: {
                          x:
                            pivot[0] -
                            widget.params.size *
                              (layout.pivot[0] * Math.cos(radians) -
                                layout.pivot[1] * Math.sin(radians)),
                          y:
                            pivot[1] -
                            widget.params.size *
                              (layout.pivot[0] * Math.sin(radians) +
                                layout.pivot[1] * Math.cos(radians)),
                        },
                      });
                    } else if (
                      action === "resize" &&
                      [
                        "ArrowLeft",
                        "ArrowDown",
                        "ArrowRight",
                        "ArrowUp",
                        "Enter",
                        " ",
                      ].includes(event.key)
                    ) {
                      event.preventDefault();
                      const step = ["ArrowLeft", "ArrowDown"].includes(
                        event.key,
                      )
                        ? -1
                        : 1;
                      const layout = gizmoLayout(
                        widget.kind,
                        widget.params.stretchX,
                      );
                      renderWidget(api, {
                        ...widget,
                        params:
                          widget.kind === "compass"
                            ? {
                                ...widget.params,
                                gizmo: {
                                  unit:
                                    widget.params.gizmo?.unit ??
                                    GIZMO_UNIT * widget.params.size,
                                  ...widget.params.gizmo,
                                  leg: compass.leg,
                                  opening: Math.max(
                                    40 * compass.dp,
                                    Math.min(
                                      2 * compass.leg - 24 * compass.dp,
                                      compass.radius + step * 14 * compass.dp,
                                    ),
                                  ),
                                },
                              }
                            : {
                                ...widget.params,
                                stretchX:
                                  Math.max(
                                    widget.params.gizmo?.layout
                                      ? 144 * nativeUnit
                                      : widget.kind === "ruler"
                                      ? 240
                                      : 360,
                                    layout.width + step * 14 * GIZMO_UNIT,
                                  ) / 360,
                              },
                      });
                    }
                    if (
                      (event.key === "Enter" || event.key === " ") &&
                      action === "delete"
                    ) {
                      event.preventDefault();
                      void classroomCommands
                        .execute({
                          name: "tools.delete",
                          args: { id: widget.id },
                        })
                        .catch((failure) => setError(String(failure)));
                    }
                  }}
                >
                  {compact && (
                    <rect
                      x={x - 22 * touchUnit}
                      y={y - 22 * touchUnit}
                      width={44 * touchUnit}
                      height={44 * touchUnit}
                      fill="transparent"
                    />
                  )}
                  <image
                    href={icon}
                    x={
                      x -
                      (compact
                        ? 16 * nativeUnit
                        : widget.kind === "protractor"
                        ? 26.666668 * nativeUnit
                        : widget.kind === "ruler" || widget.kind === "setSquare"
                        ? 24
                        : (action === "delete" ? 16 : 15) * compass.dp)
                    }
                    y={
                      y -
                      (compact
                        ? 16 * nativeUnit
                        : widget.kind === "protractor"
                        ? 26.666668 * nativeUnit
                        : widget.kind === "ruler" || widget.kind === "setSquare"
                        ? 24
                        : (action === "delete" ? 16 : 15) * compass.dp)
                    }
                    width={
                      compact
                        ? 32 * nativeUnit
                        : widget.kind === "protractor"
                        ? 53.333336 * nativeUnit
                        : widget.kind === "ruler" || widget.kind === "setSquare"
                        ? 48
                        : (action === "delete" ? 32 : 30) * compass.dp
                    }
                    height={
                      compact
                        ? 32 * nativeUnit
                        : widget.kind === "protractor"
                        ? 53.333336 * nativeUnit
                        : widget.kind === "ruler" || widget.kind === "setSquare"
                        ? 48
                        : (action === "delete" ? 32 : 30) * compass.dp
                    }
                    style={{
                      visibility:
                        !compact &&
                        widget.kind === "compass" &&
                        action === "rotate"
                          ? "hidden"
                          : "inherit",
                    }}
                    transform={
                      widget.kind === "compass" &&
                      (action === "delete" || action === "drawArc")
                        ? `rotate(${
                            -widget.params.rotation *
                            (action === "drawArc" ? 2 : 1)
                          } ${x} ${y})`
                        : undefined
                    }
                  />
                  {!compact && widget.kind === "compass" && (
                    <circle
                      cx={x}
                      cy={y}
                      r={(action === "rotate" ? 21.12 : 36) * compass.dp}
                      fill="transparent"
                    />
                  )}
                </g>
              );
            };
            return (
              <g
                key={widget.id}
                data-gizmo={widget.id}
                transform={`translate(${widget.position.x} ${widget.position.y}) rotate(${widget.params.rotation}) scale(${widget.params.size})`}
              >
                {widget.kind === "protractor" ? (
                  <rect
                    width={360}
                    height={(360 * 788) / 1563}
                    y={180 - (360 * 788) / 1563 + 5 * nativeUnit}
                    fill="transparent"
                    style={{
                      pointerEvents: "auto",
                      cursor: "move",
                      touchAction: "none",
                    }}
                    onPointerDown={(event) => begin(event, widget, "move")}
                  />
                ) : widget.kind === "setSquare" ? (
                  <polygon
                    points={`0,0 ${width},0 0,${height}`}
                    fill="transparent"
                    style={{
                      pointerEvents: "auto",
                      cursor: "move",
                      touchAction: "none",
                    }}
                    onPointerDown={(event) => begin(event, widget, "move")}
                  />
                ) : widget.kind === "compass" ? (
                  <rect
                    x={-40 * compass.dp}
                    y={compass.hinge[1] - (38.4 + 10 + 46.08) * compass.dp}
                    width={compass.radius + 80 * compass.dp}
                    height={
                      300 -
                      compass.hinge[1] +
                      (38.4 + 10 + 46.08 + 40) * compass.dp
                    }
                    fill="transparent"
                    style={{
                      pointerEvents: "auto",
                      cursor: "move",
                      touchAction: "none",
                    }}
                    onPointerDown={(event) => begin(event, widget, "move")}
                  />
                ) : (
                  <rect
                    width={width}
                    height={height}
                    fill="transparent"
                    style={{
                      pointerEvents: "auto",
                      cursor: "move",
                      touchAction: "none",
                    }}
                    onPointerDown={(event) => begin(event, widget, "move")}
                  />
                )}
                {(widget.kind === "ruler" || widget.kind === "setSquare") && (
                  <line
                    x1={widget.kind === "ruler" ? -48 : -12}
                    x2={width}
                    y1={widget.kind === "ruler" ? -36 : -30}
                    y2={widget.kind === "ruler" ? -36 : -30}
                    stroke="transparent"
                    strokeWidth={widget.kind === "ruler" ? 72 : 60}
                    aria-label={t("fcboard.ruler")}
                    style={{
                      pointerEvents: "stroke",
                      cursor: "crosshair",
                      touchAction: "none",
                    }}
                    onPointerDown={(event) => begin(event, widget, "line")}
                  />
                )}
                {widget.kind === "setSquare" && (
                  <line
                    x1={-30}
                    x2={-30}
                    y1={0}
                    y2={height}
                    stroke="transparent"
                    strokeWidth={60}
                    style={{
                      pointerEvents: "stroke",
                      cursor: "crosshair",
                      touchAction: "none",
                    }}
                    onPointerDown={(event) =>
                      begin(event, widget, "verticalLine")
                    }
                  />
                )}
                {handle(
                  "delete",
                  widget.kind === "compass"
                    ? compass.remove[0]
                    : widget.kind === "setSquare"
                    ? width - 204
                    : widget.kind === "ruler"
                    ? 24
                    : 180 - 250 * nativeUnit,
                  widget.kind === "compass"
                    ? compass.remove[1]
                    : widget.kind === "setSquare"
                    ? 264
                    : widget.kind === "ruler"
                    ? 150
                    : 180 + 66.666668 * nativeUnit,
                  deleteIcon,
                  t("labels.delete"),
                )}
                {handle(
                  "rotate",
                  widget.kind === "compass"
                    ? compass.hinge[0]
                    : widget.kind === "setSquare"
                    ? width - 90
                    : widget.kind === "ruler"
                    ? width - 84
                    : 180 + 376.666668 * nativeUnit,
                  widget.kind === "compass"
                    ? compass.hinge[1]
                    : widget.kind === "setSquare"
                    ? 150
                    : widget.kind === "ruler"
                    ? 150
                    : 180 + 66.666668 * nativeUnit,
                  rotateIcon,
                  t("fcboard.rotate_shape"),
                )}
                {widget.kind !== "protractor" &&
                  handle(
                    "resize",
                    widget.kind === "compass"
                      ? compass.stretch[0]
                      : widget.kind === "setSquare"
                      ? width - 156
                      : width - 24,
                    widget.kind === "compass"
                      ? compass.stretch[1]
                      : widget.kind === "setSquare"
                      ? 204
                      : 150,
                    widget.kind === "compass"
                      ? compassStretchIcon
                      : stretchIcon,
                    t("fcboard.size"),
                  )}
                {widget.kind === "compass" &&
                  gesture.current?.original.id === widget.id &&
                  ["rotate", "drawArc"].includes(gesture.current.action) && (
                    <circle
                      cx={0}
                      cy={300}
                      r={compass.radius}
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth={compass.dp}
                      strokeDasharray={`${Math.max(
                        4 * compass.dp,
                        compass.radius * Math.PI * 2 * 0.02,
                      )}`}
                      pointerEvents="none"
                    />
                  )}
                {widget.kind === "compass" &&
                  handle(
                    "drawArc",
                    compass.draw[0],
                    compass.draw[1],
                    compassRotateIcon,
                    t("toolBar.freedraw"),
                  )}
                {widget.kind === "protractor" && (
                  <>
                    <circle
                      cx={
                        180 +
                        needle * Math.cos((widget.params.sweep * Math.PI) / 180)
                      }
                      cy={
                        180 -
                        needle * Math.sin((widget.params.sweep * Math.PI) / 180)
                      }
                      r={
                        widget.params.gizmo?.layout
                          ? Math.max(
                              ball / 2,
                              22 / (view.scale * widget.params.size),
                            )
                          : ball / 2
                      }
                      fill="transparent"
                      role="slider"
                      tabIndex={0}
                      aria-label={t("stats.angle")}
                      aria-valuemin={0}
                      aria-valuemax={360}
                      aria-valuenow={Math.round(widget.params.sweep)}
                      style={{
                        pointerEvents: "auto",
                        cursor: "crosshair",
                        touchAction: "none",
                      }}
                      onPointerDown={(event) => begin(event, widget, "needle")}
                      onKeyDown={(event) => {
                        if (
                          event.key === "ArrowLeft" ||
                          event.key === "ArrowRight"
                        ) {
                          event.preventDefault();
                          renderWidget(api, {
                            ...widget,
                            params: {
                              ...widget.params,
                              sweep:
                                (widget.params.sweep +
                                  (event.key === "ArrowLeft" ? 1 : -1) +
                                  360) %
                                360,
                            },
                          });
                        }
                      }}
                    />
                    {(["angle", "sector", "arc"] as const).map(
                      (mode, index) => {
                        const compact = compactGizmoControl(widget, mode);
                        const x =
                          compact?.[0] ??
                          180 + (-100 + index * 100 + 26.666668) * nativeUnit;
                        const y = compact?.[1] ?? 180 + 66.666668 * nativeUnit;
                        const iconSize =
                          (compact ? 32 : 53.333336) * nativeUnit;
                        const hitSize = Math.max(
                          44 * nativeUnit,
                          44 / (view.scale * widget.params.size),
                        );
                        return (
                          <g
                            key={mode}
                            role="button"
                            tabIndex={0}
                            aria-label={`${t("toolBar.freedraw")} ${index + 1}`}
                            onClick={(event) => {
                              if (event.detail === 0) {
                                drawAngle(widget, mode);
                              }
                            }}
                            onPointerDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              actionPress.current = {
                                id: widget.id,
                                mode,
                                pointer: event.pointerId,
                              };
                              setPressed(`${widget.id}:${mode}`);
                              setPreview(anglePoints(widget, mode));
                              try {
                                event.currentTarget.setPointerCapture?.(
                                  event.pointerId,
                                );
                              } catch (failure) {
                                if (
                                  !(failure instanceof Error) ||
                                  failure.name !== "NotFoundError"
                                ) {
                                  restore();
                                  setError(String(failure));
                                }
                              }
                            }}
                            onPointerUp={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              const press = actionPress.current;
                              actionPress.current = undefined;
                              setPressed("");
                              if (
                                press?.id === widget.id &&
                                press.mode === mode &&
                                press.pointer === event.pointerId
                              ) {
                                drawAngle(widget, mode);
                              }
                            }}
                            onPointerCancel={restore}
                            onLostPointerCapture={() => {
                              actionPress.current = undefined;
                              setPressed("");
                              setPreview([]);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                drawAngle(widget, mode);
                              }
                            }}
                            style={{
                              pointerEvents: "auto",
                              cursor: "pointer",
                              touchAction: "none",
                            }}
                          >
                            {compact && (
                              <rect
                                x={x - hitSize / 2}
                                y={y - hitSize / 2}
                                width={hitSize}
                                height={hitSize}
                                fill="transparent"
                              />
                            )}
                            <image
                              x={x - iconSize / 2}
                              y={y - iconSize / 2}
                              width={iconSize}
                              height={iconSize}
                              href={
                                (pressed === `${widget.id}:${mode}`
                                  ? [
                                      drawAngleDownIcon,
                                      drawSectorDownIcon,
                                      drawArcDownIcon,
                                    ]
                                  : [
                                      drawAngleIcon,
                                      drawSectorIcon,
                                      drawArcIcon,
                                    ])[index]
                              }
                              style={{ pointerEvents: "none" }}
                            />
                          </g>
                        );
                      },
                    )}
                  </>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <TransientMessage
        message={error}
        role="alert"
        className="fc-notice fc-error"
      />
    </>
  );
};
