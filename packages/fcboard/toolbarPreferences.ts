import { useSyncExternalStore } from "react";

// tool_config.xml + tools_count_max. Six drawing buttons stay available.
export const toolbarItems = {
  shape: { label: "shape", icon: "shape" },
  toolbox: { label: "toolbox", icon: "toolbox" },
  ruler: { label: "ruler", icon: "ruler" },
  compass: { label: "compass", icon: "compass" },
  protractor: { label: "protractor", icon: "protractor" },
  setSquare: { label: "set_square", icon: "setSquare" },
  mindmap: { label: "mind_map", icon: "mindmap" },
  media: { label: "media", icon: "media" },
  signal: { label: "signal", icon: "signal" },
  table: { label: "table", icon: "table" },
  fourline: { label: "four_line_grid", icon: "fourline" },
  website: { label: "website", icon: "website" },
  document: { label: "document", icon: "document" },
  resources: { label: "teaching_resources", icon: "resources" },
  split: { label: "split_screen", icon: "split" },
  vote: { label: "vote", icon: "vote" },
  calculator: { label: "calculator", icon: "calculator" },
  spotlight: { label: "spotlight", icon: "spotlight" },
  timer: { label: "timer", icon: "timer" },
  curtain: { label: "curtain", icon: "toolbox" },
  files: { label: "file_transfer", icon: "transfer" },
  summary: { label: "ai_summary", icon: "document" },
  record: { label: "recording", icon: "media" },
  questions: { label: "ai_questions", icon: "resources" },
  voice: { label: "voice_commands", icon: "media" },
} as const;
export type ToolbarItem = keyof typeof toolbarItems;
export const TOOLBAR_LIMIT = 13;
export const FIXED_TOOL_COUNT = 6;
export const TOOLBAR_STORAGE = "fcboard-toolbar-tools-v1";
const defaults: readonly ToolbarItem[] = ["toolbox"];
let raw: string | null | undefined;
let snapshot: readonly ToolbarItem[] = defaults;
const changed = "fcboard:toolbar-preferences";

export const normalizeToolbarItems = (value: unknown): ToolbarItem[] =>
  Array.isArray(value)
    ? Array.from(
        new Set(
          value.filter(
            (id): id is ToolbarItem =>
              typeof id === "string" && Object.hasOwn(toolbarItems, id),
          ),
        ),
      ).slice(0, TOOLBAR_LIMIT - FIXED_TOOL_COUNT)
    : [...defaults];

export const readToolbarItems = (): readonly ToolbarItem[] => {
  try {
    const stored = localStorage.getItem(TOOLBAR_STORAGE);
    if (stored !== raw) {
      raw = stored;
      snapshot =
        stored === null ? defaults : normalizeToolbarItems(JSON.parse(stored));
    }
  } catch {
    snapshot = defaults;
  }
  return snapshot;
};
export const saveToolbarItems = (items: readonly ToolbarItem[]) => {
  // Publish only after persistence succeeds; settings can report real failures.
  localStorage.setItem(
    TOOLBAR_STORAGE,
    JSON.stringify(normalizeToolbarItems(items)),
  );
  window.dispatchEvent(new Event(changed));
};
const subscribe = (listener: () => void) => {
  window.addEventListener(changed, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(changed, listener);
    window.removeEventListener("storage", listener);
  };
};
export const useToolbarItems = () =>
  useSyncExternalStore(subscribe, readToolbarItems, () => defaults);
