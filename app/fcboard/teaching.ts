import { t } from "@excalidraw/excalidraw/i18n";
import { createStore, get, set } from "idb-keyval";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { LessonCanvas } from "./lesson";
import { createNarrator } from "./narration";
import { mergeLessonContinuation } from "./lessonContinuation";
import {
  classroomCommands,
  executeBoardCommand,
  isCancellableBoardCommand,
} from "./commands";
import {
  assertLessonToolsAvailable,
  lessonToolMismatch,
  lessonToolResumeIndex,
} from "./lessonTools";

import type { Lesson, Quiz, LessonCommand } from "./lesson";
import type { LessonTool, LessonToolResult } from "./lessonTools";
import type { LessonObserver, LessonObservation } from "./lessonContinuation";

export type Lens = "standard" | "audio" | "captions" | "reading" | "focus";
export type TeachingState = {
  mode:
    | "idle"
    | "generating"
    | "teaching"
    | "paused"
    | "question"
    | "quiz"
    | "complete";
  lesson?: Lesson;
  step: number;
  caption: string;
  spoken: number;
  question?: Quiz;
  feedback: string;
  correct: number;
  attempts: number;
  interruptions: number;
  audioError: string;
  speed: number;
  lens: Lens;
  tool?: { name: string; index: number };
  toolError: string;
  toolResults: LessonToolResult[];
  toolIndex: number;
  observing: boolean;
};
export type TeachingSession = {
  id: string;
  board: string;
  lesson: Lesson;
  step: number;
  toolIndex?: number;
  correct: number;
  attempts: number;
  updated: number;
  canvas: {
    id: string;
    origin: { x: number; y: number };
    sourceIds?: string[];
    document?: { name: string; page: number };
  };
};
const storage = createStore("fcboard-lessons", "lessons");
let writing: Promise<void> = Promise.resolve();
export const lessonSessions = async () => {
  await writing.catch(() => {});
  return (await get<TeachingSession[]>("sessions", storage)) || [];
};
export const saveLessonSession = (session: TeachingSession) => {
  const task = writing
    .catch(() => {})
    .then(async () => {
      const sessions =
        (await get<TeachingSession[]>("sessions", storage)) || [];
      await set(
        "sessions",
        [session, ...sessions.filter((item) => item.id !== session.id)].slice(
          0,
          100,
        ),
        storage,
      );
    });
  writing = task;
  return task;
};

