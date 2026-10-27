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
export type SignalSourceState = {
  open: boolean;
  embedded: boolean;
  available: boolean;
  video:
    | "closed"
    | "connecting"
    | "available"
    | "unavailable"
    | "failed"
    | "blocked"
    | "reset";
  message: string;
  selectedId?: string;
  inputId?: string;
  inputs: {
    id: string;
    label: string;
    state: "connected" | "standby" | "disconnected" | "unavailable";
    selected: boolean;
  }[];
};
export const Classroom = registerPlugin<{
  getAppVersion(): Promise<{ name: string; code: number }>;
  openDebugSettings(): Promise<{ enabled: boolean }>;
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
    control?: string;
    version?: string;
    offset?: number;
    value?: string | number | boolean;
    key?: string;
    x?: number;
    y?: number;
  }): Promise<{
    open: boolean;
    loading: boolean;
    version?: string;
    canGoBack: boolean;
    canGoForward: boolean;
    message: string;
    total?: number;
    offset?: number;
    truncated?: boolean;
    url?: string;
    title?: string;
    text?: string;
    controls?: {
      id: string;
      role: string;
      label: string;
      value?: string;
      checked?: boolean;
      sensitive?: boolean;
      hasValue?: boolean;
      disabled: boolean;
      readonly: boolean;
      bounds: { x: number; y: number; width: number; height: number };
      options?: { value: string; label: string; disabled: boolean }[];
    }[];
  }>;
  getFactoryInsertions(): Promise<{
    available: FactoryInsertion[];
    embedded?: FactoryInsertion[];
  }>;
  openFactoryInsertion(options: {
    insertion: FactoryInsertion;
    language?: string;
  }): Promise<{ embedded: boolean }>;
  signalAction(options: {
    action: "read" | "select" | "reload" | "reset" | "close";
    id?: string;
    language?: string;
  }): Promise<SignalSourceState>;
  getFactoryTools(): Promise<{ available: FactoryTool[] }>;
  openFactoryTool(options: { tool: FactoryTool }): Promise<void>;
  startShare(options: { pages: string[] }): Promise<{ urls: string[] }>;
  stopShare(): Promise<void>;
  sharePages(options: {
    pages: string[];
    format?: "png" | "pdf";
  }): Promise<void>;
  exitApp(): Promise<void>;
  getInkProfile(): Promise<{
    hardPenWidth: number;
    brushPenWidth: number;
    eraserSize: number;
    penWidthMax?: 20 | 40;
    palmThreshold?: number;
    thickThreshold?: number;
    dualPen?: boolean;
    hardNibAvailable?: boolean;
    hardNib?: boolean;
    touchPressure?: boolean;
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
