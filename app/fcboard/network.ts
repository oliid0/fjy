import { registerPlugin } from "@capacitor/core";

import type { PluginListenerHandle } from "@capacitor/core";
import type { ScenePacket } from "./sceneSync";

export const Network = registerPlugin<{
  startCollaboration(options: {
    scene: ScenePacket;
  }): Promise<{ urls: string[] }>;
  setCollaborationPassword(options: { password: string }): Promise<void>;
  stopCollaboration(): Promise<void>;
  sendScene(options: { message: string }): Promise<void>;
  getScene(): Promise<ScenePacket>;
  addListener(
    event: "message",
    listener: (
      message:
        | ScenePacket
        | { kind: "peers"; count: number }
        | { kind: "ended" },
    ) => void,
  ): Promise<PluginListenerHandle>;
}>("FcboardNetwork");
