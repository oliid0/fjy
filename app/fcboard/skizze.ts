import { registerPlugin } from "@capacitor/core";

import type { PluginListenerHandle } from "@capacitor/core";

export type SkizzeState = {
  kind: "state";
  connected: boolean;
  battery?: number;
  error: string;
};
export type SkizzeInput =
  | SkizzeState
  | { kind: "color" | "mode" | "next" | "previous" };

export const SkizzePen = registerPlugin<{
  connect(): Promise<SkizzeState>;
  addListener(
    name: "input",
    listener: (event: SkizzeInput) => void,
  ): Promise<PluginListenerHandle>;
}>("FcboardSkizzePen");
