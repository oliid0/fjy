import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { TeachingEngine } from "./teaching";
import { validateLesson } from "./lesson";

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
