import { useEffect, useState } from "react";
import { t } from "@fcboard/fcboard/i18n";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";
import type { FileId } from "@fcboard/element/types";

import { selectedPlot, updateFunctionGraph } from "./board";
import { classroomCommands } from "./commands";
import {
  functionGraphLocation,
  pickFunctionPoint,
  zoomFunctionGraph,
} from "./functionVisualization";

import "./FunctionGraphInteraction.scss";

import type { Plot } from "./math";
import type { InkStroke } from "./documents";

type Model = NonNullable<ReturnType<typeof selectedPlot>> & {
  left: number;
  top: number;
  width: number;
  height: number;
  angle: number;
};
type Contact = { x: number; y: number; target: Element };

/** The image remains an ordinary movable object. Only curve gestures and
 * zooms within its coordinate plane are owned here; there are no extra controls. */
export const FunctionGraphInteraction = ({
  api,
}: {
  api: FcboardImperativeAPI;
}) => {
  const [point, setPoint] = useState<{
    x: number;
    y: number;
    left: number;
    top: number;
    expression: string;
  }>();
  const [error, setError] = useState("");
  useEffect(() => {
    let model: Model | null = null;
    let pending: Plot | undefined;
    let frame = 0;
    let wheelEnd: ReturnType<typeof setTimeout> | undefined;
    let changed = false;
    let before: InkStroke[] | undefined;
    let fileId: FileId | undefined;
    let owner = "";
    let revision = 0;
    let targetIds = "";
    const contacts = new Map<number, Contact>();
    let cancelling = false;
    let drag:
      | {
          id: number;
          start: Contact;
          plot: Plot;
          from: { x: number; y: number };
          point: { x: number; y: number };
        }
      | undefined;
    let pinch:
      | { distance: number; plot: Plot; from: { x: number; y: number } }
      | undefined;
    const key = () => {
      const doc = classroomCommands.read("document") as
        | { id?: string; page?: number }
        | undefined;
      return doc ? `${doc.id}:${doc.page}` : "board";
    };
    const refresh = () => {
      const graph = selectedPlot(api);
      const image = graph?.image;
      const state = api.getAppState();
      const doc = classroomCommands.read("document") as
        | {
            tool?: string;
            viewport: {
              left: number;
              top: number;
              width: number;
              scroll: number;
            };
          }
        | undefined;
      const tool = doc?.tool || state.activeTool.type;
      if (!graph || !image || !["selection", "lasso"].includes(tool)) {
        model = null;
        setPoint(undefined);
        return;
      }
      const scale = doc ? doc.viewport.width / 1000 : state.zoom.value;
      model = {
        ...graph,
        left: doc
          ? doc.viewport.left + image.x * scale
          : (image.x + state.scrollX) * scale + (state.offsetLeft || 0),
        top: doc
          ? doc.viewport.top + (image.y - doc.viewport.scroll) * scale
          : (image.y + state.scrollY) * scale + (state.offsetTop || 0),
        width: image.width * scale,
        height: image.height * scale,
        angle: image.angle,
      };
      setPoint(undefined);
    };
    const local = (x: number, y: number) => {
      if (!model) {
        return null;
      }
      const dx = x - model.left - model.width / 2;
      const dy = y - model.top - model.height / 2;
      const u =
        (dx * Math.cos(model.angle) + dy * Math.sin(model.angle)) /
          model.width +
        0.5;
      const v =
        (-dx * Math.sin(model.angle) + dy * Math.cos(model.angle)) /
          model.height +
        0.5;
      const location = functionGraphLocation(u, v);
      return Object.values(location).every(
        (value) => Number.isFinite(value) && value >= 0 && value <= 1,
      )
        ? location
        : null;
    };
    const valid = () =>
      model &&
      owner === key() &&
      revision === classroomCommands.revision &&
      model.ids.join(",") === targetIds &&
      selectedPlot(api)?.ids.join(",") === targetIds;
    const begin = () => {
      if (changed) {
        return;
      }
      owner = key();
      revision = classroomCommands.revision;
      targetIds = model?.ids.join(",") || "";
      const doc = classroomCommands.read("document") as
        | { ink: InkStroke[] }
        | undefined;
      before = doc?.ink.filter((stroke) => model?.ids.includes(stroke.id));
      fileId = doc ? undefined : (crypto.randomUUID() as FileId);
      setError("");
    };
    const flush = (final = false) => {
      cancelAnimationFrame(frame);
      frame = 0;
      const next = pending || (final && changed ? model?.plot : undefined);
      pending = undefined;
      if (!next || !valid()) {
        return;
      }
      try {
        updateFunctionGraph(api, next, {
          preview: !final,
          fileId,
          before: final ? before : undefined,
          onError: (failure) =>
            setError(
              failure instanceof Error ? failure.message : String(failure),
            ),
        });
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    };
    const finish = () => {
      clearTimeout(wheelEnd);
      flush(true);
      changed = false;
      before = undefined;
      fileId = undefined;
    };
    const request = (next: Plot) => {
      if (!model) {
        return;
      }
      begin();
      changed = true;
      pending = next;
      model = { ...model, plot: next };
      setPoint(undefined);
      if (!frame) {
        frame = requestAnimationFrame(() => flush());
      }
    };
    const surface = (event: Event) =>
      event.target instanceof Element &&
      !!event.target.closest("canvas, .fc-document-ink");
    const wheel = (event: WheelEvent) => {
      if (!surface(event) || !model) {
        return;
      }
      const location = local(event.clientX, event.clientY);
      if (!location) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? model.height : 1);
      request(
        zoomFunctionGraph(
          model.plot,
          Math.exp(Math.max(-2, Math.min(2, -delta * 0.002))),
          location,
        ),
      );
      clearTimeout(wheelEnd);
      wheelEnd = setTimeout(finish, 160);
    };
    const down = (event: PointerEvent) => {
      if (!surface(event) || !model || event.button > 0) {
        return;
      }
      const from = local(event.clientX, event.clientY);
      if (!from) {
        return;
      }
      const contact = {
        x: event.clientX,
        y: event.clientY,
        target: event.target as Element,
      };
      if (event.pointerType === "touch") {
        contacts.set(event.pointerId, contact);
      }
      if (contacts.size === 2) {
        const [a, b] = [...contacts.values()];
        const center = local((a.x + b.x) / 2, (a.y + b.y) / 2)!;
        pinch = {
          distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          plot: model.plot,
          from: center,
        };
        drag = undefined;
        // Finish the editor's first contact before taking over a two-finger zoom.
        cancelling = true;
        for (const [id, item] of contacts) {
          item.target.dispatchEvent(
            new PointerEvent("pointercancel", {
              bubbles: true,
              pointerId: id,
              pointerType: "touch",
            }),
          );
        }
        cancelling = false;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      try {
        const hit = pickFunctionPoint(model.plot, from, model);
        if (hit) {
          drag = {
            id: event.pointerId,
            start: contact,
            plot: model.plot,
            from,
            point: hit,
          };
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    };
    const move = (event: PointerEvent) => {
      if (!model) {
        return;
      }
      const contact = contacts.get(event.pointerId);
      if (contact) {
        contacts.set(event.pointerId, {
          ...contact,
          x: event.clientX,
          y: event.clientY,
        });
      }
      if (pinch) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (contacts.size >= 2) {
          const [a, b] = [...contacts.values()];
          const to = local((a.x + b.x) / 2, (a.y + b.y) / 2);
          if (to) {
            request(
              zoomFunctionGraph(
                pinch.plot,
                Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance,
                pinch.from,
                to,
              ),
            );
          }
        }
      } else if (drag?.id === event.pointerId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const to = local(event.clientX, event.clientY);
        if (
          to &&
          Math.hypot(
            event.clientX - drag.start.x,
            event.clientY - drag.start.y,
          ) > 4
        ) {
          request(zoomFunctionGraph(drag.plot, 1, drag.from, to));
        }
      }
    };
    const up = (event: PointerEvent) => {
      if (cancelling) {
        return;
      }
      contacts.delete(event.pointerId);
      if (pinch) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!contacts.size) {
          pinch = undefined;
          finish();
        }
      } else if (drag?.id === event.pointerId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.type === "pointerup" && !changed && model) {
          setPoint({
            ...drag.point,
            left: event.clientX + 10,
            top: event.clientY - 28,
            expression: model.plot.expression,
          });
        }
        drag = undefined;
        finish();
      }
    };
    const reset = () => {
      finish();
      contacts.clear();
      drag = undefined;
      pinch = undefined;
      setPoint(undefined);
    };
    refresh();
    const stop = api.onChange(refresh);
    const watch = classroomCommands.watch("document", refresh);
    const invalidate = classroomCommands.onInvalidate(reset);
    const options = { capture: true, passive: false };
    window.addEventListener("wheel", wheel, options);
    window.addEventListener("pointerdown", down, options);
    window.addEventListener("pointermove", move, options);
    window.addEventListener("pointerup", up, options);
    window.addEventListener("pointercancel", up, options);
    window.addEventListener("blur", reset);
    window.addEventListener("resize", refresh);
    return () => {
      reset();
      stop();
      watch();
      invalidate();
      cancelAnimationFrame(frame);
      window.removeEventListener("wheel", wheel, options);
      window.removeEventListener("pointerdown", down, options);
      window.removeEventListener("pointermove", move, options);
      window.removeEventListener("pointerup", up, options);
      window.removeEventListener("pointercancel", up, options);
      window.removeEventListener("blur", reset);
      window.removeEventListener("resize", refresh);
    };
  }, [api]);
  return (
    <>
      {point && (
        <output
          className="fc-function-point"
          aria-label={t("fcboard.interactive_function_plot")}
          style={{ left: point.left, top: point.top }}
        >
          <span>y = {point.expression}</span>
          <span>
            x={Number(point.x.toPrecision(5))}, y=
            {Number(point.y.toPrecision(5))}
          </span>
        </output>
      )}
      {error && (
        <span role="alert" className="fc-function-error">
          {error}
        </span>
      )}
    </>
  );
};
