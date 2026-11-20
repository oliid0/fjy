import { registerPlugin } from "@capacitor/core";
import type {
  NativeProjectionSurface,
  ProjectionBounds,
} from "@fcboard/fcboard/scene/types";

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
    protocol: NativeProtocol;
    session: string;
  }): Promise<void>;
  status(options: { session: string }): Promise<NativeReceivers>;
  position(
    options: ProjectionBounds & { protocol: NativeProtocol; revision: number },
  ): Promise<void>;
}>("FcboardNativeProjection");

/** Poll state only. Every decoded frame goes directly to the Android compositor. */
export function watchNativeProjection(
  session: string,
  status: (receivers: NativeReceivers) => void,
  canDisplay: (protocol: NativeProtocol) => boolean,
  display: (protocol: NativeProtocol, surface: NativeProjectionSurface) => void,
  ended: (protocol: NativeProtocol) => void,
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
  let timer: ReturnType<typeof setTimeout>;
  let previous = "";
  const release = () => {
    if (!active) return;
    const { protocol, surface } = active;
    active = undefined;
    surface.position(null);
    ended(protocol);
  };
  const tick = async () => {
    try {
      const receivers = await nativeProjection.status({ session });
      if (cancelled) return;
      const signature = JSON.stringify(receivers);
      if (signature !== previous) {
        previous = signature;
        status(receivers);
      }
      if (
        active &&
        (receivers[active.protocol].revision !== active.revision ||
          !receivers[active.protocol].hasFrames ||
          receivers[active.protocol].audio ||
          receivers[active.protocol].state !== "connected" ||
          !canDisplay(active.protocol))
      )
        release();
      const protocol =
        active?.protocol ||
        nativeProtocols.find(
          (p) =>
            receivers[p].state === "connected" &&
            receivers[p].hasFrames &&
            !receivers[p].audio &&
            canDisplay(p),
        );
      if (!protocol) return;
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
            if (bounds && active?.surface !== surface) return;
            const transform = bounds ?? {
              cx: 0.5,
              cy: 0.5,
              width: 1,
              height: 1,
              angle: 0,
              viewport: window.innerWidth,
            };
            const key = JSON.stringify(transform);
            if (key === lastBounds) return;
            lastBounds = key;
            pending = transform;
            if (!sending) void flush();
          },
        };
        active = { protocol, revision, surface };
        display(protocol, surface);
      } else if (
        width > 0 &&
        height > 0 &&
        (active.surface.width !== width || active.surface.height !== height)
      ) {
        active.surface.width = width;
        active.surface.height = height;
        display(protocol, active.surface);
      }
    } catch {
      if (!cancelled) {
        release();
        failed();
      }
    } finally {
      if (!cancelled) timer = setTimeout(() => void tick(), 240);
    }
  };
  void tick();
  return () => {
    cancelled = true;
    clearTimeout(timer);
    release();
  };
}