/** One lesson state, with explicit interruptions and resume; writing never competes with speech. */
export class TeachingEngine {
  state: TeachingState = {
    mode: "idle",
    step: 0,
    caption: "",
    spoken: 0,
    feedback: "",
    correct: 0,
    attempts: 0,
    interruptions: 0,
    audioError: "",
    speed: 1,
    lens: "standard",
    toolError: "",
    toolResults: [],
    toolIndex: 0,
    observing: false,
  };
  private listeners = new Set<(state: TeachingState) => void>();
  private generation = 0;
  private branchGeneration = 0;
  private branchActive = false;
  private target?: string;
  private toolRequests = new Set<AbortController>();
  private branchToolRequests = new Set<AbortController>();
  private observations = new Set<AbortController>();
  private cancellableRequests = new WeakSet<AbortController>();
  private waiting = new Set<() => void>();
  private answerWaiter?: () => void;
  private renderer?: LessonCanvas;
  private branchRenderer?: LessonCanvas;
  private voice = createNarrator();
  private interjection = createNarrator();
  constructor(
    private api: ExcalidrawImperativeAPI,
    private observer?: LessonObserver,
  ) {}
  subscribe(listener: (state: TeachingState) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private update(value: Partial<TeachingState>) {
    this.state = { ...this.state, ...value };
    this.listeners.forEach((listener) => listener(this.state));
  }
  configure(speed: number, lens: Lens) {
    this.update({ speed: Math.max(0.5, Math.min(2, speed)), lens });
  }
  generating() {
    this.pause();
    this.update({ mode: "generating" });
  }
  private surface() {
    const document = classroomCommands.read("document") as
      | { id?: string; name?: string; page?: number }
      | undefined;
    return JSON.stringify(
      document
        ? ["document", document.id, document.name, document.page]
        : [
            "whiteboard",
            (
              classroomCommands.read("boards") as
                | { active?: string }
                | undefined
            )?.active || this.api.id,
          ],
    );
  }
  private async gate(generation: number, branch = false) {
    while (
      generation === this.generation &&
      (["paused", "generating"].includes(this.state.mode) ||
        (!branch && this.state.mode === "question"))
    ) {
      await new Promise<void>((resolve) => this.waiting.add(resolve));
    }
    if (generation !== this.generation) {
      throw new DOMException("Lesson ended", "AbortError");
    }
    if (this.target && this.target !== this.surface()) {
      this.cancel();
      throw new DOMException("Visible lesson surface changed", "AbortError");
    }
  }
  pause() {
    if (this.state.mode === "idle" || this.state.mode === "complete") {
      return;
    }
    this.renderer?.pause();
    this.branchRenderer?.pause();
    this.interjection.pause();
    this.voice.pause();
    this.observations.forEach((request) => request.abort());
    this.update({ observing: false });
    this.toolRequests.forEach((request) => {
      if (this.cancellableRequests.has(request)) {
        request.abort();
      }
    });
    this.branchToolRequests.forEach((request) => {
      if (this.cancellableRequests.has(request)) {
        request.abort();
      }
    });
    if (this.state.mode !== "quiz") {
      this.update({ mode: "paused" });
    }
  }
  resume() {
    if (!this.state.lesson) {
      return;
    }
    if (this.state.mode === "complete") {
      return;
    }
    if (this.branchActive) {
      this.update({ mode: "question" });
      this.branchRenderer?.resume();
      void this.interjection
        .resume()
        .catch((error) => this.update({ audioError: String(error) }));
      this.waiting.forEach((resolve) => resolve());
      this.waiting.clear();
      return;
    }
    this.branchGeneration++;
    this.branchRenderer?.cancel();
    this.interjection.stop();
    this.update({
      mode: this.state.question ? "quiz" : "teaching",
      feedback: "",
      toolError: "",
    });
    this.renderer?.resume();
    void this.voice
      .resume()
      .catch((error) => this.update({ audioError: String(error) }));
    this.waiting.forEach((resolve) => resolve());
    this.waiting.clear();
  }
  cancel() {
    this.generation++;
    this.branchGeneration++;
    this.branchActive = false;
    this.renderer?.cancel();
    this.branchRenderer?.cancel();
    this.voice.stop();
    this.interjection.stop();
    this.toolRequests.forEach((request) => request.abort());
    this.branchToolRequests.forEach((request) => request.abort());
    this.observations.forEach((request) => request.abort());
    this.observations.clear();
    this.toolRequests.clear();
    this.branchToolRequests.clear();
    this.target = undefined;
    this.waiting.forEach((resolve) => resolve());
    this.waiting.clear();
    this.answerWaiter?.();
    this.answerWaiter = undefined;
    this.update({
      mode: "idle",
      lesson: undefined,
      step: 0,
      question: undefined,
      caption: "",
      feedback: "",
      tool: undefined,
      toolError: "",
      toolResults: [],
      toolIndex: 0,
      observing: false,
    });
  }
  private async tools(
    tools: readonly LessonTool[] | undefined,
    generation: number,
    branchGeneration?: number,
    start = 0,
  ) {
    const branch = branchGeneration !== undefined;
    const current = () =>
      generation === this.generation &&
      (!branch || branchGeneration === this.branchGeneration);
    const check = () => {
      if (!current()) {
        throw new DOMException("Lesson tool ended", "AbortError");
      }
      if (this.target && this.target !== this.surface()) {
        this.cancel();
        throw new DOMException("Visible lesson surface changed", "AbortError");
      }
    };
    const gate = async () => {
      await this.gate(generation, branch);
      check();
    };
    const results: LessonToolResult[] = [];
    const requests = branch ? this.branchToolRequests : this.toolRequests;
    for (const [index, tool] of (tools || []).entries()) {
      if (index < start) {
        continue;
      }
      const slot = results.length;
      let complete = false;
      while (!complete) {
        await gate();
        const request = new AbortController();
        requests.add(request);
        if (isCancellableBoardCommand(tool.name)) {
          this.cancellableRequests.add(request);
        }
        this.update({ tool: { name: tool.name, index }, toolError: "" });
        let result: unknown;
        let mismatch: ReturnType<typeof lessonToolMismatch>;
        try {
          assertLessonToolsAvailable([tool]);
          result = await executeBoardCommand(tool, request.signal);
          check();
          mismatch = lessonToolMismatch(tool, result);
          if (mismatch) {
            throw new Error(t("fcboard.invalid_lesson_content"));
          }
          results[slot] = {
            name: tool.name,
            ok: true,
            result: result === undefined ? null : result,
          };
          this.update({
            toolResults: [...results],
            ...(!branch
              ? { toolIndex: Math.max(this.state.toolIndex, index + 1) }
              : {}),
          });
          await gate();
          complete = true;
        } catch (failure) {
          if (!current()) {
            throw new DOMException("Lesson tool ended", "AbortError");
          }
          if (
            request.signal.aborted &&
            failure instanceof DOMException &&
            failure.name === "AbortError"
          ) {
            await gate();
            continue;
          }
          const error =
            failure instanceof Error ? failure.message : String(failure);
          results[slot] = {
            name: tool.name,
            ok: false,
            result: result === undefined ? null : result,
            error: mismatch
              ? `LESSON_RESULT_MISMATCH: ${mismatch.path}`
              : error,
          };
          this.update({
            tool: undefined,
            toolError: error,
            toolResults: [...results],
          });
          if (this.observer && !branch) {
            return false;
          }
          this.pause();
          await gate();
        } finally {
          requests.delete(request);
        }
      }
    }
    check();
    this.update({ tool: undefined, toolResults: [...results] });
    return true;
  }
  private async readyStep(lesson: Lesson, index: number, generation: number) {
    let refinements = 0;
    let recheck = true;
    while (true) {
      await this.gate(generation);
      const tools = lesson.steps[index].tools || [];
      const complete = await this.tools(
        tools,
        generation,
        undefined,
        recheck
          ? lessonToolResumeIndex(tools, this.state.toolIndex)
          : this.state.toolIndex,
      );
      await this.gate(generation);
      if (!this.observer) {
        return lesson;
      }
      const request = new AbortController();
      this.observations.add(request);
      this.update({ observing: true });
      try {
        const input = {
          lesson,
          step: index,
          toolIndex: this.state.toolIndex,
          results: this.state.toolResults,
          correct: this.state.correct,
          attempts: this.state.attempts,
          error: complete ? undefined : this.state.toolError,
        };
        const tail = await this.observe(input, request.signal);
        request.signal.throwIfAborted();
        await this.gate(generation);
        request.signal.throwIfAborted();
        if (!tail) {
          if (!complete) {
            throw new Error(
              this.state.toolError || t("fcboard.invalid_lesson_content"),
            );
          }
          this.update({ observing: false, toolError: "" });
          return lesson;
        }
        const revised = mergeLessonContinuation(input, tail);
        revised.steps
          .slice(index)
          .forEach((step) => assertLessonToolsAvailable(step.tools || []));
        lesson = revised;
        this.update({ lesson, observing: false, toolError: "" });
        if ((lesson.steps[index].tools?.length || 0) <= this.state.toolIndex) {
          return lesson;
        }
        if (++refinements >= 3) {
          throw new Error(
            t(
              "fcboard.observation_limit_reached_completed_work_is_preserved_describe_the_next_step_to_continue",
            ),
          );
        }
        recheck = false;
      } catch (failure) {
        if (generation !== this.generation) {
          throw new DOMException("Lesson ended", "AbortError");
        }
        if (request.signal.aborted) {
          refinements = 0;
          recheck = true;
          await this.gate(generation);
          continue;
        }
        if (
          failure instanceof DOMException &&
          failure.name === "AbortError" &&
          ++refinements < 3
        ) {
          recheck = false;
          continue;
        }
        this.update({
          observing: false,
          toolError:
            failure instanceof Error ? failure.message : String(failure),
        });
        this.pause();
        await this.gate(generation);
        refinements = 0;
        recheck = true;
      } finally {
        this.observations.delete(request);
        if (generation === this.generation) {
          this.update({ observing: false });
        }
      }
    }
  }
  private observe(input: LessonObservation, signal: AbortSignal) {
    // The same abort boundary as executeBoardCommand: an uncooperative provider
    // may finish late, but cannot retain playback ownership or apply its result.
    return new Promise<Lesson | undefined>((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener("abort", abort);
        reject(new DOMException("Lesson observation cancelled", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      Promise.resolve()
        .then(() => {
          signal.throwIfAborted();
          return this.observer!(input, signal);
        })
        .then(
          (result) => {
            signal.removeEventListener("abort", abort);
            if (signal.aborted) {
              abort();
            } else {
              resolve(result);
            }
          },
          (failure) => {
            signal.removeEventListener("abort", abort);
            reject(failure);
          },
        );
    });
  }
  private async say(text: string, voice: ReturnType<typeof createNarrator>) {
    if (!text.trim()) {
      return;
    }
    const read = async () => {
      const duration = Math.min(
        20000,
        Math.max(1200, (Array.from(text).length * 100) / this.state.speed),
      );
      const generation = this.generation;
      const branch = voice === this.interjection;
      const branchGeneration = this.branchGeneration;
      let elapsed = 0;
      while (
        elapsed < duration &&
        generation === this.generation &&
        (!branch || branchGeneration === this.branchGeneration)
      ) {
        await this.gate(generation, branch);
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        elapsed += 100;
      }
    };
    if (this.state.lens === "captions") {
      await read();
      return;
    }
    try {
      await voice.speak(text, {
        rate: this.state.speed,
        onBoundary: (spoken) => this.update({ spoken }),
      });
      await voice.finished;
    } catch (error) {
      this.update({
        audioError: error instanceof Error ? error.message : String(error),
      });
      // A real reading interval keeps silent/caption lessons paced and interruptible.
      await read();
    }
  }
  private async prepare(
    renderer: LessonCanvas,
    commands: readonly LessonCommand[],
    generation: number,
    branchGeneration?: number,
  ) {
    while (true) {
      await this.gate(generation, branchGeneration !== undefined);
      if (
        branchGeneration !== undefined &&
        branchGeneration !== this.branchGeneration
      ) {
        throw new DOMException("Question replaced", "AbortError");
      }
      try {
        await renderer.prepareStep(commands);
        if (
          generation !== this.generation ||
          (branchGeneration !== undefined &&
            branchGeneration !== this.branchGeneration)
        ) {
          throw new DOMException("Lesson ended", "AbortError");
        }
        this.update({ toolError: "" });
        return;
      } catch (error) {
        if (
          generation !== this.generation ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          throw error;
        }
        this.update({
          toolError: error instanceof Error ? error.message : String(error),
        });
        this.pause();
      }
    }
  }
  get canvas() {
    const target = this.renderer?.target;
    return this.renderer
      ? {
          id: this.renderer.id,
          origin: this.renderer.origin,
          sourceIds: this.renderer.sourceIds,
          document: target
            ? { name: target.name, page: target.page }
            : undefined,
        }
      : undefined;
  }
  async start(
    lesson: Lesson,
    start = 0,
    saved?: TeachingSession["canvas"],
    progress?: Pick<TeachingSession, "correct" | "attempts" | "toolIndex">,
    sourceIds?: readonly string[],
  ) {
    if (
      !Number.isInteger(start) ||
      start < 0 ||
      start > lesson.steps.length ||
      (progress?.toolIndex !== undefined &&
        (!Number.isInteger(progress.toolIndex) ||
          progress.toolIndex < 0 ||
          progress.toolIndex > (lesson.steps[start]?.tools?.length || 0)))
    ) {
      throw new Error(t("fcboard.invalid_lesson_content"));
    }
    lesson.steps.forEach((step) =>
      assertLessonToolsAvailable(step.tools || []),
    );
    this.cancel();
    this.target = this.surface();
    const generation = this.generation;
    this.renderer = new LessonCanvas(this.api, {
      ...saved,
      sourceIds: sourceIds || saved?.sourceIds,
    });
    this.update({
      mode: "teaching",
      lesson,
      step: start,
      correct: progress?.correct || 0,
      attempts: progress?.attempts || 0,
      interruptions: 0,
      audioError: "",
    });
    for (let index = start; index < lesson.steps.length; index++) {
      await this.gate(generation);
      this.update({
        step: index,
        caption: "",
        spoken: 0,
        toolResults: [],
        toolError: "",
        toolIndex: index === start ? progress?.toolIndex || 0 : 0,
      });
      lesson = await this.readyStep(lesson, index, generation);
      const step = lesson.steps[index];
      await this.prepare(this.renderer!, step.commands, generation);
      await this.gate(generation);
      this.update({ caption: step.say });
      const drawing = async () => {
        for (const command of step.commands) {
          await this.gate(generation);
          if (command.type === "wait") {
            this.pause();
            await this.gate(generation);
          } else {
            await this.renderer!.command(
              command,
              this.state.speed,
              matchMedia("(prefers-reduced-motion: reduce)").matches ||
                this.state.lens === "focus",
            );
          }
        }
      };
      await Promise.all([this.say(step.say, this.voice), drawing()]);
      await this.gate(generation);
      if (step.checkpoint) {
        await this.ask(step.checkpoint, generation);
      }
      if (this.state.lens === "focus" && index < lesson.steps.length - 1) {
        this.pause();
        await this.gate(generation);
      }
    }
    for (const question of lesson.quiz) {
      await this.gate(generation);
      await this.ask(question, generation);
    }
    await this.gate(generation);
    this.update({
      mode: "complete",
      caption: this.state.attempts
        ? t("fcboard.lesson_complete_with_results", {
            correct: this.state.correct,
            attempts: this.state.attempts,
          })
        : t("fcboard.lesson_complete"),
      question: undefined,
    });
  }
  private async ask(question: Quiz, generation: number) {
    this.update({
      mode: "quiz",
      question,
      caption: question.question,
      feedback: "",
    });
    void this.say(question.question, this.voice).catch((error) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        this.update({ audioError: String(error) });
      }
    });
    await new Promise<void>((resolve) => {
      this.answerWaiter = resolve;
    });
    if (generation !== this.generation) {
      throw new DOMException("Lesson ended", "AbortError");
    }
  }
  answer(index: number) {
    const question = this.state.question;
    if (
      this.state.mode !== "quiz" ||
      !question ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= question.choices.length
    ) {
      throw new Error(t("fcboard.this_quiz_choice_is_unavailable"));
    }
    const correct = index === question.answer;
    this.voice.stop();
    this.update({
      attempts: this.state.attempts + 1,
      correct: this.state.correct + (correct ? 1 : 0),
      feedback: t(correct ? "fcboard.quiz_correct" : "fcboard.quiz_try_again", {
        explanation: question.explanation,
      }),
      speed: correct ? this.state.speed : Math.max(0.6, this.state.speed * 0.9),
    });
    if (correct) {
      this.update({ mode: "teaching", question: undefined });
      this.answerWaiter?.();
      this.answerWaiter = undefined;
    }
    return correct;
  }
  interrupt() {
    this.pause();
    this.update({
      mode: "question",
      interruptions: this.state.interruptions + 1,
    });
  }
  async branch(lesson: Lesson, sourceIds?: readonly string[]) {
    lesson.steps.forEach((step) =>
      assertLessonToolsAvailable(step.tools || []),
    );
    if (this.state.mode !== "question") {
      this.interrupt();
    }
    this.interjection.stop();
    this.branchRenderer?.cancel();
    this.branchToolRequests.forEach((request) => request.abort());
    const generation = ++this.branchGeneration;
    const mainGeneration = this.generation;
    this.branchActive = true;
    const renderer = new LessonCanvas(this.api, { sourceIds });
    this.branchRenderer = renderer;
    for (const step of lesson.steps) {
      if (generation !== this.branchGeneration) {
        return;
      }
      this.update({ caption: "", spoken: 0, toolResults: [], toolError: "" });
      await this.tools(step.tools, mainGeneration, generation);
      await this.prepare(renderer, step.commands, mainGeneration, generation);
      await this.gate(mainGeneration, true);
      if (generation !== this.branchGeneration) {
        return;
      }
      this.update({ caption: step.say, spoken: 0 });
      await Promise.all([
        this.say(step.say, this.interjection),
        (async () => {
          for (const command of step.commands) {
            if (generation !== this.branchGeneration) {
              return;
            }
            if (command.type !== "wait") {
              await renderer.command(
                command,
                this.state.speed,
                matchMedia("(prefers-reduced-motion: reduce)").matches,
              );
            }
          }
        })(),
      ]);
    }
    if (generation === this.branchGeneration) {
      this.branchActive = false;
      this.update({
        mode: this.state.question ? "quiz" : "paused",
        ...(this.state.question
          ? { caption: this.state.question.question }
          : {}),
      });
    }
  }
}
