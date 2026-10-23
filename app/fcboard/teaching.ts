import { t } from "@excalidraw/excalidraw/i18n";
import { createStore, get, set } from "idb-keyval";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { LessonCanvas } from "./lesson";
import { createNarrator } from "./narration";

import type { Lesson, Quiz } from "./lesson";

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
};
export type TeachingSession = {
  id: string;
  board: string;
  lesson: Lesson;
  step: number;
  correct: number;
  attempts: number;
  updated: number;
  canvas: {
    id: string;
    origin: { x: number; y: number };
    document?: { name: string; page: number };
  };
};
const storage = createStore("fcboard-lessons", "lessons");
export const lessonSessions = async () =>
  (await get<TeachingSession[]>("sessions", storage)) || [];
export const saveLessonSession = async (session: TeachingSession) => {
  const sessions = await lessonSessions();
  await set(
    "sessions",
    [session, ...sessions.filter((item) => item.id !== session.id)].slice(
      0,
      100,
    ),
    storage,
  );
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
  };
  private listeners = new Set<(state: TeachingState) => void>();
  private generation = 0;
  private branchGeneration = 0;
  private branchActive = false;
  private waiting = new Set<() => void>();
  private answerWaiter?: () => void;
  private renderer?: LessonCanvas;
  private branchRenderer?: LessonCanvas;
  private voice = createNarrator();
  private interjection = createNarrator();
  constructor(private api: ExcalidrawImperativeAPI) {}
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
  private async gate(generation: number, branch = false) {
    while (
      generation === this.generation &&
      (["paused", "generating"].includes(this.state.mode) ||
        (!branch && this.state.mode === "question"))
    ) {
      await new Promise<void>((resolve) => this.waiting.add(resolve));
    }
    if (generation !== this.generation) {
      throw new DOMException("讲解已结束", "AbortError");
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
  get canvas() {
    return this.renderer
      ? {
          id: this.renderer.id,
          origin: this.renderer.origin,
          document: this.renderer.target,
        }
      : undefined;
  }
  async start(
    lesson: Lesson,
    start = 0,
    saved?: TeachingSession["canvas"],
    progress?: Pick<TeachingSession, "correct" | "attempts">,
  ) {
    this.cancel();
    const generation = this.generation;
    this.renderer = new LessonCanvas(this.api, saved);
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
      const step = lesson.steps[index];
      this.update({ step: index, caption: step.say, spoken: 0 });
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
        ? `这一课完成了：答对 ${this.state.correct} 题，尝试 ${this.state.attempts} 次。可以继续提问或在板上试一试。`
        : "这一课完成了。可以继续提问，或在白板上试一试。",
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
      throw new DOMException("讲解已结束", "AbortError");
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
      throw new Error(t("fcboard.当前没有这道测验选项"));
    }
    const correct = index === question.answer;
    this.voice.stop();
    this.update({
      attempts: this.state.attempts + 1,
      correct: this.state.correct + (correct ? 1 : 0),
      feedback: `${correct ? "答对了。" : "再想一想。"}${question.explanation}`,
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
  async branch(lesson: Lesson) {
    if (this.state.mode !== "question") {
      this.interrupt();
    }
    this.interjection.stop();
    this.branchRenderer?.cancel();
    const generation = ++this.branchGeneration;
    this.branchActive = true;
    const renderer = new LessonCanvas(this.api);
    this.branchRenderer = renderer;
    for (const step of lesson.steps) {
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
