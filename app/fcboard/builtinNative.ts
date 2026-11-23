import { registerPlugin } from "@capacitor/core";

import type { PluginListenerHandle } from "@capacitor/core";

import type { PageLocalization } from "./pageLocalization";

export type VoteState = {
  active: true;
  topic: string;
  options: string[];
  multiple: boolean;
  accepting: boolean;
  participants: number;
  counts: number[];
  urls: string[];
};
export const Voting = registerPlugin<{
  start(args: {
    topic: string;
    options: string[];
    multiple: boolean;
    localization: PageLocalization;
  }): Promise<VoteState>;
  read(): Promise<VoteState | { active: false }>;
  end(): Promise<VoteState>;
  clear(): Promise<{ active: false }>;
}>("FcboardVoting");
export type MediaAction = {
  action:
    | "read"
    | "play"
    | "pause"
    | "seek"
    | "speed"
    | "enhance"
    | "next"
    | "previous"
    | "close";
  seconds?: number;
  speed?: number;
  level?: number;
};
export type MediaBounds = {
  selected?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  viewport: number;
};
export type MediaPick = {
  images?: { uri: string; name: string; mime: string }[];
  key?: string;
  title?: string;
  video?: boolean;
  cancelled?: boolean;
};
export const Media = registerPlugin<{
  open(args: { kind?: "image" | "playback" }): Promise<MediaPick>;
  activate(args: {
    key: string;
    owner: string;
    labels: Record<string, string>;
    bounds: MediaBounds;
  }): Promise<unknown>;
  place(args: { owner: string; bounds: MediaBounds }): Promise<void>;
  action(args: MediaAction & { owner?: string }): Promise<unknown>;
  addListener(
    name: "mediaWindow",
    listener: (event: {
      owner: string;
      action: "close" | "release" | "move";
      dx?: number;
      dy?: number;
      dw?: number;
      dh?: number;
    }) => void,
  ): Promise<PluginListenerHandle>;
}>("FcboardMedia");
