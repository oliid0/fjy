import { useSyncExternalStore } from "react";

// x.apk tool_config.xml: only pen, eraser and selection cannot be removed.
export const toolbarItems = {
  shape: { label: "shape", icon: "shape" },
  toolbox: { label: "toolbox", icon: "toolbox" },
  undo: { label: "undo", icon: "undo" },
  redo: { label: "redo", icon: "redo" },
  aerial: { label: "aerial_view", icon: "aerial" },
  image: { label: "image", icon: "image" },
  areaBg: { label: "area_background", icon: "areaBg" },
  sticky: { label: "sticky_notes", icon: "sticky" },
  period: { label: "periodic_table", icon: "period" },
  ruler: { label: "geometry_tools", icon: "ruler" },
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
  resources: { label: "subject_tools", icon: "subject" },
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
  multi: { label: "multi_point_switch", icon: "multi" },
} as const;
export type ToolbarItem = keyof typeof toolbarItems;
// tool_config.xml order, with insert_camera_visible=2 excluded by the APK.
export const NATIVE_TOOLBAR_ITEMS: readonly ToolbarItem[] = [
  "shape",
  "toolbox",
  "undo",
  "redo",
  "aerial",
  "image",
  "table",
  "ruler",
  "signal",
  "mindmap",
  "document",
  "media",
  "website",
  "vote",
  "timer",
  "files",
  "fourline",
  "areaBg",
  "sticky",
  "period",
  "resources",
  "questions",
  "multi",
];
export const TOOLBAR_LIMIT = 13;
export const FIXED_TOOL_COUNT = 3;
export const TOOLBAR_STORAGE = "fcboard-toolbar-tools-v2";
const legacyStorage = "fcboard-toolbar-tools-v1";
export const DEFAULT_TOOLBAR_ITEMS: readonly ToolbarItem[] = [
  "shape",
  "toolbox",
  "undo",
  "redo",
  "aerial",
];
const defaults = DEFAULT_TOOLBAR_ITEMS;
let raw: string | null | undefined;
let snapshot: readonly ToolbarItem[] = defaults;
const changed = "fcboard:toolbar-preferences";

export const normalizeToolbarItems = (value: unknown): ToolbarItem[] =>
  Array.isArray(value)
    ? Array.from(
        new Set(
          value.filter(
            (id): id is ToolbarItem =>
              typeof id === "string" &&
              NATIVE_TOOLBAR_ITEMS.includes(id as ToolbarItem),
          ),
        ),
      )
        .sort(
          (a, b) =>
            NATIVE_TOOLBAR_ITEMS.indexOf(a) - NATIVE_TOOLBAR_ITEMS.indexOf(b),
        )
        .slice(0, TOOLBAR_LIMIT - FIXED_TOOL_COUNT)
    : [...defaults];

export const readToolbarItems = (): readonly ToolbarItem[] => {
  try {
    let stored = localStorage.getItem(TOOLBAR_STORAGE);
    if (stored === null) {
      const legacy = localStorage.getItem(legacyStorage);
      if (legacy !== null) {
        // Preserve the previous user's choices and the formerly fixed history
        // controls. Do not overwrite either version until the user saves.
        stored = JSON.stringify([
          ...(legacy === JSON.stringify(["toolbox"])
            ? defaults
            : normalizeToolbarItems(JSON.parse(legacy))),
          "undo",
          "redo",
          "aerial",
        ]);
      }
    }
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
