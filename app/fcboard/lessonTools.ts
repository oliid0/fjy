import { t } from "@excalidraw/excalidraw/i18n";

import { classroomCommands } from "./commands";

import type { Command } from "./commands";

type Scalar = string | number | boolean | null;
export type LessonTool = Command & {
  expect?: { path: string; equals: Scalar }[];
};
export type LessonToolResult = {
  name: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

const lifecycle = new Set([
  "ui.invoke",
  "assistant.open",
  "voice.speak",
  "lesson.ask",
  "lesson.teach",
  "lesson.reopen",
  "lesson.pause",
  "lesson.resume",
  "lesson.stop",
  "lesson.answer",
]);
// A failed assertion retries this read, never the preceding successful mutation.
const inspections = new Set([
  "canvas.inspect",
  "ui.inspect",
  "resources.inspect",
  "resources.list",
  "math.evaluate",
]);
export const isLessonInspection = (tool: Command) =>
  inspections.has(tool.name) ||
  (["web.action", "signal.action"].includes(tool.name) &&
    (tool.args?.action === undefined || tool.args.action === "read"));
const invalid = () => new Error(t("fcboard.invalid_lesson_command"));
const isJson = (value: unknown, depth = 0): boolean => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (!value || typeof value !== "object" || depth > 10) {
    return false;
  }
  if (Array.isArray(value)) {
    return (
      value.length <= 10000 && value.every((item) => isJson(item, depth + 1))
    );
  }
  return (
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.entries(value).every(
      ([key, item]) =>
        !["__proto__", "prototype", "constructor", "signal"].includes(key) &&
        isJson(item, depth + 1),
    )
  );
};

/** Validate the whole lesson before playback; tools contain data, never host code. */
export const validateLessonTools = (value: unknown): LessonTool[] => {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > 20) {
    throw invalid();
  }
  return value.map((raw) => {
    const tool = raw as Partial<LessonTool> | null;
    if (
      !tool ||
      typeof tool !== "object" ||
      Object.keys(tool).some(
        (key) => !["name", "args", "expect"].includes(key),
      ) ||
      typeof tool.name !== "string" ||
      !/^[a-z][a-z0-9.]{0,79}$/.test(tool.name) ||
      lifecycle.has(tool.name) ||
      (tool.args !== undefined &&
        (!tool.args ||
          Array.isArray(tool.args) ||
          typeof tool.args !== "object" ||
          !isJson(tool.args) ||
          JSON.stringify(tool.args).length > 160000))
    ) {
      throw invalid();
    }
    if (
      tool.expect !== undefined &&
      (!isLessonInspection(tool as Command) ||
        !Array.isArray(tool.expect) ||
        !tool.expect.length ||
        tool.expect.length > 10)
    ) {
      throw invalid();
    }
    const expect = tool.expect?.map((check) => {
      if (
        !check ||
        typeof check.path !== "string" ||
        check.path.length > 160 ||
        !/^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+){0,7}$/.test(check.path) ||
        check.path
          .split(".")
          .some((part) =>
            ["__proto__", "prototype", "constructor"].includes(part),
          ) ||
        !(
          check.equals === null ||
          typeof check.equals === "boolean" ||
          (typeof check.equals === "number" && Number.isFinite(check.equals)) ||
          (typeof check.equals === "string" && check.equals.length <= 2000)
        )
      ) {
        throw invalid();
      }
      return { path: check.path, equals: check.equals };
    });
    return {
      name: tool.name,
      args:
        tool.args === undefined
          ? undefined
          : JSON.parse(JSON.stringify(tool.args)),
      expect,
    };
  });
};

export const assertLessonToolsAvailable = (tools: readonly LessonTool[]) => {
  if (
    tools.some(
      (tool) =>
        lifecycle.has(tool.name) || !classroomCommands.isPublic(tool.name),
    )
  ) {
    throw new Error(
      t(
        "fcboard.ai_requested_an_unavailable_action_please_rephrase_your_request",
      ),
    );
  }
};

export const lessonToolMismatch = (tool: LessonTool, result: unknown) =>
  tool.expect?.find((check) => {
    let actual = result;
    for (const part of check.path.split(".")) {
      if (
        !actual ||
        typeof actual !== "object" ||
        !Object.prototype.hasOwnProperty.call(actual, part)
      ) {
        return true;
      }
      actual = (actual as Record<string, unknown>)[part];
    }
    return actual !== check.equals;
  });

/** Recheck completed postconditions on reopen without replaying their mutations. */
export const lessonToolResumeIndex = (
  tools: readonly LessonTool[],
  completed: number,
) => {
  let start = completed;
  for (let index = completed - 1; index >= 0; index--) {
    if (!isLessonInspection(tools[index])) {
      break;
    }
    if (tools[index].expect?.length) {
      start = index;
    }
  }
  return start;
};
