import { registerPlugin } from "@capacitor/core";

import type { PluginListenerHandle } from "@capacitor/core";
import type { ScenePacket } from "./sceneSync";

export const Network = registerPlugin<{
  startCollaboration(options: {
    scene: ScenePacket;
  }): Promise<{ urls: string[] }>;
  stopCollaboration(): Promise<void>;
  sendScene(options: { message: string }): Promise<void>;
  getScene(): Promise<ScenePacket>;
  startRemote(): Promise<{ urls: string[]; pin: string; expiresAt: number }>;
  stopRemote(): Promise<void>;
  openWirelessSettings(): Promise<void>;
  addListener(
    event: "message",
    listener: (
      message:
        | ScenePacket
        | { kind: "peers"; count: number }
        | { kind: "remote"; state: string }
        | { kind: "ended" },
    ) => void,
  ): Promise<PluginListenerHandle>;
}>("FcboardNetwork");
