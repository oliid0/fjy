import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { TeachingEngine } from "./teaching";
import { validateLesson } from "./lesson";
import { classroomCommands } from "./commands";

const setup = () => {
  let scene: readonly ExcalidrawElement[] = convertToExcalidrawElements([
    { type: "text", x: 0, y: 0, text: "学生题目" },
  ]);
  const api = {
    getSceneElements: () => scene,
    getAppState: () => ({
      scrollX: 0,
      scrollY: 0,
      width: 1600,
      height: 900,
      zoom: { value: 1 },
      selectedElementIds: {},
    }),
    updateScene: (next: { elements?: readonly ExcalidrawElement[] }) => {
      if (next.elements) {
        scene = next.elements;
      }
    },
  } as unknown as ExcalidrawImperativeAPI;
  const engine = new TeachingEngine(api);
  engine.configure(1, "captions");
  return { engine, api };
};
const step = (id: string) => ({
  say: "观察这一步",
  commands: [{ type: "write_text", id, text: id, duration: 0.5, x: 0, y: 0 }],
});
describe("shared teaching flow", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("continues a planned file open and page change on the new visible page with its own real tool signals", async () => {
    const { engine, api } = setup();
    let document:
      | { id: string; name: string; page: number; ink: never[] }
      | undefined;
    const draw = vi.fn();
    const signals: AbortSignal[] = [];
    const stops = [
      classroomCommands.context("document", () => document),
      classroomCommands.register("files.open", "open", (args) => {
        const signal = args.signal as AbortSignal;
        expect(engine.ownsSignal(signal)).toBe(true);
        expect(engine.ownsSignal(new AbortController().signal)).toBe(false);
        signals.push(signal);
        document = { id: "course", name: "lesson.pdf", page: 1, ink: [] };
        classroomCommands.invalidate(signal);
        stops.push(
          classroomCommands.register("document.page", "page", (args) => {
            const signal = args.signal as AbortSignal;
            expect(engine.ownsSignal(signal)).toBe(true);
            signals.push(signal);
            document = { ...document!, page: 2 };
            classroomCommands.invalidate(signal);
          }),
        );
      }),
      classroomCommands.register("document.draw", "@internal", (args) =>
        draw(document!.page, args),
      ),
    ];
    try {
      const result = engine.start(
        validateLesson({
          steps: [
            {
              say: "",
              tools: [
                { name: "files.open", args: { name: "lesson.pdf" } },
                { name: "document.page", args: { page: 2 } },
              ],
              commands: [
                {
                  type: "draw_rectangle",
                  id: "new-page",
                  x: 10,
                  y: 20,
                  width: 30,
                  height: 40,
                  duration: 0,
                },
              ],
            },
          ],
          quiz: [],
        }),
      );
      await vi.advanceTimersByTimeAsync(50);
      await result;
      expect(engine.state.mode).toBe("complete");
      expect(engine.canvas?.document).toEqual({ name: "lesson.pdf", page: 2 });
      expect(draw).toHaveBeenCalled();
      expect(draw.mock.calls.every(([page]) => page === 2)).toBe(true);
      expect(api.getSceneElements()).toHaveLength(1);
      expect(signals.every((signal) => !engine.ownsSignal(signal))).toBe(true);
    } finally {
      engine.cancel();
      stops.forEach((stop) => stop());
    }
  });
  it("rejects a manual or unrelated surface transition during a lesson tool", async () => {
    const { engine } = setup();
    let page = 1;
    const task = new AbortController();
    const stops = [
      classroomCommands.context("document", () => ({
        id: "course",
        name: "lesson.pdf",
        page,
        ink: [],
      })),
      classroomCommands.register("document.page", "page", () => {
        page = 2;
        classroomCommands.invalidate(task.signal);
      }),
    ];
    try {
      const result = engine
        .start(
          validateLesson({
            steps: [
              {
                say: "",
                tools: [{ name: "document.page", args: { page: 2 } }],
                commands: [],
              },
            ],
            quiz: [],
          }),
        )
        .catch((error) => error);
      await vi.advanceTimersByTimeAsync(50);
      expect((await result).name).toBe("AbortError");
      expect(engine.state.mode).toBe("idle");
      expect(engine.ownsSignal(task.signal)).toBe(false);
    } finally {
      engine.cancel();
      stops.forEach((stop) => stop());
    }
  });
  it("pauses cancelled owner work and accepts only a fresh scope when explicitly resumed", async () => {
    const { engine } = setup();
    const owner = new AbortController();
    const signals: AbortSignal[] = [];
    const complete: (() => void)[] = [];
    const later = vi.fn();
    const stops = [
      classroomCommands.register("files.open", "open", (args) => {
        signals.push(args.signal as AbortSignal);
        return new Promise<void>((resolve) => complete.push(resolve));
      }),
      classroomCommands.register("test.after", "after", later),
    ];
    const running = engine.start(
      validateLesson({
        steps: [
          {
            say: "",
            commands: [],
            tools: [{ name: "files.open" }, { name: "test.after" }],
          },
        ],
        quiz: [],
      }),
      0,
      undefined,
      undefined,
      undefined,
      owner.signal,
    );
    try {
      await vi.advanceTimersByTimeAsync(1);
      expect(signals).toHaveLength(1);
      owner.abort();
      await vi.advanceTimersByTimeAsync(1);
      expect(engine.state.mode).toBe("paused");
      expect(signals[0].aborted).toBe(true);
      expect(later).not.toHaveBeenCalled();
      expect(() => engine.resume(owner.signal)).toThrow();
      expect(engine.state.mode).toBe("paused");
      const resumed = new AbortController();
      engine.resume(resumed.signal);
      await vi.advanceTimersByTimeAsync(1);
      expect(signals).toHaveLength(2);
      expect(classroomCommands.isOwnedBy(signals[1], resumed.signal)).toBe(
        true,
      );
      complete[1]();
      await vi.advanceTimersByTimeAsync(1);
      await running;
      expect(engine.state.mode).toBe("complete");
      expect(later).toHaveBeenCalledTimes(1);
      complete[0]();
      await vi.advanceTimersByTimeAsync(1);
      expect(later).toHaveBeenCalledTimes(1);
    } finally {
      engine.cancel();
      complete.forEach((resolve) => resolve());
      stops.forEach((stop) => stop());
      await running.catch(() => {});
    }
  });
  it("pauses writing, answers an interruption, and resumes the original step only on request", async () => {
    const { engine, api } = setup();
    const result = engine.start(
      validateLesson({ steps: [step("主课")], quiz: [] }),
    );
    await vi.advanceTimersByTimeAsync(150);
    engine.pause();
    const frozen = JSON.stringify(api.getSceneElements());
    await vi.advanceTimersByTimeAsync(700);
    expect(JSON.stringify(api.getSceneElements())).toBe(frozen);
    const branch = engine.branch(
      validateLesson({ steps: [step("追问")], quiz: [] }),
    );
    await vi.advanceTimersByTimeAsync(200);
    engine.pause();
    const branchFrozen = JSON.stringify(api.getSceneElements());
    await vi.advanceTimersByTimeAsync(2000);
    expect(JSON.stringify(api.getSceneElements())).toBe(branchFrozen);
    engine.resume();
    await vi.advanceTimersByTimeAsync(2000);
    await branch;
    expect(engine.state.mode).toBe("paused");
    engine.resume();
    await vi.advanceTimersByTimeAsync(2000);
    await result;
    expect(engine.state.mode).toBe("complete");
    expect(engine.state.audioError).toBe("");
    expect(
      api
        .getSceneElements()
        .some(
          (element) => element.type === "text" && element.text === "学生题目",
        ),
    ).toBe(true);
  });
  it("keeps a missed checkpoint available and adapts pace before continuing", async () => {
    const { engine } = setup();
    const result = engine.start(
      validateLesson({
        steps: [{ say: "", commands: [] }],
        quiz: [
          {
            question: "1+1?",
            choices: ["1", "2"],
            answer: 1,
            explanation: "把两个1合起来",
          },
        ],
      }),
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(engine.state.mode).toBe("quiz");
    expect(engine.answer(0)).toBe(false);
    expect(engine.state.mode).toBe("quiz");
    expect(engine.state.speed).toBeLessThan(1);
    expect(engine.answer(1)).toBe(true);
    await result;
    expect(engine.state.correct).toBe(1);
    expect(engine.state.attempts).toBe(2);
    expect(engine.state.mode).toBe("complete");
  });
  it("cancels both teaching branches and clears the saved lesson identity", async () => {
    const { engine, api } = setup();
    const result = engine
      .start(validateLesson({ steps: [step("主课")], quiz: [] }))
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(150);
    engine.cancel();
    const frozen = JSON.stringify(api.getSceneElements());
    await vi.advanceTimersByTimeAsync(3000);
    expect((await result).name).toBe("AbortError");
    expect(engine.state.lesson).toBeUndefined();
    expect(JSON.stringify(api.getSceneElements())).toBe(frozen);
  });
  it("can end a question during a quiz without leaving an unhandled caption task", async () => {
    const { engine } = setup();
    const result = engine
      .start(
        validateLesson({
          steps: [{ say: "", commands: [] }],
          quiz: [
            {
              question: "下一步应该怎样计算？",
              choices: ["加1", "减1"],
              answer: 1,
            },
          ],
        }),
      )
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(1);
    const answer = engine
      .branch(validateLesson({ steps: [step("提示")], quiz: [] }))
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(200);
    engine.cancel();
    await vi.advanceTimersByTimeAsync(2000);
    expect((await result).name).toBe("AbortError");
    await answer;
    expect(engine.state.mode).toBe("idle");
  });
});
