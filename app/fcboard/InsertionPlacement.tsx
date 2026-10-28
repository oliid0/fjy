import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { viewportCoordsToSceneCoords } from "@excalidraw/common";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { classroomCommands } from "./commands";
import { insertionShapes, renderInsertion } from "./insertObjects";
import { forwardEraseContact } from "./canvasContact";

import type { PointerEvent as ReactPointerEvent } from "react";
import type { InsertObject } from "./insertObjects";

/** A confirmed table remains a placement tool until the next complete contact. */
export const InsertionPlacement = ({
  api,
  object,
  onFinish,
  onError,
}: {
  api: ExcalidrawImperativeAPI;
  object: InsertObject;
  onFinish: () => void;
  onError: (error: unknown) => void;
}) => {
  const layer = useRef<SVGSVGElement>(null);
  const gesture = useRef<{ id: number; start: [number, number] } | undefined>(
    undefined,
  );
  const [preview, setPreview] = useState<InsertObject>();
  const [state, setState] = useState(() => api.getAppState());
  const documentStage = classroomCommands.read("document")
    ? window.document.querySelector<HTMLElement>(".fc-document-stage")
    : null;
  const initialSurface = useRef(classroomCommands.revision);
  const done = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const stop = api.onChange(() => {
      const state = api.getAppState();
      setState(state);
      if (
        state.activeTool.type !== "custom" ||
        state.activeTool.customType !== "factory-insertion:table"
      ) {
        onFinish();
      }
    });
    const cancel = () => {
      gesture.current = undefined;
      setPreview(undefined);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cancel();
        onFinish();
        api.setActiveTool({ type: "freedraw" });
      }
    };
    const invalidate = () => {
      cancel();
      onFinish();
    };
    const unwatch = classroomCommands.onInvalidate(invalidate);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key);
    return () => {
      mounted.current = false;
      stop();
      unwatch();
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key);
    };
  }, [api, onFinish]);
  const point = (event: ReactPointerEvent): [number, number] => {
    if (documentStage) {
      const rect = documentStage.getBoundingClientRect();
      return [
        ((event.clientX - rect.left) * 1000) / rect.width,
        ((event.clientY - rect.top) * 1000) / rect.width,
      ];
    }
    const state = api.getAppState();
    const scene = viewportCoordsToSceneCoords(event, {
      ...state,
      offsetLeft: state.offsetLeft || 0,
      offsetTop: state.offsetTop || 0,
    });
    return [scene.x, scene.y];
  };
  const placed = (event: ReactPointerEvent) => {
    const current = gesture.current!;
    const end = point(event);
    const dragging =
      Math.hypot(end[0] - current.start[0], end[1] - current.start[1]) > 3;
    const document = classroomCommands.read("document") as
      | { pen?: { color: string } }
      | undefined;
    return {
      ...object,
      color:
        document?.pen?.color ||
        api.getAppState().currentItemStrokeColor ||
        "#333333",
      position: {
        x: dragging ? Math.min(current.start[0], end[0]) : end[0],
        y: dragging ? Math.min(current.start[1], end[1]) : end[1],
      },
      width: dragging
        ? Math.max(80, Math.min(1600, Math.abs(end[0] - current.start[0])))
        : object.width,
      height: dragging
        ? Math.max(40, Math.min(1200, Math.abs(end[1] - current.start[1])))
        : object.height,
    };
  };
  const surface = (
    <svg
      ref={layer}
      className="fc-insertion-placement"
      data-insertion-placement={object.kind}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: documentStage ? 4 : 10,
        pointerEvents: "auto",
        touchAction: "none",
        cursor: "crosshair",
      }}
      onPointerDown={(event) => {
        if (forwardEraseContact(api, event)) {
          return;
        }
        if (done.current || gesture.current || event.button > 0) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        gesture.current = { id: event.pointerId, start: point(event) };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (gesture.current?.id !== event.pointerId) {
          return;
        }
        event.preventDefault();
        setPreview(placed(event));
      }}
      onPointerUp={(event) => {
        if (gesture.current?.id !== event.pointerId || done.current) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const value = placed(event);
        gesture.current = undefined;
        if (initialSurface.current !== classroomCommands.revision) {
          onFinish();
          return;
        }
        done.current = true;
        void renderInsertion(api, value, true, { exact: true, select: false })
          .then(async () => {
            if (
              !mounted.current ||
              initialSurface.current !== classroomCommands.revision
            ) {
              return;
            }
            if (classroomCommands.has("document.tool")) {
              await classroomCommands.execute({
                name: "document.tool",
                args: { tool: "freedraw" },
              });
            }
            if (
              mounted.current &&
              initialSurface.current === classroomCommands.revision
            ) {
              api.setActiveTool({ type: "freedraw" });
              onFinish();
            }
          })
          .catch((error) => {
            if (
              !mounted.current ||
              initialSurface.current !== classroomCommands.revision
            ) {
              return;
            }
            done.current = false;
            onError(error);
          });
      }}
      onPointerCancel={() => {
        gesture.current = undefined;
        setPreview(undefined);
      }}
      onLostPointerCapture={() => {
        gesture.current = undefined;
        setPreview(undefined);
      }}
    >
      {preview && (
        <g
          transform={
            documentStage
              ? `scale(${documentStage.getBoundingClientRect().width / 1000})`
              : `scale(${state.zoom.value}) translate(${state.scrollX} ${state.scrollY})`
          }
        >
          <g
            transform={`translate(${preview.position.x} ${preview.position.y})`}
          >
            {insertionShapes(preview).map((shape, index) =>
              shape.type === "rectangle" ? (
                <rect
                  key={index}
                  x={shape.x}
                  y={shape.y}
                  width={shape.width}
                  height={shape.height}
                  stroke={preview.color}
                  fill="none"
                />
              ) : shape.type === "line" ? (
                <polyline
                  key={index}
                  points={shape.points
                    ?.map(
                      ([x, y]) => `${x + (shape.x || 0)},${y + (shape.y || 0)}`,
                    )
                    .join(" ")}
                  stroke={preview.color}
                  fill="none"
                />
              ) : null,
            )}
          </g>
        </g>
      )}
    </svg>
  );
  return documentStage ? createPortal(surface, documentStage) : surface;
};
