import { registerPlugin } from "@capacitor/core";

import type {
  NativeProjectionSurface,
  ProjectionBounds,
} from "@fcboard/fcboard/scene/types";

import type { PluginListenerHandle } from "@capacitor/core";

export const nativeProtocols = [
  "airplay",
  "miracast",
  "dlna",
  "cast",
  "castplus",
] as const;
export type NativeProtocol = typeof nativeProtocols[number];
type NativeReceiver = {
  state:
    | "starting"
    | "off"
    | "waiting"
    | "connecting"
    | "connected"
    | "error"
    | "p2pGroup"
    | "systemManaged"
    | "unavailable";
  name: string;
  revision: number;
  hasFrames: boolean;
  width: number;
  height: number;
  audio: boolean;
  title: string;
};
export type NativeReceivers = Record<NativeProtocol, NativeReceiver>;
export const nativeProjection = registerPlugin<{
  start(options: { protocol: NativeProtocol; session: string }): Promise<void>;
  stop(options: { protocol: NativeProtocol; session: string }): Promise<void>;
  disconnect(options: {
    revision: number;
    protocol: NativeProtocol;
    session: string;
  }): Promise<void>;
  addListener(
    event: "receiverChanged",
    listener: (event: { session: string }) => void,
  ): Promise<PluginListenerHandle>;
  status(options: { session: string }): Promise<NativeReceivers>;
  position(
    options: ProjectionBounds & { protocol: NativeProtocol; revision: number },
  ): Promise<void>;
}>("FcboardNativeProjection");

/** Native state and first-frame transitions wake the board. Every decoded frame goes directly to the Android compositor. */
export function watchNativeProjection(
  session: string,
  status: (receivers: NativeReceivers) => void,
  canDisplay: (protocol: NativeProtocol, revision: number) => boolean,
  display: (
    protocol: NativeProtocol,
    surface: NativeProjectionSurface,
    revision: number,
  ) => void,
  ended: (protocol: NativeProtocol, replaced: boolean) => void,
  failed: () => void,
) {
  let active:
    | {
        protocol: NativeProtocol;
        revision: number;
        surface: NativeProjectionSurface;
      }
    | undefined;
  let cancelled = false;
  let reading = false;
  let pendingRead = false;
  let previous = "";
  const release = (replaced = false) => {
    if (!active) {
      return;
    }
    const { protocol, surface } = active;
    active = undefined;
    surface.position(null);
    ended(protocol, replaced);
  };
  const tick = async () => {
    if (cancelled) {
      return;
    }
    if (reading) {
      pendingRead = true;
      return;
    }
    reading = true;
    try {
      const receivers = await nativeProjection.status({ session });
      if (cancelled) {
        return;
      }
      const signature = JSON.stringify(receivers);
      if (signature !== previous) {
        previous = signature;
        status(receivers);
      }
      const protocol = nativeProtocols
        .filter(
          (p) =>
            receivers[p].state === "connected" &&
            receivers[p].hasFrames &&
            !receivers[p].audio &&
            canDisplay(p, receivers[p].revision),
        )
        .sort((a, b) => receivers[b].revision - receivers[a].revision)[0];
      if (
        active &&
        (active.protocol !== protocol ||
          active.revision !== receivers[active.protocol].revision)
      ) {
        release(!!protocol && protocol !== active.protocol);
      }
      if (!protocol) {
        return;
      }
      const { width, height, revision } = receivers[protocol];
      if (!active) {
        let pending: ProjectionBounds | undefined;
        let sending = false;
        let lastBounds = "";
        const flush = async () => {
          sending = true;
          while (pending) {
            const transform = pending;
            pending = undefined;
            try {
              await nativeProjection.position({
                protocol,
                revision,
                ...transform,
              });
            } catch {
              lastBounds = "";
            }
          }
          sending = false;
        };
        const surface: NativeProjectionSurface = {
          width: width || 16,
          height: height || 9,
          position(bounds) {
            if (bounds && active?.surface !== surface) {
              return;
            }
            const transform = bounds ?? {
              cx: 0.5,
              cy: 0.5,
              width: 1,
              height: 1,
              angle: 0,
              viewport: window.innerWidth,
            };
            const key = JSON.stringify(transform);
            if (key === lastBounds) {
              return;
            }
            lastBounds = key;
            pending = transform;
            if (!sending) {
              void flush();
            }
          },
        };
        active = { protocol, revision, surface };
        display(protocol, surface, revision);
      } else if (
        width > 0 &&
        height > 0 &&
        (active.surface.width !== width || active.surface.height !== height)
      ) {
        active.surface.width = width;
        active.surface.height = height;
        display(protocol, active.surface, revision);
      }
    } catch {
      if (!cancelled) {
        release();
        failed();
      }
    } finally {
      reading = false;
      if (pendingRead) {
        pendingRead = false;
        void tick();
      }
    }
  };
  const listener = nativeProjection.addListener("receiverChanged", (event) => {
    if (event.session === session) {
      void tick();
    }
  });
  void listener.then(tick).catch(() => {
    if (!cancelled) {
      failed();
    }
  });
  return () => {
    cancelled = true;
    void listener.then((handle) => handle.remove()).catch(() => {});
    release();
  };
}
