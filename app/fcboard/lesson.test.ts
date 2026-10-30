import { t } from "@fcboard/fcboard/i18n";

import { LessonCanvas, revealPath, validateLesson } from "./lesson";
import { formulaSvg } from "./formula";
import { sceneAPI } from "./test/scene";

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
      t("fcboard.unsupported_lesson_command_type", { type: "eval" }),
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
    ).toThrow(t("fcboard.lesson_command_value_out_of_range"));
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
  it("rejects executable or recursive lesson tools and permits result checks only on read commands", () => {
    const invalid = [
      [{ name: "ui.invoke", args: { script: "alert(1)" } }],
      [{ name: "lesson.teach", args: { prompt: "again" } }],
      [{ name: "canvas.ink", args: { points: () => [] } }],
      [{ name: "canvas.style", args: { width: Infinity } }],
      [
        {
          name: "resources.inspect",
          expect: [{ path: "constructor.prototype", equals: true }],
        },
      ],
      [
        {
          name: "canvas.ink",
          expect: [{ path: "ids.0", equals: "not-known" }],
        },
      ],
    ];
    for (const tools of invalid) {
      expect(() =>
        validateLesson({ steps: [{ commands: [], tools }] }),
      ).toThrow();
    }
    const tools = [
      {
        name: "resources.inspect",
        args: { id: "actual-lesson" },
        expect: [{ path: "outputs.0", equals: "5 m/s²" }],
      },
    ];
    expect(
      validateLesson({ steps: [{ commands: [], tools }] }).steps[0].tools,
    ).toEqual(tools);
    for (const name of ["ui.inspect", "web.action", "signal.action"]) {
      const read = {
        name,
        args: name === "ui.inspect" ? {} : { action: "read" },
        expect: [{ path: "open", equals: true }],
      };
      expect(
        validateLesson({ steps: [{ commands: [], tools: [read] }] }).steps[0]
          .tools,
      ).toEqual([read]);
    }
    for (const name of ["web.action", "signal.action"]) {
      expect(() =>
        validateLesson({
          steps: [
            {
              commands: [],
              tools: [
                {
                  name,
                  args: { action: "close" },
                  expect: [{ path: "open", equals: false }],
                },
              ],
            },
          ],
        }),
      ).toThrow();
    }
    expect(() =>
      validateLesson({
        steps: Array.from({ length: 4 }, () => ({
          commands: [],
          tools: Array.from({ length: 20 }, () => ({ name: "canvas.inspect" })),
        })),
      }),
    ).toThrow();
  });
  it("continues writing after font measurement updates an element version", async () => {
    vi.useFakeTimers();
    const api = sceneAPI();
    const update = api.updateScene;
    api.updateScene = (next) =>
      update({
        ...next,
        elements: next.elements?.map((element) =>
          element.type === "text"
            ? {
                ...element,
                version: element.version + 1,
                width: element.width + 1,
              }
            : element,
        ),
      });
    const renderer = new LessonCanvas(api);
    const command = script([
      {
        type: "write_text",
        id: "explanation",
        text: "两边同时减去1",
        duration: 1,
      },
    ]).steps[0].commands[0];
    const writing = renderer.command(command);
    await vi.advanceTimersByTimeAsync(1500);
    await writing;
    expect(
      api
        .getSceneElements()
        .some(
          (element) =>
            element.type === "text" && element.text === "两边同时减去1",
        ),
    ).toBe(true);
  });
  it("preserves a human text edit made during progressive writing", async () => {
    vi.useFakeTimers();
    const api = sceneAPI();
    const renderer = new LessonCanvas(api);
    const command = script([
      {
        type: "write_text",
        id: "explanation",
        text: "自动讲解的内容",
        duration: 1,
      },
    ]).steps[0].commands[0];
    const writing = renderer.command(command);
    await vi.advanceTimersByTimeAsync(150);
    api.updateScene({
      elements: api.getSceneElements().map((element) =>
        element.customData?.fcTutorId === "explanation" &&
        element.type === "text"
          ? {
              ...element,
              text: "我来写",
              originalText: "我来写",
              version: element.version + 1,
            }
          : element,
      ),
    });
    await vi.advanceTimersByTimeAsync(1500);
    await writing;
    expect(
      api
        .getSceneElements()
        .some(
          (element) => element.type === "text" && element.text === "我来写",
        ),
    ).toBe(true);
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
