import { registerPlugin } from "@capacitor/core";

import type { PluginListenerHandle } from "@capacitor/core";
import type { ScenePacket } from "./sceneSync";

export const Network = registerPlugin<{
  startCollaboration(options: {
    scene: ScenePacket;
  }): Promise<{ urls: string[]; code?: string }>;
  resolveCollaborationCode(options: {
    id: string;
    code: string;
  }): Promise<{ url: string }>;
  cancelCollaborationLookup(options: { id: string }): Promise<void>;
  setCollaborationPassword(options: { password: string }): Promise<void>;
  stopCollaboration(): Promise<void>;
  sendScene(options: { message: string }): Promise<void>;
  getScene(): Promise<ScenePacket>;
  connectPeer(options: { id: string; url: string }): Promise<void>;
  sendPeer(options: { id: string; text: string }): Promise<void>;
  closePeer(options: { id: string }): Promise<void>;
  addListener(
    event: "peer",
    listener: (message: {
      id: string;
      type: "open" | "message" | "close";
      text: string;
      code: number;
    }) => void,
  ): Promise<PluginListenerHandle>;
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
