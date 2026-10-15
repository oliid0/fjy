import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import { pointFrom } from "@excalidraw/math";
import { getCommonBounds } from "@excalidraw/element";
import { getDataURL } from "@excalidraw/excalidraw/data/blob";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElementSkeleton } from "@excalidraw/element/transform";
import type { FileId } from "@excalidraw/element/types";

import { insertionPoint } from "./board";
import { classroomCommands } from "./commands";

export type LessonCommand = {
  type:
    | "write_text"
    | "write_math"
    | "draw_line"
    | "draw_arrow"
    | "draw_path"
    | "draw_rectangle"
    | "draw_ellipse"
    | "erase_object"
    | "erase_area"
    | "clear_canvas"
    | "annotate_circle"
    | "annotate_underline"
    | "clear_annotations"
    | "wait";
  id: string;
  text?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  points?: [number, number][];
  color: string;
  duration: number;
  target?: string;
};
export type Quiz = {
  question: string;
  choices: string[];
  answer: number;
  explanation: string;
};
export type TeachingStep = {
  say: string;
  commands: LessonCommand[];
  checkpoint?: Quiz;
};
export type Lesson = { title: string; steps: TeachingStep[]; quiz: Quiz[] };
const types = new Set([
  "write_text",
  "write_math",
  "draw_line",
  "draw_arrow",
  "draw_path",
  "draw_rectangle",
  "draw_ellipse",
  "erase_object",
  "erase_area",
  "clear_canvas",
  "annotate_circle",
  "annotate_underline",
  "clear_annotations",
  "wait",
]);
const number = (value: unknown, fallback: number, min: number, max: number) => {
  const result = value === undefined ? fallback : value;
  if (
    typeof result !== "number" ||
    !Number.isFinite(result) ||
    result < min ||
    result > max
  ) {
    throw new Error("教学命令的数值超出范围");
  }
  return result;
};
const text = (value: unknown, max: number) => {
  if (typeof value !== "string" || value.length > max) {
    throw new Error("教学内容格式无效");
  }
  return value;
};
const quiz = (value: unknown): Quiz => {
  if (!value || typeof value !== "object") {
    throw new Error("测验格式无效");
  }
  const item = value as Quiz;
  if (
    !Array.isArray(item.choices) ||
    item.choices.length < 2 ||
    item.choices.length > 6
  ) {
    throw new Error("测验选项无效");
  }
  const choices = item.choices.map((choice) => text(choice, 500));
  const answer = number(item.answer, -1, 0, choices.length - 1);
  if (!Number.isInteger(answer)) {
    throw new Error("测验答案无效");
  }
  return {
    question: text(item.question, 1200),
    choices,
    answer,
    explanation: text(item.explanation || "", 1800),
  };
};
export const validateLesson = (value: unknown): Lesson => {
  if (!value || typeof value !== "object") {
    throw new Error("教学脚本格式无效");
  }
  const source = value as Record<string, unknown>;
  if (
    !Array.isArray(source.steps) ||
    !source.steps.length ||
    source.steps.length > 60
  ) {
    throw new Error("课程应包含 1 到 60 个步骤");
  }
  let commandCount = 0;
  const steps = source.steps.map((raw): TeachingStep => {
    if (!raw || typeof raw !== "object") {
      throw new Error("教学步骤格式无效");
    }
    const step = raw as Record<string, unknown>;
    if (
      !Array.isArray(step.commands) ||
      (commandCount += step.commands.length) > 400
    ) {
      throw new Error("教学命令过多或格式无效");
    }
    const commands = step.commands.map((input): LessonCommand => {
      if (!input || typeof input !== "object") {
        throw new Error("教学命令格式无效");
      }
      const command = input as Record<string, unknown>;
      if (!types.has(String(command.type))) {
        throw new Error(`不支持的教学命令：${String(command.type)}`);
      }
      const id = text(command.id || crypto.randomUUID(), 100);
      const color = text(command.color || "#245bd6", 20);
      if (!/^#[a-f0-9]{3}(?:[a-f0-9]{3})?$/i.test(color)) {
        throw new Error("教学命令颜色无效");
      }
      let points: [number, number][] | undefined;
      if (command.points !== undefined) {
        if (
          !Array.isArray(command.points) ||
          command.points.length < 2 ||
          command.points.length > 1500
        ) {
          throw new Error("路径需要 2 到 1500 个点");
        }
        points = command.points.map((pair) => {
          if (!Array.isArray(pair) || pair.length !== 2) {
            throw new Error("路径坐标无效");
          }
          return [
            number(pair[0], 0, -1600, 3200),
            number(pair[1], 0, -1600, 3200),
          ];
        });
      }
      if (command.type === "draw_path" && !points) {
        throw new Error("路径命令缺少 points");
      }
      if (
        (command.type === "write_text" || command.type === "write_math") &&
        !command.text
      ) {
        throw new Error("写字命令缺少 text");
      }
      if (command.type === "erase_object" && !command.target) {
        throw new Error("擦除命令缺少 target");
      }
      return {
        type: command.type as LessonCommand["type"],
        id,
        color,
        points,
        x: number(command.x, 0, -1600, 3200),
        y: number(command.y, 0, -1600, 3200),
        width: number(command.width, 200, -2000, 2000),
        height: number(command.height, 100, -2000, 2000),
        duration: number(command.duration, 0.7, 0, 8),
        text: command.text === undefined ? undefined : text(command.text, 4000),
        target:
          command.target === undefined ? undefined : text(command.target, 100),
      };
    });
    return {
      say: text(step.say || "", 5000),
      commands,
      checkpoint: step.checkpoint ? quiz(step.checkpoint) : undefined,
    };
  });
  if (
    source.quiz !== undefined &&
    (!Array.isArray(source.quiz) || source.quiz.length > 10)
  ) {
    throw new Error("测验数量无效");
  }
  return {
    title: text(source.title || "白板讲解", 160),
    steps,
    quiz: ((source.quiz as unknown[]) || []).map(quiz),
  };
};

