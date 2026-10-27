export type ResourceSurface = "whiteboard" | "document";
export type ResourcePoint = { x: number; y: number };
export type ResourceControlState = {
  version: string;
  title: string;
  viewport: { width: number; height: number };
  offset: number;
  total: number;
  controls: {
    id: string;
    label: string;
    type: string;
    disabled: boolean;
    value: string | boolean;
    kind?: string;
    role?: string;
    bounds?: ResourcePoint & { width: number; height: number };
    min?: string;
    max?: string;
    step?: string;
    options?: { value: string; label: string; disabled: boolean }[];
  }[];
  outputs: string[];
  truncated: boolean;
};
export type ResourceControlRequest =
  | { type: "inspect"; offset?: number }
  | { type: "click"; version: string; control: string; from?: ResourcePoint }
  | {
      type: "drag";
      version: string;
      control: string;
      from?: ResourcePoint;
      to: ResourcePoint;
    }
  | {
      type: "set";
      version: string;
      control: string;
      value: string | number | boolean;
    };
export type ResourceControlTarget = {
  surface: ResourceSurface;
  id: string;
  html: string;
};

type Frame = ResourceControlTarget & {
  node: HTMLIFrameElement;
  ready: boolean;
};
const frames = new Set<Frame>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

/** Each mounted object owns its channel; copies and hidden surfaces never share it. */
export const attachResourceControls = (
  target: ResourceControlTarget,
  node: HTMLIFrameElement,
) => {
  const frame = { ...target, node, ready: false };
  frames.add(frame);
  changed();
  return {
    loaded: () => {
      // Invalidate pending work on a reload, even if the HTML stayed the same.
      frame.ready = false;
      changed();
      frame.ready = true;
      changed();
    },
    dispose: () => {
      frames.delete(frame);
      changed();
    },
  };
};

const isState = (value: unknown): value is ResourceControlState => {
  const state = value as ResourceControlState | undefined;
  try {
    if (JSON.stringify(state).length > 64000) {
      return false;
    }
  } catch {
    return false;
  }
  return (
    !!state &&
    typeof state.version === "string" &&
    !!state.version &&
    state.version.length <= 100 &&
    typeof state.title === "string" &&
    state.title.length <= 160 &&
    !!state.viewport &&
    [state.viewport.width, state.viewport.height].every(
      (value) => Number.isFinite(value) && value > 0 && value <= 100000,
    ) &&
    Number.isInteger(state.offset) &&
    state.offset >= 0 &&
    state.offset <= 50000 &&
    Number.isInteger(state.total) &&
    state.total >= 0 &&
    state.total <= 50000 &&
    typeof state.truncated === "boolean" &&
    Array.isArray(state.outputs) &&
    state.outputs.length <= 32 &&
    state.outputs.every(
      (item) => typeof item === "string" && item.length <= 500,
    ) &&
    Array.isArray(state.controls) &&
    state.controls.length <= 80 &&
    new Set(state.controls.map((item) => item?.id)).size ===
      state.controls.length &&
    state.controls.every(
      (item) =>
        item &&
        typeof item.id === "string" &&
        item.id.length <= 20 &&
        /^c\d+$/.test(item.id) &&
        typeof item.label === "string" &&
        item.label.length <= 500 &&
        typeof item.type === "string" &&
        item.type.length <= 20 &&
        typeof item.disabled === "boolean" &&
        (typeof item.value === "boolean" ||
          (typeof item.value === "string" && item.value.length <= 500)) &&
        (item.kind === undefined ||
          (typeof item.kind === "string" && item.kind.length <= 20)) &&
        (item.role === undefined ||
          (typeof item.role === "string" && item.role.length <= 80)) &&
        (item.bounds === undefined ||
          (Object.values(item.bounds).every(
            (value) => Number.isFinite(value) && Math.abs(value) <= 100000,
          ) &&
            [
              item.bounds.x,
              item.bounds.y,
              item.bounds.width,
              item.bounds.height,
            ].every(Number.isFinite) &&
            item.bounds.width >= 0 &&
            item.bounds.height >= 0)) &&
        (item.options === undefined ||
          (Array.isArray(item.options) &&
            item.options.length <= 80 &&
            item.options.every(
              (option) =>
                option &&
                typeof option.value === "string" &&
                option.value.length <= 500 &&
                typeof option.label === "string" &&
                option.label.length <= 500 &&
                typeof option.disabled === "boolean",
            ))),
    )
  );
};

/** Wait for React/iframe load, then transfer one reply port into the opaque sandbox. */
export const requestResourceControl = (
  target: ResourceControlTarget,
  request: ResourceControlRequest,
  options: { signal?: AbortSignal; current: () => boolean },
): Promise<ResourceControlState> =>
  new Promise((resolve, reject) => {
    let channel: MessageChannel | undefined;
    let active: Frame | undefined;
    let finished = false;
    const finish = (error?: Error, state?: ResourceControlState) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      listeners.delete(attempt);
      options.signal?.removeEventListener("abort", abort);
      if (channel) {
        channel.port1.onmessage = null;
        channel.port1.close();
        channel.port2.close();
      }
      if (error) {
        reject(error);
      } else {
        resolve(state!);
      }
    };
    const abort = () =>
      finish(new DOMException("Resource operation cancelled", "AbortError"));
    const attempt = () => {
      if (finished) {
        return;
      }
      if (options.signal?.aborted || !options.current()) {
        abort();
        return;
      }
      const matches = Array.from(frames).filter(
        (frame) =>
          frame.surface === target.surface &&
          frame.id === target.id &&
          frame.html === target.html,
      );
      if (matches.length > 1) {
        finish(new Error("RESOURCE_AMBIGUOUS_OBJECT"));
        return;
      }
      if (active) {
        if (matches[0] !== active || !active.ready) {
          abort();
        }
        return;
      }
      const frame = matches[0];
      if (!frame?.ready || !frame.node.contentWindow) {
        return;
      }
      active = frame;
      try {
        channel = new MessageChannel();
        channel.port1.onmessage = (event: MessageEvent) => {
          if (!options.current() || options.signal?.aborted) {
            abort();
          } else if (event.data?.ok === true && isState(event.data.state)) {
            finish(undefined, event.data.state);
          } else {
            finish(
              new Error(
                event.data?.ok === false && typeof event.data.error === "string"
                  ? event.data.error.slice(0, 160)
                  : "RESOURCE_INVALID_RESPONSE",
              ),
            );
          }
        };
        // srcdoc has an opaque origin; the transferred port scopes the response.
        frame.node.contentWindow.postMessage(
          { type: "fc-resource-control-v1", request },
          "*",
          [channel.port2],
        );
      } catch (error) {
        finish(
          error instanceof Error
            ? error
            : new Error("RESOURCE_CHANNEL_UNAVAILABLE"),
        );
      }
    };
    const timeout = setTimeout(
      () => finish(new Error("RESOURCE_NOT_READY")),
      5000,
    );
    listeners.add(attempt);
    options.signal?.addEventListener("abort", abort, { once: true });
    attempt();
  });
