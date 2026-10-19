import { registerPlugin } from "@capacitor/core";

import type { PluginListenerHandle } from "@capacitor/core";

export type Upload = { id: string; name: string; path: string; size: number };
export const Classroom = registerPlugin<{
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
