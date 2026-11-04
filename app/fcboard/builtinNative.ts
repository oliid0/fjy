import { registerPlugin } from "@capacitor/core";

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
    | "next"
    | "previous"
    | "close";
  seconds?: number;
  speed?: number;
};
export const Media = registerPlugin<{
  open(args: { labels: { title: string; close: string } }): Promise<unknown>;
  action(args: MediaAction): Promise<unknown>;
}>("FcboardMedia");
