import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ToolbarExtras,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import { getCommonBounds } from "@excalidraw/element";
import { viewportCoordsToSceneCoords } from "@excalidraw/common";
import { t, useI18n } from "@excalidraw/excalidraw/i18n";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { classroomCommands } from "./commands";
import { factoryShapeCatalog } from "./factoryShapeGeometry";
import { FactoryShapeIcon } from "./factoryShapeIcons";
import { renderWidget, widgetDefaults, widgetShapes } from "./widgets";
import { TransientMessage } from "./TransientMessage";

import "./FactoryShapes.scss";

import type { PointerEvent as ReactPointerEvent } from "react";

import type { FactoryShapeStyle, ShapePoint } from "./factoryShapeGeometry";
import type { Widget, WidgetKind } from "./widgets";
import type { InkStroke } from "./documents";

const prefix = "factory-shape:";
const colors = [
  "#ffffff",
  "#1525d9",
  "#000000",
  "#ffc000",
  "#f90000",
  "#00a737",
  "#510d82",
];

const shapeTarget = (api: ExcalidrawImperativeAPI) => {
  const document = classroomCommands.read("document") as
    | { id?: string; page?: number }
    | undefined;
  const board = classroomCommands.read("boards") as
    | { active?: string }
    | undefined;
  return document
    ? `doc:${document.id}:${document.page}`
    : `board:${board?.active || api.id}`;
};

export const draggedFactoryShape = (
  index: number,
  start: ShapePoint,
  end: ShapePoint,
  style: FactoryShapeStyle,
): Widget => {
  const kind = factoryShapeCatalog[index][0];
  const params = widgetDefaults();
  params.solid.stroke = style.color;
  params.strokeWidth = style.width;
  params.opacity = style.opacity;
  const widget: Widget = {
    id: crypto.randomUUID(),
    kind: index < 12 ? "shape" : (kind as WidgetKind),
    params,
    position: { x: start[0], y: start[1] },
  };
  if (index < 12) {
    params.shape = {
      kind,
      start: [0, 0],
      end: [end[0] - start[0], end[1] - start[1]],
      fill: style.fill,
      width: style.width,
      opacity: style.opacity,
    };
    return widget;
  }
  const bounds = getCommonBounds(
    convertToExcalidrawElements(widgetShapes(widget)),
  );
  params.stretchX = Math.max(
    0.01,
    Math.min(
      100,
      Math.abs(end[0] - start[0]) / Math.max(1, bounds[2] - bounds[0]),
    ),
  );
  params.stretchY = Math.max(
    0.01,
    Math.min(
      100,
      Math.abs(end[1] - start[1]) / Math.max(1, bounds[3] - bounds[1]),
    ),
  );
  widget.position = {
    x: Math.min(start[0], end[0]) - bounds[0] * params.stretchX,
    y: Math.min(start[1], end[1]) - bounds[1] * params.stretchY,
  };
  return widget;
};

