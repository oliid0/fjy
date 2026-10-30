import { useEffect, useRef, useState } from "react";

import { t } from "../i18n";

import { FactoryWebIcon, FactoryWebResizeIcon } from "./FactoryWebIcon";

import "./ResourceWindow.scss";

import type {
  ReactNode,
  PointerEvent,
  KeyboardEvent,
  CSSProperties,
} from "react";

export type ResourceWindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** layout_min_web_window.xml, with the requested move/resize handles added to its chrome. */
export const ResourceWindow = ({
  title,
  bounds,
  scale = 1,
  viewport,
  onCommit,
  onClose,
  onReload,
  children,
}: {
  title: string;
  bounds: ResourceWindowBounds;
  scale?: number;
  viewport?: { left: number; top: number; right: number; bottom: number };
  onCommit: (bounds: ResourceWindowBounds) => void;
  onClose: () => void;
  onReload: () => void;
  children: ReactNode;
}) => {
  const [preview, setPreview] = useState<ResourceWindowBounds>();
  const gesture = useRef<
    | {
        id: number;
        x: number;
        y: number;
        mode: "move" | "resize";
        before: ResourceWindowBounds;
        next: ResourceWindowBounds;
      }
    | undefined
  >(undefined);
  const cancel = () => {
    gesture.current = undefined;
    setPreview(undefined);
  };
  useEffect(() => {
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
    };
  }, []);
  const bounded = (box: ResourceWindowBounds): ResourceWindowBounds => {
    if (!viewport) {
      return {
        ...box,
        width: Math.max(240 / scale, box.width),
        height: Math.max(180 / scale, box.height),
      };
    }
    const width = Math.max(
      Math.min(240 / scale, viewport.right - viewport.left),
      Math.min(box.width, viewport.right - viewport.left),
    );
    const height = Math.max(
      Math.min(180 / scale, viewport.bottom - viewport.top),
      Math.min(box.height, viewport.bottom - viewport.top),
    );
    return {
      x: Math.max(viewport.left, Math.min(viewport.right - width, box.x)),
      y: Math.max(viewport.top, Math.min(viewport.bottom - height, box.y)),
      width,
      height,
    };
  };
  const start = (event: PointerEvent, mode: "move" | "resize") => {
    event.stopPropagation();
    if (gesture.current || event.isPrimary === false || event.button > 0) {
      return;
    }
    event.preventDefault();
    gesture.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      mode,
      before: bounds,
      next: bounds,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    const drag = gesture.current;
    if (drag?.id !== event.pointerId) {
      return;
    }
    const x = (event.clientX - drag.x) / scale;
    const y = (event.clientY - drag.y) / scale;
    drag.next = bounded(
      drag.mode === "move"
        ? { ...drag.before, x: drag.before.x + x, y: drag.before.y + y }
        : {
            ...drag.before,
            width: drag.before.width + x,
            height: drag.before.height + y,
          },
    );
    setPreview(drag.next);
  };
  const finish = (event: PointerEvent) => {
    const drag = gesture.current;
    if (drag?.id !== event.pointerId) {
      return;
    }
    gesture.current = undefined;
    setPreview(undefined);
    if (
      Object.keys(drag.before).some(
        (key) =>
          drag.before[key as keyof ResourceWindowBounds] !==
          drag.next[key as keyof ResourceWindowBounds],
      )
    ) {
      onCommit(drag.next);
    }
  };
  const key = (event: KeyboardEvent, mode: "move" | "resize") => {
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-16, 0],
      ArrowRight: [16, 0],
      ArrowUp: [0, -16],
      ArrowDown: [0, 16],
    };
    const next = delta[event.key];
    if (!next) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onCommit(
      bounded(
        mode === "move"
          ? {
              ...bounds,
              x: bounds.x + next[0] / scale,
              y: bounds.y + next[1] / scale,
            }
          : {
              ...bounds,
              width: bounds.width + next[0] / scale,
              height: bounds.height + next[1] / scale,
            },
      ),
    );
  };
  return (
    <section
      className="fc-resource-window"
      aria-label={title}
      style={
        {
          "--resource-unit": `${1 / scale}px`,
          ...(preview
            ? {
                transform: `translate(${preview.x - bounds.x}px, ${
                  preview.y - bounds.y
                }px)`,
                width: preview.width,
                height: preview.height,
              }
            : {}),
        } as CSSProperties
      }
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div
        className="fc-resource-window-drag"
        role="button"
        tabIndex={0}
        aria-label={title}
        onPointerDown={(event) => start(event, "move")}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onKeyDown={(event) => key(event, "move")}
      >
        {title}
      </div>
      <div className="fc-resource-window-content">{children}</div>
      <footer>
        <button type="button" disabled aria-label={t("fcboard.previous")}>
          <FactoryWebIcon name="back" />
        </button>
        <button type="button" disabled aria-label={t("fcboard.next")}>
          <FactoryWebIcon name="back" forward />
        </button>
        <button
          type="button"
          aria-label={t("fcboard.reset")}
          onClick={onReload}
        >
          <FactoryWebIcon name="reload" />
        </button>
        <button
          type="button"
          aria-label={t("fcboard.close_website")}
          onClick={onClose}
        >
          <FactoryWebIcon name="close" />
        </button>
      </footer>
      <button
        type="button"
        className="fc-resource-window-resize"
        aria-label={t("fcboard.size")}
        onPointerDown={(event) => start(event, "resize")}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onKeyDown={(event) => key(event, "resize")}
      >
        <FactoryWebResizeIcon />
      </button>
    </section>
  );
};