export const LESSON_FORMAT = `返回 JSON {"title":"主题","steps":[{"say":"这一步用自然简短中文讲解","commands":[{"type":"write_text","id":"title","x":0,"y":0,"text":"板书","color":"#245bd6","duration":0.8}]}],"quiz":[{"question":"理解检查","choices":["选项1","选项2"],"answer":0,"explanation":"说明"}]}。
commands 支持 write_text、write_math(text 为 LaTeX)、draw_line、draw_arrow、draw_path(points:[[x,y],...])、draw_rectangle、draw_ellipse、annotate_circle、annotate_underline、erase_object(target 为前面命令的 id)、erase_area、clear_annotations、clear_canvas、wait。每个命令都有 id；形状给 x,y,width,height，坐标是相对当前插入点的 0..1000、0..1600；颜色仅十六进制。每步只写当前要讲的少量内容，逐步推导，使用不重叠的位置。不要重抄学生已有内容，不要清除学生笔迹。可在步骤内附 checkpoint，结构与 quiz 项相同。根据学生的问题和已给出的课件原文讲解，引用须附实际文件名与页码；没有证据时说不确定。不要输出可执行代码、外链或假引用。`;

/** Progressive writing uses the existing scene/history API, with stable element identities. */
export class LessonCanvas {
  private document?: { name: string; page: number };
  private generation = 0;
  private paused = false;
  private resumeWaiters = new Set<() => void>();
  readonly id: string;
  readonly origin: { x: number; y: number };
  get target() {
    return this.document;
  }
  constructor(
    private api: ExcalidrawImperativeAPI,
    saved?: { id: string; origin: { x: number; y: number } },
  ) {
    this.document = classroomCommands.read("document") as
      | { name: string; page: number }
      | undefined;
    this.origin =
      saved?.origin || (this.document ? { x: 32, y: 32 } : insertionPoint(api));
    this.id = saved?.id || crypto.randomUUID();
  }
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
    this.resumeWaiters.forEach((resume) => resume());
    this.resumeWaiters.clear();
  }
  cancel() {
    this.generation++;
    this.resume();
  }
  private async gate(generation: number) {
    while (this.paused && generation === this.generation) {
      await new Promise<void>((resolve) => this.resumeWaiters.add(resolve));
    }
    if (generation !== this.generation) {
      throw new DOMException("讲解已取消", "AbortError");
    }
  }
  private remove(
    predicate: (
      element: ReturnType<ExcalidrawImperativeAPI["getSceneElements"]>[number],
    ) => boolean,
  ) {
    this.api.updateScene({
      elements: this.api
        .getSceneElements()
        .filter((element) => !predicate(element)),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  }
  async command(command: LessonCommand, speed = 1, reducedMotion = false) {
    const generation = this.generation;
    await this.gate(generation);
    if (this.document) {
      const current = classroomCommands.read("document") as
        | { name?: string; page?: number }
        | undefined;
      if (
        current?.name !== this.document.name ||
        current.page !== this.document.page
      ) {
        throw new Error("课件页已切换，请回到原页继续讲解或重新提问");
      }
      if (
        [
          "erase_object",
          "erase_area",
          "clear_annotations",
          "clear_canvas",
        ].includes(command.type)
      ) {
        await classroomCommands.execute({
          name: "document.draw",
          args: { command, lesson: this.id, origin: this.origin },
        });
        return;
      }
    }
    if (command.type === "erase_object") {
      this.remove(
        (element) =>
          element.customData?.fcLessonId === this.id &&
          element.customData?.fcTutorId === command.target,
      );
      return;
    }
    if (
      command.type === "clear_canvas" ||
      command.type === "clear_annotations"
    ) {
      this.remove(
        (element) =>
          element.customData?.fcLessonId === this.id &&
          (command.type === "clear_canvas" || element.customData?.fcAnnotation),
      );
      return;
    }
    if (command.type === "erase_area") {
      this.remove((element) => {
        const [left, top, right, bottom] = getCommonBounds([element]);
        return (
          element.customData?.fcLessonId === this.id &&
          left < this.origin.x + command.x + command.width &&
          right > this.origin.x + command.x &&
          top < this.origin.y + command.y + command.height &&
          bottom > this.origin.y + command.y
        );
      });
      return;
    }
    const id = `${this.id}-${command.id}`;
    let formula: { svg: string; width: number; height: number } | undefined;
    let formulaUrl: Awaited<ReturnType<typeof getDataURL>> | undefined;
    let formulaId: FileId | undefined;
    if (command.type === "write_math") {
      formula = (await import("./formula")).formulaSvg(
        command.text || "",
        command.color,
      );
      formulaUrl = await getDataURL(
        new Blob([formula.svg], { type: "image/svg+xml" }),
      );
      await this.gate(generation);
      formulaId = crypto.randomUUID() as FileId;
      if (!this.document) {
        this.api.addFiles([
          {
            id: formulaId,
            dataURL: formulaUrl,
            mimeType: "image/svg+xml",
            created: Date.now(),
          },
        ]);
      }
    }
    let elapsed = 0;
    const duration = reducedMotion ? 0 : (command.duration * 1000) / speed;
    const points = command.points || [
      [0, 0],
      [command.width, command.height],
    ];
    let renderedVersion = 0;
    let renderedInk: unknown;
    let userEdited = false;
    const render = async (progress: number) => {
      if (command.type === "wait") {
        return;
      }
      if (this.document) {
        const current = classroomCommands.read("document") as
          | { name: string; page: number; ink: { id: string }[] }
          | undefined;
        if (
          current?.name !== this.document.name ||
          current?.page !== this.document.page
        ) {
          throw new Error("课件页已切换，请回到原页继续讲解或重新提问");
        }
        if (
          renderedInk &&
          current.ink.find((stroke) => stroke.id === id) !== renderedInk
        ) {
          userEdited = true;
          return;
        }
      }
      const existing = this.api
        .getSceneElements()
        .find((element) => element.id === id);
      if (
        !this.document &&
        renderedVersion &&
        (!existing || existing.version !== renderedVersion)
      ) {
        userEdited = true;
        return;
      }
      const base = {
        id,
        x: this.origin.x + command.x,
        y: this.origin.y + command.y,
        strokeColor: command.color,
        roughness: 0,
        strokeWidth: 2,
        version: (existing?.version || 0) + 1,
        customData: {
          fcGenerated: true,
          fcLessonId: this.id,
          fcTutorId: command.id,
          fcAnnotation: command.type.startsWith("annotate_"),
        },
      };
      let skeleton: ExcalidrawElementSkeleton;
      if (command.type === "write_math" && formula) {
        skeleton = {
          ...base,
          type: "image",
          fileId: formulaId!,
          width: formula.width,
          height: formula.height,
          opacity: Math.max(1, Math.round(progress * 100)),
        };
      } else if (command.type === "write_text") {
        skeleton = {
          ...base,
          type: "text",
          text: Array.from(command.text || "")
            .slice(
              0,
              Math.max(
                1,
                Math.ceil(Array.from(command.text || "").length * progress),
              ),
            )
            .join(""),
          fontFamily: 2,
          fontSize: 26,
        };
      } else if (
        command.type === "draw_rectangle" ||
        command.type === "draw_ellipse" ||
        command.type === "annotate_circle"
      ) {
        const circular = command.type !== "draw_rectangle";
        const outline: [number, number][] = circular
          ? Array.from({ length: 65 }, (_, i) => [
              command.width / 2 +
                (Math.cos((i / 64) * 2 * Math.PI) * command.width) / 2,
              command.height / 2 +
                (Math.sin((i / 64) * 2 * Math.PI) * command.height) / 2,
            ])
          : [
              [0, 0],
              [command.width, 0],
              [command.width, command.height],
              [0, command.height],
              [0, 0],
            ];
        skeleton =
          progress >= 1
            ? {
                ...base,
                type: circular ? "ellipse" : "rectangle",
                width: Math.abs(command.width),
                height: Math.abs(command.height),
              }
            : {
                ...base,
                type: "line",
                points: revealPath(outline, progress).map((pair) =>
                  pointFrom(pair[0], pair[1]),
                ),
              };
      } else {
        const path =
          command.type === "annotate_underline"
            ? ([
                [0, 0],
                [command.width, 0],
              ] as [number, number][])
            : points;
        skeleton = {
          ...base,
          type: command.type === "draw_arrow" ? "arrow" : "line",
          points: revealPath(path, progress).map((pair) =>
            pointFrom(pair[0], pair[1]),
          ),
          endArrowhead: command.type === "draw_arrow" ? "arrow" : null,
        };
      }
      if (this.document) {
        await classroomCommands.execute({
          name: "document.draw",
          args: {
            shape: skeleton,
            image: formulaUrl,
            lesson: this.id,
            progress,
          },
        });
        renderedInk = (
          classroomCommands.read("document") as { ink: { id: string }[] }
        ).ink.find((stroke) => stroke.id === id);
        return;
      }
      const converted = convertToExcalidrawElements([skeleton], {
        regenerateIds: false,
      });
      renderedVersion = converted[0].version;
      this.api.updateScene({
        elements: [
          ...this.api.getSceneElements().filter((element) => element.id !== id),
          ...converted,
        ],
        captureUpdate:
          progress >= 1
            ? CaptureUpdateAction.IMMEDIATELY
            : CaptureUpdateAction.NEVER,
      });
      if (progress === 1) {
        const state = this.api.getAppState();
        const [left, top, right, bottom] = getCommonBounds(converted);
        const zoom = state.zoom.value;
        if (
          (left + state.scrollX) * zoom < 16 ||
          (right + state.scrollX) * zoom > state.width - 16 ||
          (top + state.scrollY) * zoom < 16 ||
          (bottom + state.scrollY) * zoom > state.height - 300
        ) {
          this.api.updateScene({
            appState: {
              scrollX: state.width / (2 * zoom) - (left + right) / 2,
              scrollY:
                Math.max(100, state.height - 300) / (2 * zoom) -
                (top + bottom) / 2,
            },
          });
        }
      }
    };
    while (elapsed < duration) {
      await this.gate(generation);
      await render(Math.max(0.001, elapsed / duration));
      if (userEdited) {
        return;
      }
      const start = performance.now();
      await new Promise<void>((resolve) => setTimeout(resolve, 32));
      if (!this.paused) {
        elapsed += performance.now() - start;
      }
    }
    await this.gate(generation);
    if (!userEdited) {
      await render(1);
    }
  }
}

export const revealPath = (
  points: readonly [number, number][],
  progress: number,
): [number, number][] => {
  const lengths = points
    .slice(1)
    .map((point, index) =>
      Math.hypot(point[0] - points[index][0], point[1] - points[index][1]),
    );
  let remaining =
    lengths.reduce((sum, value) => sum + value, 0) *
    Math.max(0.001, Math.min(1, progress));
  const result: [number, number][] = [[...points[0]]];
  for (let index = 0; index < lengths.length; index++) {
    const start = points[index];
    const end = points[index + 1];
    if (remaining >= lengths[index]) {
      result.push([...end]);
      remaining -= lengths[index];
    } else {
      const ratio = remaining / (lengths[index] || 1);
      result.push([
        start[0] + (end[0] - start[0]) * ratio,
        start[1] + (end[1] - start[1]) * ratio,
      ]);
      break;
    }
  }
  return result;
};
