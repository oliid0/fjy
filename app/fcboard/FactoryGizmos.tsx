import { useEffect, useRef, useState } from "react";
import { t, useI18n } from "@fcboard/fcboard/i18n";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { classroomCommands } from "./commands";
import {
  factoryGizmoKinds,
  gizmoLayout,
  gizmoPoint,
} from "./factoryGizmoShapes";
import { readWidgets, renderWidget } from "./widgets";
import deleteIcon from "./factory-gizmo-icons/delete.png?url";
import rotateIcon from "./factory-gizmo-icons/rotate.png?url";
import stretchIcon from "./factory-gizmo-icons/stretch.png?url";
import { TransientMessage } from "./TransientMessage";
import { forwardEraseContact } from "./canvasContact";

import type { PointerEvent as ReactPointerEvent } from "react";

import type { InkStroke } from "./documents";
import type { Widget } from "./widgets";

type Action =
  | "move"
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
};
const degrees = (value: number) => ((value + 540) % 360) - 180;

/** Native GizmoLayer actions share the existing widget transaction and ink commands.
 * The transparent body moves the tool; its outside edge draws constrained ink. */
export const FactoryGizmos = ({ api }: { api: FcboardImperativeAPI }) => {
  useI18n();
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1, hidden: false });
  const [preview, setPreview] = useState<[number, number][]>([]);
  const [error, setError] = useState("");
  const gesture = useRef<Gesture | undefined>(undefined);
  const layer = useRef<SVGSVGElement>(null);
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
        | { zoom?: number }
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
      };
      setView((previous) =>
        previous.x === nextView.x &&
        previous.y === nextView.y &&
        previous.scale === nextView.scale &&
        previous.hidden === nextView.hidden
          ? previous
          : nextView,
      );
      const nextWidgets = readWidgets(api).filter((widget) =>
        factoryGizmoKinds.has(widget.kind),
      );
      setWidgets((previous) =>
        JSON.stringify(previous) === JSON.stringify(nextWidgets)
          ? previous
          : nextWidgets,
      );
    };
    const stop = api.onChange(refresh);
    const document = classroomCommands.watch("document", refresh);
    const resize = () => refresh();
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
    if (gesture.current || event.button > 0) {
      return;
    }
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
    if (!active || active.id !== event.pointerId) {
      return;
    }
    if (
      active.target !== identity() ||
      active.revision !== classroomCommands.revision ||
      !readWidgets(api).some((widget) => widget.id === active.original.id)
    ) {
      gesture.current = undefined;
      setPreview([]);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const current = point(event);
    const original = active.original;
    const layout = gizmoLayout(original.kind);
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
    if (active.action === "line" || active.action === "verticalLine") {
      const start = local(original, active.start);
      const end = local(original, current);
      active.points =
        active.action === "line"
          ? [
              gizmoPoint(original, Math.max(0, Math.min(360, start[0])), 0),
              gizmoPoint(original, Math.max(0, Math.min(360, end[0])), 0),
            ]
          : [
              gizmoPoint(original, 0, Math.max(0, Math.min(360, start[1]))),
              gizmoPoint(original, 0, Math.max(0, Math.min(360, end[1]))),
            ];
      setPreview([...active.points]);
      return;
    }
    if (active.action === "move") {
      active.next = {
        ...original,
        position: {
          x: original.position.x + current[0] - active.start[0],
          y: original.position.y + current[1] - active.start[1],
        },
      };
    } else if (active.action === "resize") {
      if (original.kind === "compass") {
        const x = local(original, current)[0];
        active.next = {
          ...original,
          params: {
            ...original.params,
            length: Math.max(0.2, Math.min(5, (x / 200) * 1.5)),
          },
        };
      } else {
        active.next = pose(
          original.params.rotation,
          Math.max(
            0.3,
            Math.min(
              2,
              (original.params.size *
                Math.hypot(current[0] - pivot[0], current[1] - pivot[1])) /
                Math.max(
                  1,
                  Math.hypot(
                    active.start[0] - pivot[0],
                    active.start[1] - pivot[1],
                  ),
                ),
            ),
          ),
        );
      }
    } else if (active.action === "needle") {
      const [x, y] = local(original, current);
      active.next = {
        ...original,
        params: {
          ...original.params,
          sweep: Math.max(
            0,
            Math.min(180, (Math.atan2(180 - y, x - 180) * 180) / Math.PI),
          ),
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
        const radius =
          ((200 * original.params.length) / 1.5) * original.params.size;
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
        setPreview([...active.points]);
      }
    }
    try {
      renderWidget(api, active.next, false, { preview: true });
    } catch (failure) {
      restore();
      setError(String(failure));
    }
  };
  const finish = (event: ReactPointerEvent) => {
    const active = gesture.current;
    if (!active || active.id !== event.pointerId) {
      return;
    }
    move(event);
    if (gesture.current !== active) {
      return;
    }
    gesture.current = undefined;
    setPreview([]);
    if (active.action === "line" || active.action === "verticalLine") {
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
  const drawAngle = (widget: Widget, mode: "angle" | "sector" | "arc") => {
    const count = Math.max(2, Math.ceil(Math.abs(widget.params.sweep)) + 1);
    const arc = Array.from({ length: count }, (_, index) => {
      const angle =
        (((widget.params.sweep * Math.PI) / 180) * index) / (count - 1);
      return gizmoPoint(
        widget,
        180 + 155 * Math.cos(angle),
        180 - 155 * Math.sin(angle),
      );
    });
    ink(
      mode === "angle"
        ? [arc[0], gizmoPoint(widget, 180, 180), arc.at(-1)!]
        : mode === "sector"
        ? [gizmoPoint(widget, 180, 180), ...arc, gizmoPoint(widget, 180, 180)]
        : arc,
    );
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
          zIndex: 22,
          visibility: view.hidden ? "hidden" : "visible",
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
            const { width, height } = gizmoLayout(widget.kind);
            const radius = (200 * widget.params.length) / 1.5;
            const handle = (
              action: Action | "delete",
              x: number,
              y: number,
              icon: string,
              label: string,
            ) => (
              <image
                key={action}
                href={icon}
                x={x - 16}
                y={y - 16}
                width={32}
                height={32}
                role="button"
                tabIndex={0}
                aria-label={label}
                style={{
                  pointerEvents: "auto",
                  cursor: action === "delete" ? "pointer" : "grab",
                  touchAction: "none",
                }}
                onPointerDown={(event) => {
                  if (forwardEraseContact(api, event)) {
                    return;
                  }
                  if (action === "delete") {
                    event.stopPropagation();
                    void classroomCommands
                      .execute({
                        name: "tools.delete",
                        args: { id: widget.id },
                      })
                      .catch((failure) => setError(String(failure)));
                  } else {
                    begin(event, widget, action);
                  }
                }}
                onKeyDown={(event) => {
                  if (
                    action === "rotate" &&
                    ["ArrowLeft", "ArrowRight", "Enter", " "].includes(
                      event.key,
                    )
                  ) {
                    event.preventDefault();
                    renderWidget(api, {
                      ...widget,
                      params: {
                        ...widget.params,
                        rotation: degrees(
                          widget.params.rotation +
                            (event.key === "ArrowLeft" ? -15 : 15),
                        ),
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
                    renderWidget(api, {
                      ...widget,
                      params: {
                        ...widget.params,
                        size: Math.max(
                          0.3,
                          Math.min(
                            2,
                            widget.params.size +
                              (["ArrowLeft", "ArrowDown"].includes(event.key)
                                ? -0.1
                                : 0.1),
                          ),
                        ),
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
              />
            );
            return (
              <g
                key={widget.id}
                data-gizmo={widget.id}
                transform={`translate(${widget.position.x} ${widget.position.y}) rotate(${widget.params.rotation}) scale(${widget.params.size})`}
              >
                {widget.kind === "protractor" ? (
                  <path
                    d="M0 180 A180 180 0 0 1 360 180 Z"
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
                    points="0,0 360,0 0,360"
                    fill="transparent"
                    style={{
                      pointerEvents: "auto",
                      cursor: "move",
                      touchAction: "none",
                    }}
                    onPointerDown={(event) => begin(event, widget, "move")}
                  />
                ) : widget.kind === "compass" ? (
                  <path
                    d={`M0 300 L${radius / 2} 80 L${radius} 300`}
                    fill="transparent"
                    stroke="transparent"
                    strokeWidth="35"
                    style={{
                      pointerEvents: "all",
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
                    x1={0}
                    x2={360}
                    y1={-8}
                    y2={-8}
                    stroke="transparent"
                    strokeWidth={22}
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
                    x1={-8}
                    x2={-8}
                    y1={0}
                    y2={360}
                    stroke="transparent"
                    strokeWidth={22}
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
                  widget.kind === "compass" ? radius / 2 + 65 : 16,
                  widget.kind === "compass" ? 70 : height + 28,
                  deleteIcon,
                  t("labels.delete"),
                )}
                {handle(
                  "rotate",
                  widget.kind === "compass" ? radius / 2 : width - 65,
                  widget.kind === "compass" ? 80 : height + 28,
                  rotateIcon,
                  t("fcboard.rotate_shape"),
                )}
                {handle(
                  "resize",
                  widget.kind === "compass" ? radius : width - 16,
                  widget.kind === "compass" ? 280 : height + 28,
                  stretchIcon,
                  t("fcboard.size"),
                )}
                {widget.kind === "compass" &&
                  handle(
                    "drawArc",
                    radius + 40,
                    250,
                    rotateIcon,
                    t("toolBar.freedraw"),
                  )}
                {widget.kind === "protractor" && (
                  <>
                    <circle
                      cx={
                        180 +
                        190 * Math.cos((widget.params.sweep * Math.PI) / 180)
                      }
                      cy={
                        180 -
                        190 * Math.sin((widget.params.sweep * Math.PI) / 180)
                      }
                      r={16}
                      fill="transparent"
                      role="slider"
                      tabIndex={0}
                      aria-label={t("stats.angle")}
                      aria-valuemin={0}
                      aria-valuemax={180}
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
                              sweep: Math.max(
                                0,
                                Math.min(
                                  180,
                                  widget.params.sweep +
                                    (event.key === "ArrowLeft" ? 1 : -1),
                                ),
                              ),
                            },
                          });
                        }
                      }}
                    />
                    {(["angle", "sector", "arc"] as const).map(
                      (mode, index) => (
                        <g
                          key={mode}
                          role="button"
                          tabIndex={0}
                          aria-label={`${t("toolBar.freedraw")} ${index + 1}`}
                          onClick={() => drawAngle(widget, mode)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              drawAngle(widget, mode);
                            }
                          }}
                          style={{ pointerEvents: "auto", cursor: "pointer" }}
                        >
                          <circle
                            cx={100 + index * 48}
                            cy={height + 28}
                            r={16}
                            fill="#00b8c5"
                            stroke="white"
                          />
                          <text
                            x={100 + index * 48}
                            y={height + 34}
                            textAnchor="middle"
                            fill="white"
                            fontSize={20}
                            style={{ pointerEvents: "none" }}
                          >
                            {mode === "angle"
                              ? "∠"
                              : mode === "sector"
                              ? "△"
                              : "⌒"}
                          </text>
                        </g>
                      ),
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
