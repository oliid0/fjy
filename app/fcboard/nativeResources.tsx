import { useEffect, useRef, useState } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { registerNativeResourceRenderer } from "@fcboard/fcboard/nativeResourceRenderer";

import type { InteractiveResourceFrameProps } from "@fcboard/fcboard/components/InteractiveResourceFrame";
import type { ResourceControlState } from "@fcboard/fcboard/interactiveResourceControls";

const widgets = registerPlugin<{
  upsert(options: {
    instance: string;
    objectId: string;
    x: number;
    y: number;
    width: number;
    height: number;
    viewportWidth: number;
    dark: boolean;
    interactive: boolean;
    visible: boolean;
  }): Promise<void>;
  remove(options: { instance: string }): Promise<void>;
  control(options: {
    objectId: string;
    type: "inspect" | "click";
    version?: string;
    control?: string;
  }): Promise<ResourceControlState>;
  addListener(
    event: "action",
    listener: (event: {
      instance: string;
      type: "close" | "bounds";
      dx?: number;
      dy?: number;
      dw?: number;
      dh?: number;
    }) => void,
  ): Promise<{ remove(): Promise<void> }>;
}>("FcboardNativeWidgets");
const mounted = new Map<string, Promise<void>>();
const themes = new Map<string, boolean>();
export const setNativeCalculatorTheme = (id: string, dark: boolean) => {
  themes.set(id, dark);
  document.dispatchEvent(
    new CustomEvent("fcboard:native-calculator-theme", { detail: id }),
  );
};
export const hasNativeCalculator = () => Capacitor.getPlatform() === "android";
export const nativeCalculatorControl = async (
  objectId: string,
  action: { type: "inspect" | "click"; version?: string; control?: string },
  signal?: AbortSignal,
  current = () => true,
) => {
  const until = Date.now() + 3000;
  while (!mounted.has(objectId)) {
    signal?.throwIfAborted();
    if (!current()) {
      throw new DOMException("Calculator surface changed", "AbortError");
    }
    if (Date.now() > until) {
      throw new Error("Native calculator is not visible");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await mounted.get(objectId);
  signal?.throwIfAborted();
  if (!current()) {
    throw new DOMException("Calculator surface changed", "AbortError");
  }
  return widgets.control({ objectId, ...action });
};
const NativeCalculatorFrame = ({
  resource,
  objectId,
  window: host,
}: InteractiveResourceFrameProps) => {
  const node = useRef<HTMLDivElement>(null);
  const current = useRef(host);
  current.current = host;
  const [failure, setFailure] = useState("");
  useEffect(() => {
    const instance = crypto.randomUUID();
    let active = true;
    let frame = 0;
    let previous = "";
    const sync = () => {
      frame = 0;
      if (!active || !node.current) {
        return;
      }
      const box = node.current.getBoundingClientRect();
      const blockedByUi = [
        ...document.querySelectorAll<HTMLElement>(
          '[role="dialog"],[role="menu"],[role="listbox"],.fc-properties-popover,.fc-combined-toolbox',
        ),
      ].some((overlay) => {
        const bounds = overlay.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0;
      });
      const options = {
        instance,
        objectId,
        x: box.left,
        y: box.top,
        width: Math.max(1, box.width),
        height: Math.max(1, box.height),
        viewportWidth: innerWidth,
        interactive: getComputedStyle(node.current).pointerEvents !== "none",
        dark:
          themes.get(objectId) ??
          resource.html.includes('data-board-theme="dark"'),
        visible:
          document.visibilityState !== "hidden" &&
          box.width > 0 &&
          box.height > 0 &&
          box.right > 0 &&
          box.bottom > 0 &&
          box.left < innerWidth &&
          box.top < innerHeight &&
          !blockedByUi,
      };
      const signature = JSON.stringify(options);
      if (signature === previous) {
        return;
      }
      previous = signature;
      const ready = widgets.upsert(options).catch((error) => {
        if (active) {
          void widgets.remove({ instance }).catch(() => {});
          setFailure(error instanceof Error ? error.message : String(error));
        }
        throw error;
      });
      mounted.set(objectId, ready);
      void ready.catch(() => {});
    };
    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(sync);
      }
    };
    const listener = widgets.addListener("action", (event) => {
      if (!active || event.instance !== instance) {
        return;
      }
      const host = current.current;
      if (!host) {
        return;
      }
      if (event.type === "close") {
        host.onClose();
        return;
      }
      const values = [event.dx, event.dy, event.dw, event.dh];
      if (
        event.type !== "bounds" ||
        !values.every(
          (value) =>
            typeof value === "number" &&
            Number.isFinite(value) &&
            Math.abs(value) < 20000,
        )
      ) {
        return;
      }
      const scale = host.scale || 1;
      const bounds = {
        x: host.bounds.x + event.dx! / scale,
        y: host.bounds.y + event.dy! / scale,
        width: Math.max(72 / scale, host.bounds.width + event.dw! / scale),
        height: Math.max(144 / scale, host.bounds.height + event.dh! / scale),
      };
      if (host.viewport) {
        bounds.width = Math.min(
          bounds.width,
          host.viewport.right - host.viewport.left,
        );
        bounds.height = Math.min(
          bounds.height,
          host.viewport.bottom - host.viewport.top,
        );
        bounds.x = Math.max(
          host.viewport.left,
          Math.min(host.viewport.right - bounds.width, bounds.x),
        );
        bounds.y = Math.max(
          host.viewport.top,
          Math.min(host.viewport.bottom - bounds.height, bounds.y),
        );
      }
      host.onCommit(bounds);
      previous = "";
      schedule();
    });
    const theme = (event: Event) => {
      if ((event as CustomEvent).detail === objectId) {
        schedule();
      }
    };
    document.addEventListener("fcboard:native-calculator-theme", theme);
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    const resize = new ResizeObserver(schedule);
    if (node.current) {
      resize.observe(node.current);
    }
    addEventListener("resize", schedule);
    addEventListener("scroll", schedule, true);
    document.addEventListener("visibilitychange", schedule);
    schedule();
    return () => {
      active = false;
      mounted.delete(objectId);
      themes.delete(objectId);
      document.removeEventListener("fcboard:native-calculator-theme", theme);
      cancelAnimationFrame(frame);
      observer.disconnect();
      resize.disconnect();
      removeEventListener("resize", schedule);
      removeEventListener("scroll", schedule, true);
      document.removeEventListener("visibilitychange", schedule);
      void listener.then((handle) => handle.remove()).catch(() => {});
      void widgets.remove({ instance }).catch(() => {});
    };
  }, [objectId, resource.html]);
  return (
    <div
      ref={node}
      data-native-resource-object-id={objectId}
      role="group"
      aria-label={resource.title}
      style={{ width: "100%", height: "100%" }}
    >
      {failure && <p role="alert">{failure}</p>}
    </div>
  );
};
if (hasNativeCalculator()) {
  registerNativeResourceRenderer((props) =>
    props.resource.id === "builtin-calculator" && props.window ? (
      <NativeCalculatorFrame {...props} />
    ) : undefined,
  );
}
