import { t } from "@fcboard/fcboard/i18n";

import { validateEndpoint } from "./settings";

import type { ScenePacket } from "./sceneSync";

export type CloudShareConfig = { endpoint: string; key: string };
const text = (
  key: "invalid_server" | "timeout" | "service_key" | "disconnected",
) => t(`fcboard.live_share.${key}`);
export const cloudShareAddress = (value: string) => {
  const endpoint = new URL(validateEndpoint(value.trim()));
  // The packaged viewer loads OCR, fonts and Vite assets from its origin root.
  if (endpoint.search || endpoint.hash || endpoint.pathname !== "/") {
    throw new Error(text("invalid_server"));
  }
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/`;
  return endpoint.href;
};
export const publicCloudShareEndpoint = (value: string) => {
  try {
    return cloudShareAddress(value);
  } catch {
    return "";
  }
};

/** Separate cloud transport credentials from AI/model settings and public UI inspection. */
export const loadCloudShare = (): CloudShareConfig => {
  try {
    return {
      endpoint:
        localStorage.getItem("fcboard-share-endpoint") ||
        "https://101.96.199.53/",
      key: sessionStorage.getItem("fcboard-share-key") || "",
    };
  } catch {
    return { endpoint: "https://101.96.199.53/", key: "" };
  }
};
export const saveCloudShare = (config: CloudShareConfig) => {
  try {
    localStorage.setItem("fcboard-share-endpoint", config.endpoint);
    sessionStorage.setItem("fcboard-share-key", config.key);
  } catch {
    /* A private session can still share without persisted configuration. */
  }
};

export class CloudShareHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
export const cloudShareRequest = async (
  url: string,
  key: string,
  method: string,
  value?: unknown,
  source?: AbortSignal,
) => {
  source?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(source?.reason);
  source?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error(text("timeout"))),
    15000,
  );
  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => {
      throw new Error(text("invalid_server"));
    });
    if (!response.ok) {
      throw new CloudShareHttpError(
        typeof result?.error === "string"
          ? result.error
          : `HTTP ${response.status}`,
        response.status,
      );
    }
    source?.throwIfAborted();
    return result as Record<string, unknown>;
  } catch (error) {
    if (controller.signal.aborted) {
      throw controller.signal.reason;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    source?.removeEventListener("abort", abort);
  }
};

type Events = {
  packet: (packet: ScenePacket, transport: CloudShare) => void;
  peers: (count: number) => void;
  status: (status: string) => void;
  error: (error: unknown) => void;
  ended: () => void;
};

/** Cloud uses the same scene packets and host password operations as LanServer. */
export class CloudShare {
  readonly url: string;
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private disposed = false;
  private ending = false;
  private attempts = 0;
  private ready = false;
  private accept?: () => void;
  private reject?: (reason: unknown) => void;
  private constructor(
    private endpoint: string,
    private room: string,
    private ownerKey: string,
    private events: Events,
  ) {
    this.url = `${endpoint}#lan=${room}`;
  }
  static async start(
    config: CloudShareConfig,
    scene: ScenePacket,
    events: Events,
    signal?: AbortSignal,
  ) {
    const endpoint = cloudShareAddress(config.endpoint);
    if (config.key.trim().length < 16) {
      throw new Error(text("service_key"));
    }
    const room = crypto.randomUUID().replace(/-/g, "");
    const key = crypto.randomUUID().replace(/-/g, "");
    const share = new CloudShare(endpoint, room, key, events);
    try {
      const result = await cloudShareRequest(
        `${endpoint}rooms`,
        config.key.trim(),
        "POST",
        { room, key, scene },
        signal,
      );
      if (result.room !== room || result.protocol !== 1) {
        throw new Error(text("invalid_server"));
      }
      await share.connect(signal);
      signal?.throwIfAborted();
      return share;
    } catch (error) {
      share.dispose();
      // Known client-generated credentials allow best-effort cleanup even after a lost create response.
      void cloudShareRequest(`${endpoint}rooms/${room}`, key, "DELETE").catch(
        () => {},
      );
      throw error;
    }
  }
  private connect(signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        this.accept = undefined;
        this.reject = undefined;
      };
      const abort = () => {
        cleanup();
        reject(signal?.reason || new DOMException("Canceled", "AbortError"));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(text("timeout")));
      }, 15000);
      this.accept = () => {
        cleanup();
        resolve();
      };
      this.reject = (error) => {
        cleanup();
        reject(error);
      };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      try {
        this.open();
      } catch (error) {
        this.reject?.(error);
      }
    });
  }
  private open() {
    if (this.disposed) {
      return;
    }
    const url = new URL(`host/${this.room}`, this.endpoint);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url.href);
    this.socket = socket;
    socket.onopen = () => {
      if (this.disposed || this.socket !== socket) {
        return;
      }
      socket.send(JSON.stringify({ kind: "host", key: this.ownerKey }));
      this.heartbeat = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send("ping");
        }
      }, 10000);
    };
    socket.onmessage = (event) => {
      if (this.disposed || this.socket !== socket || event.data === "pong") {
        return;
      }
      try {
        const packet = JSON.parse(String(event.data));
        if (typeof packet?.error === "string") {
          throw new Error(packet.error);
        }
        if (
          packet?.kind === "peers" &&
          Number.isSafeInteger(packet.count) &&
          packet.count >= 0
        ) {
          this.events.peers(packet.count);
        } else if (packet?.kind === "initial" || packet?.kind === "scene") {
          this.events.packet(packet, this);
          if (packet.kind === "initial") {
            this.ready = true;
            this.attempts = 0;
            this.accept?.();
            this.events.status("syncing_live");
          }
        } else {
          throw new Error(text("invalid_server"));
        }
      } catch (error) {
        this.reject?.(error);
        this.events.error(error);
      }
    };
    socket.onerror = () => {
      if (!this.disposed) {
        this.events.status("connection_interrupted_reconnecting");
      }
    };
    socket.onclose = (event) => {
      clearInterval(this.heartbeat);
      if (this.disposed || this.ending || this.socket !== socket) {
        return;
      }
      if (event.code === 1000) {
        this.reject?.(new Error(text("disconnected")));
        this.dispose();
        this.events.ended();
        return;
      }
      this.events.status("connection_interrupted_reconnecting");
      this.retry = setTimeout(
        () => this.open(),
        Math.min(10000, 500 * 2 ** Math.min(this.attempts++, 5)),
      );
    };
  }
  async send(packet: ScenePacket) {
    if (this.disposed || this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error(text("disconnected"));
    }
    this.socket.send(JSON.stringify(packet));
  }
  snapshot() {
    if (
      !this.disposed &&
      this.socket?.readyState === WebSocket.OPEN &&
      this.ready
    ) {
      this.socket.send("snapshot");
    }
  }
  async setPassword(password: string) {
    if (this.disposed) {
      throw new Error(text("disconnected"));
    }
    const result = await cloudShareRequest(
      `${this.endpoint}rooms/${this.room}/password`,
      this.ownerKey,
      "PUT",
      { password },
    );
    if (result.updated !== true) {
      throw new Error(text("invalid_server"));
    }
  }
  async end() {
    this.ending = true;
    try {
      const result = await cloudShareRequest(
        `${this.endpoint}rooms/${this.room}`,
        this.ownerKey,
        "DELETE",
      );
      if (result.ended !== true) {
        throw new Error(text("invalid_server"));
      }
      this.dispose();
    } finally {
      this.ending = false;
    }
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.retry);
    clearInterval(this.heartbeat);
    this.socket?.close(1000, "leave_collaboration");
    this.socket = undefined;
  }
}
