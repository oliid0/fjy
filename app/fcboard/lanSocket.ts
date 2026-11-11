import { Capacitor } from "@capacitor/core";

import { Network } from "./network";

export interface LanSocket {
  readonly readyState: number;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send(text: string): void;
  close(code?: number, reason?: string): void;
}

/** A dedicated transport adapter; the browser's WebSocket is never patched. */
class NativeLanSocket implements LanSocket {
  readyState = 0;
  onmessage: LanSocket["onmessage"] = null;
  onclose: LanSocket["onclose"] = null;
  onerror: LanSocket["onerror"] = null;
  private id = crypto.randomUUID();
  private listener?: { remove(): Promise<void> };

  constructor(url: string) {
    void Network.addListener("peer", (event) => {
      if (event.id !== this.id || this.readyState === 3) {
        return;
      }
      if (event.type === "open") {
        this.readyState = 1;
      } else if (event.type === "message") {
        this.onmessage?.(new MessageEvent("message", { data: event.text }));
      } else {
        this.finish(event.code, event.text);
      }
    })
      .then(async (listener) => {
        this.listener = listener;
        if (this.readyState === 3) {
          await listener.remove();
          return;
        }
        await Network.connectPeer({ id: this.id, url });
        if (this.readyState === 3) {
          await Network.closePeer({ id: this.id });
        }
      })
      .catch(() => {
        if (this.readyState !== 3) {
          this.onerror?.(new Event("error"));
          this.finish(1006, "");
        }
      });
  }
  private finish(code: number, reason: string) {
    if (this.readyState === 3) {
      return;
    }
    this.readyState = 3;
    void this.listener?.remove().catch(() => {});
    this.onclose?.(new CloseEvent("close", { code, reason }));
  }
  send(text: string) {
    if (this.readyState !== 1) {
      throw new Error("Collaboration connection is not open");
    }
    void Network.sendPeer({ id: this.id, text }).catch(() => {
      this.onerror?.(new Event("error"));
      this.close(1006);
    });
  }
  close(code = 1000, reason = "") {
    this.finish(code, reason);
    void Network.closePeer({ id: this.id }).catch(() => {});
  }
}

export const createLanSocket = (url: string): LanSocket =>
  Capacitor.isNativePlatform() ? new NativeLanSocket(url) : new WebSocket(url);
