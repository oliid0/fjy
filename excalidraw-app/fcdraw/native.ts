import { registerPlugin } from "@capacitor/core";

import type { PluginListenerHandle } from "@capacitor/core";

export type Upload = { id: string; name: string; path: string; size: number };
export type FactoryTool =
  | "transfer"
  | "vote"
  | "calculator"
  | "spotlight"
  | "timer"
  | "split";
export const Classroom = registerPlugin<{
  getFactoryTools(): Promise<{ available: FactoryTool[] }>;
  openFactoryTool(options: { tool: FactoryTool }): Promise<void>;
  startShare(options: { pages: string[] }): Promise<{ urls: string[] }>;
  stopShare(): Promise<void>;
  getInkProfile(): Promise<{
    hardPenWidth: number;
    brushPenWidth: number;
    eraserSize: number;
    palmThreshold?: number;
  }>;
  captureFrame(options?: {
    region?: { x: number; y: number; width: number; height: number };
  }): Promise<{ image: string }>;
  addListener(
    event: "fileReceived",
    listener: (file: Upload) => void,
  ): Promise<PluginListenerHandle>;
  startReceiver(): Promise<{ urls: string[] }>;
  stopReceiver(): Promise<void>;
  listUploads(): Promise<{ files: Upload[] }>;
  deleteUpload(options: { id: string }): Promise<void>;
}>("FcboardClassroom");
