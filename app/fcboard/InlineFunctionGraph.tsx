import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import { t, useI18n } from "@fcboard/fcboard/i18n";

import {
  drawFunctionGraph,
  functionGraphLocation,
  graphNumber,
  plotSize,
  zoomFunctionGraph,
} from "./functionVisualization";

import type { Plot } from "./math";
import type { Ref } from "react";

export type FunctionGraphInput = { down: (event: PointerEvent) => boolean };

export type GraphTranslation = {
  dx: number;
  dy: number;
  phase: "start" | "move" | "end" | "cancel";
};
type Contact = { x: number; y: number };

/** A floating function object, with no iframe, SVG DOM or extra controls.
 * One contact moves the selected object; two or more change its numeric domain. */
export const InlineFunctionGraph = ({
  id,
  plot,
  color,
  strokeWidth = 2,
  strokeStyle = "solid",
  onCommit,
  onError,
  onTranslate,
  interactive = true,
  angle = 0,
  displaySize,
  inputRef,
  onIdle,
}: {
  id: string;
  plot: Plot;
  color: string;
  strokeWidth?: number;
  strokeStyle?: "solid" | "dashed" | "dotted";
  onCommit: (plot: Plot) => void;
  onError: (message: string) => void;
  onTranslate?: (change: GraphTranslation) => void;
  interactive?: boolean;
  angle?: number;
  displaySize?: { width: number; height: number };
  inputRef?: Ref<FunctionGraphInput>;
  onIdle?: () => void;
}) => {
  useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const props = useRef({
    plot,
    color,
    strokeWidth,
    strokeStyle,
    onCommit,
    onError,
    onTranslate,
    interactive,
    angle,
    displaySize,
  });
  props.current = {
    plot,
    color,
    strokeWidth,
    strokeStyle,
    onCommit,
    onError,
    onTranslate,
    interactive,
    angle,
    displaySize,
  };
  const current = useRef(plot);
  const contacts = useRef(new Map<number, Contact>());
  const gesture = useRef<
    | {
        kind: "object" | "range" | "pending";
        plot: Plot;
        origin: Contact;
        center: Contact;
        radius: number;
        rect: DOMRect;
        moved: boolean;
      }
    | undefined
  >(undefined);
  const frame = useRef(0);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const paint = useCallback(() => {
    const target = canvas.current;
    if (!target) {
      return;
    }
    const rect = target.getBoundingClientRect();
    const size = props.current.displaySize;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(
      1,
      Math.min(
        4096,
        Math.round((size?.width || rect.width || plotSize.width) * ratio),
      ),
    );
    const height = Math.max(
      1,
      Math.min(
        4096,
        Math.round((size?.height || rect.height || plotSize.height) * ratio),
      ),
    );
    if (target.width !== width || target.height !== height) {
      target.width = width;
      target.height = height;
    }
    const context = target.getContext("2d");
    if (!context) {
      props.current.onError(t("fcboard.functionGraph.invalid"));
      return;
    }
    try {
      context.setTransform(
        width / plotSize.width,
        0,
        0,
        height / plotSize.height,
        0,
        0,
      );
      const data = drawFunctionGraph(
        context,
        current.current,
        props.current.color,
        plotSize,
        {
          width: props.current.strokeWidth,
          strokeStyle: props.current.strokeStyle,
        },
      );
      if (data.intersections.length) {
        target.setAttribute(
          "aria-description",
          `${t("fcboard.functionGraph.intersections")}: ${data.intersections
            .map(
              (value) =>
                `${value.label} (${graphNumber(value.x)}, ${graphNumber(
                  value.y,
                )})`,
            )
            .join("; ")}`,
        );
      } else {
        target.removeAttribute("aria-description");
      }
    } catch (failure) {
      props.current.onError(
        failure instanceof Error ? failure.message : String(failure),
      );
    }
  }, []);
  const redraw = useCallback(
    (next: Plot) => {
      current.current = next;
      if (!frame.current) {
        frame.current = requestAnimationFrame(() => {
          frame.current = 0;
          paint();
        });
      }
    },
    [paint],
  );
  const centerOf = () => {
    const values = [...contacts.current.values()];
    const center = {
      x: values.reduce((sum, p) => sum + p.x, 0) / values.length,
      y: values.reduce((sum, p) => sum + p.y, 0) / values.length,
    };
    const radius = Math.sqrt(
      values.reduce(
        (sum, p) => sum + (p.x - center.x) ** 2 + (p.y - center.y) ** 2,
        0,
      ) / values.length,
    );
    return { center, radius };
  };
  const location = (
    point: Contact,
    rect = gesture.current?.rect || canvas.current!.getBoundingClientRect(),
  ) => {
    const dx = point.x - rect.left - rect.width / 2;
    const dy = point.y - rect.top - rect.height / 2;
    const cos = Math.cos(props.current.angle);
    const sin = Math.sin(props.current.angle);
    const width =
      props.current.displaySize?.width || rect.width || plotSize.width;
    const height =
      props.current.displaySize?.height || rect.height || plotSize.height;
    return functionGraphLocation(
      0.5 + (dx * cos + dy * sin) / width,
      0.5 + (-dx * sin + dy * cos) / height,
    );
  };
  const rebase = () => {
    const active = gesture.current;
    if (!active) {
      return;
    }
    const { center, radius } = centerOf();
    active.plot = current.current;
    active.center = center;
    active.radius = radius;
  };
  const move = () => {
    const active = gesture.current;
    if (!active || active.kind === "pending" || !contacts.current.size) {
      return;
    }
    const { center, radius } = centerOf();
    active.moved ||=
      Math.hypot(center.x - active.origin.x, center.y - active.origin.y) > 2;
    if (active.kind === "object" && props.current.onTranslate) {
      props.current.onTranslate({
        dx: center.x - active.origin.x,
        dy: center.y - active.origin.y,
        phase: "move",
      });
    } else {
      redraw(
        zoomFunctionGraph(
          active.plot,
          active.radius > 0 && radius > 0 ? radius / active.radius : 1,
          location(active.center),
          location(center),
        ),
      );
    }
  };
  const cancel = () => {
    if (gesture.current?.kind === "object") {
      props.current.onTranslate?.({ dx: 0, dy: 0, phase: "cancel" });
    }
    contacts.current.clear();
    gesture.current = undefined;
    redraw(props.current.plot);
    onIdle?.();
  };
  useLayoutEffect(() => {
    current.current = plot;
    paint();
  }, [
    plot,
    color,
    strokeWidth,
    strokeStyle,
    displaySize?.width,
    displaySize?.height,
    paint,
  ]);
  useLayoutEffect(() => {
    const target = canvas.current!;
    const wheel = (event: WheelEvent) => {
      if (!props.current.interactive) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const factor = Math.exp(
        -Math.max(
          -500,
          Math.min(500, event.deltaY * (event.deltaMode ? 16 : 1)),
        ) / 500,
      );
      redraw(
        zoomFunctionGraph(
          current.current,
          factor,
          location({ x: event.clientX, y: event.clientY }),
        ),
      );
      clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(
        () => props.current.onCommit(current.current),
        160,
      );
    };
    target.addEventListener("wheel", wheel, { passive: false });
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(() => redraw(current.current));
    observer?.observe(target);
    return () => {
      target.removeEventListener("wheel", wheel);
      observer?.disconnect();
      clearTimeout(wheelTimer.current);
      cancelAnimationFrame(frame.current);
      if (gesture.current?.kind === "object") {
        props.current.onTranslate?.({ dx: 0, dy: 0, phase: "cancel" });
      }
    };
  }, [id, redraw]);
  const pointerDown = (event: PointerEvent) => {
    const target = canvas.current;
    if (!target) {
      return false;
    }
    if (!props.current.interactive || event.button !== 0) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    clearTimeout(wheelTimer.current);
    contacts.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    target.setPointerCapture(event.pointerId);
    if (!gesture.current) {
      const origin = { x: event.clientX, y: event.clientY };
      gesture.current = {
        kind: props.current.onTranslate ? "object" : "pending",
        plot: current.current,
        origin,
        center: origin,
        radius: 0,
        rect: target.getBoundingClientRect(),
        moved: false,
      };
      props.current.onTranslate?.({ dx: 0, dy: 0, phase: "start" });
    } else if (contacts.current.size >= 2) {
      if (gesture.current.kind === "object") {
        props.current.onTranslate?.({ dx: 0, dy: 0, phase: "cancel" });
      }
      gesture.current.kind = "range";
      gesture.current.moved = true;
      rebase();
    }
    return true;
  };
  useImperativeHandle(inputRef, () => ({ down: pointerDown }));
  return (
    <div
      className="fc-inline-function"
      style={{ pointerEvents: interactive ? "auto" : "none" }}
      aria-label={`y = ${plot.expression}`}
    >
      <canvas
        ref={canvas}
        style={{ pointerEvents: interactive ? "auto" : "none" }}
        aria-label={[plot.expression, ...(plot.compare || [])]
          .map((expression) => `y = ${expression}`)
          .join("; ")}
        onPointerDown={(event) => {
          if (pointerDown(event.nativeEvent)) {
            event.stopPropagation();
          }
        }}
        onPointerMove={(event) => {
          if (!contacts.current.has(event.pointerId)) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          contacts.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
          });
          move();
        }}
        onPointerUp={(event) => {
          if (!contacts.current.has(event.pointerId)) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          contacts.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
          });
          move();
          const active = gesture.current;
          contacts.current.delete(event.pointerId);
          if (contacts.current.size) {
            rebase();
          } else if (active) {
            gesture.current = undefined;
            if (active.kind === "object") {
              onTranslate?.({
                dx: event.clientX - active.origin.x,
                dy: event.clientY - active.origin.y,
                phase: "end",
              });
            } else if (active.moved) {
              props.current.onCommit(current.current);
            }
            onIdle?.();
          }
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={(event) => {
          if (contacts.current.has(event.pointerId)) {
            event.stopPropagation();
            cancel();
          }
        }}
        onLostPointerCapture={(event) => {
          if (contacts.current.has(event.pointerId)) {
            cancel();
          }
        }}
      />
    </div>
  );
};
