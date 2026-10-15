import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { LessonCanvas, revealPath, validateLesson } from "./lesson";
import { formulaSvg } from "./formula";

export const sceneAPI = () => {
  let scene: readonly ExcalidrawElement[] = convertToExcalidrawElements([
    { type: "text", text: "学生的题目", x: 10, y: 10 },
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
    addFiles: vi.fn(),
    updateScene: vi.fn((update) => {
      if (update.elements) {
        scene = update.elements;
      }
    }),
  } as unknown as ExcalidrawImperativeAPI;
  return api;
};
const script = (commands: unknown[]) =>
  validateLesson({
    title: "一次函数",
    steps: [{ say: "观察斜率。", commands }],
    quiz: [],
  });

describe("progressive lesson writing", () => {
  afterEach(() => vi.useRealTimers());
  it("reveals paths by distance and preserves student work when clearing AI content", async () => {
    expect(
      revealPath(
        [
          [0, 0],
          [100, 0],
          [100, 300],
        ],
        0.5,
      ),
    ).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
    ]);
    const api = sceneAPI();
    const renderer = new LessonCanvas(api);
    const student = api.getSceneElements()[0].id;
    const lesson = script([
      {
        type: "draw_arrow",
        id: "slope",
        x: 0,
        y: 0,
        width: 140,
        height: -50,
        duration: 0,
      },
      { type: "clear_canvas", duration: 0 },
    ]);
    await renderer.command(lesson.steps[0].commands[0]);
    expect(api.getSceneElements()).toHaveLength(2);
    await renderer.command(lesson.steps[0].commands[1]);
    expect(api.getSceneElements().map((el) => el.id)).toEqual([student]);
  });
  it("freezes an unfinished stroke and prevents late writes after cancellation", async () => {
    vi.useFakeTimers();
    const api = sceneAPI();
    const renderer = new LessonCanvas(api);
    const command = script([
      { type: "draw_line", id: "line", width: 200, height: 0, duration: 1 },
    ]).steps[0].commands[0];
    const result = renderer.command(command).catch((error) => error);
    await vi.advanceTimersByTimeAsync(160);
    const before = JSON.stringify(api.getSceneElements());
    renderer.pause();
    await vi.advanceTimersByTimeAsync(500);
    expect(JSON.stringify(api.getSceneElements())).toBe(before);
    renderer.cancel();
    expect((await result).name).toBe("AbortError");
    await vi.advanceTimersByTimeAsync(1000);
    expect(JSON.stringify(api.getSceneElements())).toBe(before);
  });
  it("rejects unknown AI operations before changing a scene", () => {
    expect(() => script([{ type: "eval", text: "alert(1)" }])).toThrow(
      "不支持",
    );
    expect(() =>
      script([
        {
          type: "draw_path",
          points: [
            [0, 0],
            [Infinity, 10],
          ],
        },
      ]),
    ).toThrow("范围");
    expect(() =>
      validateLesson({
        steps: [
          {
            commands: [],
            checkpoint: { question: "?", choices: ["a", "b"], answer: 3 },
          },
        ],
      }),
    ).toThrow();
  });
  it("renders integral and fraction formulas as self-contained SVG glyphs", () => {
    const result = formulaSvg("\\int_0^1 x^2\\,dx=\\frac{1}{3}");
    expect(result.svg).toContain("<path");
    expect(result.svg).toContain("<svg");
    expect(result.width).toBeGreaterThan(100);
    expect(result.height).toBeGreaterThan(20);
    expect(result.svg).not.toContain("<script");
    expect(() => formulaSvg("\\href{https://other.example}{x}")).toThrow();
  });
});
