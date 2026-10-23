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
export type FactoryInsertion = "document" | "media" | "signal";
export const Classroom = registerPlugin<{
  postAIStream(options: {
    id: string;
    url: string;
    headers: Record<string, string>;
    body: string;
  }): Promise<{ status: number; data: string; stream: boolean }>;
  cancelAIStream(options: { id: string }): Promise<void>;
  addListener(
    event: "aiStream",
    listener: (event: { id: string; chunk: string }) => void,
  ): Promise<PluginListenerHandle>;
  openWebResource(options: { url: string; language?: string }): Promise<void>;
  webResourceAction(options: {
    action:
      | "read"
      | "click"
      | "set"
      | "key"
      | "scroll"
      | "back"
      | "forward"
      | "reload"
      | "close";
    selector?: string;
    value?: string;
    key?: string;
    x?: number;
    y?: number;
  }): Promise<{
    url?: string;
    title?: string;
    text?: string;
    controls?: {
      selector: string;
      role: string;
      label: string;
      value?: string;
      disabled: boolean;
    }[];
  }>;
  getFactoryInsertions(): Promise<{ available: FactoryInsertion[] }>;
  openFactoryInsertion(options: { insertion: FactoryInsertion }): Promise<void>;
  getFactoryTools(): Promise<{ available: FactoryTool[] }>;
  openFactoryTool(options: { tool: FactoryTool }): Promise<void>;
  startShare(options: { pages: string[] }): Promise<{ urls: string[] }>;
  stopShare(): Promise<void>;
  sharePages(options: { pages: string[] }): Promise<void>;
  exitApp(): Promise<void>;
  getInkProfile(): Promise<{
    hardPenWidth: number;
    brushPenWidth: number;
    eraserSize: number;
    penWidthMax?: 20 | 40;
    palmThreshold?: number;
    thickThreshold?: number;
    dualPen?: boolean;
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