/** HAutoShapeWindow chooses a tool. Pointer-up commits the drag to one typed widget. */
export const FactoryShapes = ({ api }: { api: ExcalidrawImperativeAPI }) => {
  useI18n();
  const [state, setState] = useState(() => api.getAppState());
  const [documentStage, setDocumentStage] = useState<HTMLElement | null>(null);
  const [preview, setPreview] = useState<Widget | null>(null);
  const [error, setError] = useState("");
  const gesture = useRef<
    | {
        pointer: number;
        index: number;
        start: ShapePoint;
        end: ShapePoint;
        style: FactoryShapeStyle;
        target: string;
        revision: number;
      }
    | undefined
  >(undefined);
  const layer = useRef<SVGSVGElement>(null);
  const handlers = useRef<
    | {
        move: (event: ReactPointerEvent) => void;
        finish: (event: ReactPointerEvent) => void;
      }
    | undefined
  >(undefined);
  const identity = () => shapeTarget(api);
  const cancel = () => {
    gesture.current = undefined;
    setPreview(null);
  };
  useEffect(() => {
    let active = true;
    const stop = classroomCommands.register(
      "shapes.insert",
      `Insert one original factory shape: args.kind=${factoryShapeCatalog
        .map(([kind]) => kind)
        .join(
          "|",
        )}; args.start=[x,y] and args.end=[x,y] use the current canvas.inspect coordinate space (scene or document units), and args.revision must match its observed revision. Uses the current visible pen color/width/opacity and shape fill setting; returns the actual widget id and committed object ids. All parts remain one editable/erasable object. Inspect again after opening or changing the visible page.`,
      async (args) => {
        const index = factoryShapeCatalog.findIndex(
          ([kind]) => kind === args.kind,
        );
        const validPoint = (value: unknown): value is ShapePoint =>
          Array.isArray(value) &&
          value.length === 2 &&
          value.every(
            (coordinate) =>
              typeof coordinate === "number" &&
              Number.isFinite(coordinate) &&
              Math.abs(coordinate) <= 1e6,
          );
        if (
          Object.keys(args).some(
            (key) =>
              !["kind", "start", "end", "revision", "signal"].includes(key),
          ) ||
          index < 0 ||
          !validPoint(args.start) ||
          !validPoint(args.end) ||
          !Number.isInteger(args.revision) ||
          (args.signal !== undefined && !(args.signal instanceof AbortSignal))
        ) {
          throw new Error(t("fcboard.invalid_ai_command_please_try_again"));
        }
        const signal = args.signal as AbortSignal | undefined;
        signal?.throwIfAborted();
        const target = shapeTarget(api);
        const assertCurrent = () => {
          signal?.throwIfAborted();
          if (
            !active ||
            args.revision !== classroomCommands.revision ||
            target !== shapeTarget(api)
          ) {
            throw new DOMException(
              "Shape target changed; inspect the visible canvas again",
              "AbortError",
            );
          }
        };
        assertCurrent();
        if (
          Math.hypot(args.end[0] - args.start[0], args.end[1] - args.start[1]) <
            3 ||
          args.end.some(
            (coordinate, axis) =>
              Math.abs(coordinate - (args.start as ShapePoint)[axis]) > 1e6,
          )
        ) {
          throw new Error(t("fcboard.invalid_ai_command_please_try_again"));
        }
        const document = classroomCommands.read("document") as
          | {
              ink: InkStroke[];
              pen?: { color: string; penWidth: number; opacity: number };
            }
          | undefined;
        if (document && !classroomCommands.has("document.widget")) {
          throw new Error(
            t("fcboard.command_unavailable_command", {
              command: "document.widget",
            }),
          );
        }
        const state = api.getAppState();
        const widget = draggedFactoryShape(index, args.start, args.end, {
          color:
            document?.pen?.color || state.currentItemStrokeColor || "#000000",
          width:
            document?.pen?.penWidth ||
            state.currentItemStrokeWidth /
              (state.currentItemPenMode === "brush" ? 2 : 1),
          opacity: document?.pen?.opacity ?? state.currentItemOpacity,
          fill:
            !!state.currentItemBackgroundColor &&
            state.currentItemBackgroundColor !== "transparent",
        });
        assertCurrent();
        let commit: Promise<unknown> | undefined;
        const elements = renderWidget(api, widget, true, {
          exact: true,
          onDocumentCommit: (pending) => {
            commit = pending;
          },
        });
        await commit;
        assertCurrent();
        const visible = document
          ? (classroomCommands.read("document") as { ink: InkStroke[] }).ink
          : api.getSceneElements();
        const committed = new Set(visible.map((item) => item.id));
        if (
          !elements.length ||
          elements.some((element) => !committed.has(element.id))
        ) {
          throw new Error(
            "Shape insertion did not commit to the visible canvas",
          );
        }
        return {
          id: widget.id,
          kind: args.kind,
          ids: elements.map((element) => element.id),
          coordinates: document ? "document" : "scene",
        };
      },
    );
    return () => {
      active = false;
      stop();
    };
  }, [api]);
  useEffect(() => {
    const refresh = () => {
      setState(api.getAppState());
      setDocumentStage(
        classroomCommands.read("document")
          ? document.querySelector<HTMLElement>(".fc-document-stage")
          : null,
      );
      if (
        gesture.current &&
        (gesture.current.target !== identity() ||
          gesture.current.revision !== classroomCommands.revision ||
          api.getAppState().activeTool.customType !==
            `${prefix}${gesture.current.index}`)
      ) {
        cancel();
      }
    };
    const stop = api.onChange(refresh);
    const stopDocument = classroomCommands.watch("document", refresh);
    const stopInvalidate = classroomCommands.onInvalidate(cancel);
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
    window.addEventListener("pointermove", outsideMove);
    window.addEventListener("pointerup", outsideUp);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    refresh();
    return () => {
      stop();
      stopDocument();
      stopInvalidate();
      window.removeEventListener("pointermove", outsideMove);
      window.removeEventListener("pointerup", outsideUp);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
    };
    // Targets are read live when a document or board changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);
  const active =
    state.activeTool?.type === "custom" &&
    state.activeTool.customType?.startsWith(prefix)
      ? Number(state.activeTool.customType.slice(prefix.length))
      : -1;
  const color = state.currentItemStrokeColor || "#000000";
  const filled =
    !!state.currentItemBackgroundColor &&
    state.currentItemBackgroundColor !== "transparent";
  const point = (event: ReactPointerEvent): ShapePoint => {
    if (documentStage) {
      const bounds = documentStage.getBoundingClientRect();
      const scale = bounds.width / 1000;
      return [
        (event.clientX - bounds.left) / scale,
        (event.clientY - bounds.top) / scale,
      ];
    }
    const value = viewportCoordsToSceneCoords(event, api.getAppState());
    return [value.x, value.y];
  };
  const move = (event: ReactPointerEvent) => {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) {
      return;
    }
    if (
      current.target !== identity() ||
      current.revision !== classroomCommands.revision
    ) {
      cancel();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    current.end = point(event);
    setPreview(
      draggedFactoryShape(
        current.index,
        current.start,
        current.end,
        current.style,
      ),
    );
  };
  const finish = (event: ReactPointerEvent) => {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) {
      return;
    }
    move(event);
    if (gesture.current !== current) {
      return;
    }
    cancel();
    if (
      Math.hypot(
        current.end[0] - current.start[0],
        current.end[1] - current.start[1],
      ) < 3
    ) {
      return;
    }
    try {
      renderWidget(
        api,
        draggedFactoryShape(
          current.index,
          current.start,
          current.end,
          current.style,
        ),
        true,
        { exact: true },
      );
    } catch (failure) {
      setError(String(failure));
    }
  };
  handlers.current = { move, finish };
  const surface =
    active >= 0 && active < factoryShapeCatalog.length ? (
      <svg
        ref={layer}
        className="fc-factory-shape-drawing"
        data-factory-shape={factoryShapeCatalog[active][0]}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          zIndex: documentStage ? 3 : 9,
          touchAction: "none",
          pointerEvents: "auto",
          cursor: "crosshair",
        }}
        onPointerDown={(event) => {
          if (event.button > 0) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          if (gesture.current) {
            cancel();
            return;
          }
          setError("");
          const document = classroomCommands.read("document") as
            | { pen?: { color: string; penWidth: number; opacity: number } }
            | undefined;
          const start = point(event);
          gesture.current = {
            pointer: event.pointerId,
            index: active,
            start,
            end: start,
            style: {
              color: document?.pen?.color || color,
              width:
                document?.pen?.penWidth ||
                state.currentItemStrokeWidth /
                  (state.currentItemPenMode === "brush" ? 2 : 1),
              opacity: document?.pen?.opacity ?? state.currentItemOpacity,
              fill: filled,
            },
            target: identity(),
            revision: classroomCommands.revision,
          };
          window.dispatchEvent(new Event("fcboard:shape-draw"));
          try {
            event.currentTarget.setPointerCapture?.(event.pointerId);
          } catch (failure) {
            if (
              !(failure instanceof Error) ||
              failure.name !== "NotFoundError"
            ) {
              cancel();
              setError(String(failure));
            }
          }
        }}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
      >
        <g
          transform={
            documentStage
              ? `scale(${documentStage.getBoundingClientRect().width / 1000})`
              : `scale(${state.zoom.value}) translate(${state.scrollX} ${state.scrollY})`
          }
        >
          {preview &&
            widgetShapes(preview).map((shape, index) => {
              const x = preview.position.x + (shape.x || 0);
              const y = preview.position.y + (shape.y || 0);
              const props = {
                stroke: shape.strokeColor,
                strokeWidth: shape.strokeWidth,
                opacity: (shape.opacity ?? 100) / 100,
                fill: shape.backgroundColor || "none",
                strokeDasharray:
                  shape.strokeStyle === "dashed" ? "10 10" : undefined,
              };
              return shape.type === "line" || shape.type === "arrow" ? (
                <polyline
                  key={index}
                  points={shape.points
                    ?.map(([px, py]) => `${x + px},${y + py}`)
                    .join(" ")}
                  {...props}
                />
              ) : shape.type === "ellipse" ? (
                <ellipse
                  key={index}
                  cx={x + (shape.width || 0) / 2}
                  cy={y + (shape.height || 0) / 2}
                  rx={(shape.width || 0) / 2}
                  ry={(shape.height || 0) / 2}
                  {...props}
                />
              ) : shape.type === "rectangle" ? (
                <rect
                  key={index}
                  x={x}
                  y={y}
                  width={shape.width}
                  height={shape.height}
                  {...props}
                />
              ) : shape.type === "diamond" ? (
                <polygon
                  key={index}
                  points={`${x + (shape.width || 0) / 2},${y} ${
                    x + (shape.width || 0)
                  },${y + (shape.height || 0) / 2} ${
                    x + (shape.width || 0) / 2
                  },${y + (shape.height || 0)} ${x},${
                    y + (shape.height || 0) / 2
                  }`}
                  {...props}
                />
              ) : null;
            })}
        </g>
      </svg>
    ) : null;
  return (
    <>
      <ToolbarExtras placement="shapes">
        <div className="fc-factory-shape-menu">
          <div className="fc-shape-heading">{t("fcboard.shape")}</div>
          <div
            className="fc-factory-shape-grid"
            role="group"
            aria-label={t("fcboard.shape")}
          >
            {factoryShapeCatalog.map(([kind, label], index) => (
              <button
                key={kind}
                type="button"
                aria-label={t(label)}
                title={t(label)}
                aria-pressed={active === index}
                data-testid={`factory-shape-${kind}`}
                onClick={() =>
                  api.setActiveTool({
                    type: "custom",
                    customType: `${prefix}${index}`,
                  })
                }
              >
                <FactoryShapeIcon index={index} />
              </button>
            ))}
          </div>
          <div className="fc-shape-heading">{t("fcboard.colour")}</div>
          <div
            className="fc-factory-shape-colors"
            role="group"
            aria-label={t("fcboard.colour")}
          >
            {colors.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={t("fcboard.pen_colour_color", { color })}
                aria-pressed={
                  (state.currentItemStrokeColor || "#000000").toLowerCase() ===
                  color
                }
                onClick={() =>
                  api.updateScene({
                    appState: {
                      currentItemStrokeColor: color,
                      ...(filled ? { currentItemBackgroundColor: color } : {}),
                    },
                  })
                }
              >
                <span style={{ background: color }} />
              </button>
            ))}
            <button
              type="button"
              aria-label={t("labels.fill")}
              aria-pressed={filled}
              onClick={() =>
                api.updateScene({
                  appState: {
                    currentItemBackgroundColor: !filled ? color : "transparent",
                  },
                })
              }
            >
              <FactoryShapeIcon index={20} />
            </button>
          </div>
        </div>
      </ToolbarExtras>
      {documentStage && surface
        ? createPortal(surface, documentStage)
        : surface}
      <TransientMessage
        message={error}
        role="alert"
        className="fc-notice fc-error"
      />
    </>
  );
};
