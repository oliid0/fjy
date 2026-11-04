import { act, waitFor } from "@testing-library/react";
import { getDefaultAppState } from "@fcboard/fcboard/appState";
import { convertToFcboardElements } from "@fcboard/fcboard";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { Teacher } from "./Teacher";
import { render } from "./test/render";
import { classroomCommands } from "./commands";
import { TeachingEngine } from "./teaching";
import * as ai from "./ai";
import { defaults, saveSettings } from "./settings";

vi.mock("./materials", () => ({ searchMaterials: async () => [] }));
vi.mock("./lessonObserver", () => ({
  observeTeachingStep: async () => undefined,
}));

const lesson = (
  tools: { name: string; args?: Record<string, unknown> }[] = [],
) => ({
  action: "lesson",
  lesson: {
    title: "visible lesson",
    steps: [{ say: "", tools, commands: [] }],
    quiz: [],
  },
});
const setup = () => {
  let pointer = () => {};
  const api = {
    id: "teacher-owner",
    getAppState: () => ({ ...getDefaultAppState(), width: 1600, height: 900 }),
    getSceneElements: () => [],
    getFiles: () => ({}),
    updateScene: vi.fn(),
    onPointerDown: (listener: () => void) => {
      pointer = listener;
      return () => {
        pointer = () => {};
      };
    },
  } as unknown as FcboardImperativeAPI;
  localStorage.setItem(
    "fcboard-teaching",
    JSON.stringify({ lens: "captions" }),
  );
  vi.spyOn(ai, "boardContext").mockResolvedValue({
    elements: [],
    text: "question",
    image: undefined,
  });
  const chat = vi.spyOn(ai, "chat");
  const view = render(<Teacher api={api} onCommand={vi.fn()} />);
  return { api, chat, view, pointer: () => pointer() };
};

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem("fcboard-teaching");
  saveSettings(defaults, false);
});

it.each([false, true])(
  "respects selected lesson screenshot attachment setting=%s",
  async (selectionImages) => {
    saveSettings({ ...defaults, selectionImages }, false);
    const { api, chat, view } = setup();
    const source = convertToFcboardElements([
      { type: "text", text: "selected question", x: 100, y: 100 },
    ]);
    vi.spyOn(api, "getSceneElements").mockReturnValue(source);
    vi.mocked(ai.boardContext).mockResolvedValue({
      elements: source,
      text: "selected question",
      image: "data:image/png;base64,selected",
    });
    chat.mockResolvedValue(JSON.stringify(lesson()));
    try {
      await act(async () => {
        await classroomCommands.execute({
          name: "lesson.teach",
          args: { prompt: "teach selected", sourceIds: [source[0].id] },
        });
      });
      const content = chat.mock.calls[0][0][1].content;
      expect(ai.boardContext).toHaveBeenCalledWith(
        api,
        false,
        source,
        undefined,
        selectionImages,
      );
      expect(Array.isArray(content)).toBe(selectionImages);
      expect(
        JSON.stringify(content).includes("data:image/png;base64,selected"),
      ).toBe(selectionImages);
    } finally {
      view.unmount();
    }
  },
);

it("keeps only its own synthetic pointer interaction from pausing a lesson", async () => {
  const { chat, view, pointer } = setup();
  chat.mockResolvedValue(JSON.stringify(lesson([{ name: "ui.interact" }])));
  const pause = vi.spyOn(TeachingEngine.prototype, "pause");
  let tested = false;
  const stop = classroomCommands.register("ui.interact", "interact", (args) => {
    if (tested) {
      return;
    }
    tested = true;
    const calls = pause.mock.calls.length;
    const owner = args.signal as AbortSignal;
    classroomCommands.withInteraction(owner, pointer);
    expect(pause).toHaveBeenCalledTimes(calls);
    classroomCommands.withInteraction(new AbortController().signal, pointer);
    expect(pause).toHaveBeenCalledTimes(calls + 1);
    void classroomCommands.execute({ name: "lesson.resume" });
    pointer();
    expect(pause).toHaveBeenCalledTimes(calls + 2);
    void classroomCommands.execute({ name: "lesson.resume" });
    expect(owner.aborted).toBe(true);
  });
  try {
    await act(async () => {
      await classroomCommands.execute({
        name: "lesson.teach",
        args: { prompt: "teach" },
      });
    });
    await waitFor(() =>
      expect(classroomCommands.read("teacher")).toMatchObject({
        mode: "complete",
      }),
    );
  } finally {
    view.unmount();
    stop();
  }
});

it("continues teacher preparation across its planned transition, while a manual transition cancels the next request", async () => {
  const { chat, view } = setup();
  const owners: AbortSignal[] = [];
  const stop = classroomCommands.register("files.open", "open", (args) => {
    const owner = args.signal as AbortSignal;
    owners.push(owner);
    classroomCommands.invalidate(owner);
    expect(owner.aborted).toBe(false);
  });
  chat
    .mockResolvedValueOnce(
      JSON.stringify({
        action: "commands",
        commands: [{ name: "files.open", args: { name: "lesson.pdf" } }],
        continue: true,
      }),
    )
    .mockResolvedValueOnce(JSON.stringify(lesson()));
  try {
    await act(async () => {
      await classroomCommands.execute({
        name: "lesson.teach",
        args: { prompt: "open then teach" },
      });
    });
    await waitFor(() =>
      expect(classroomCommands.read("teacher")).toMatchObject({
        mode: "complete",
      }),
    );
    expect(owners).toHaveLength(1);
    expect(chat).toHaveBeenCalledTimes(2);
    let finish!: (value: string) => void;
    chat.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    let pending!: Promise<unknown>;
    act(() => {
      pending = classroomCommands.execute({
        name: "lesson.teach",
        args: { prompt: "wait" },
      });
    });
    await waitFor(() => expect(chat).toHaveBeenCalledTimes(3));
    const current = chat.mock.calls[2][1]!;
    act(() => classroomCommands.invalidate());
    expect(current.aborted).toBe(true);
    await act(async () => {
      finish(JSON.stringify(lesson()));
      await pending;
    });
    expect(classroomCommands.read("teacher")).toMatchObject({ mode: "idle" });
  } finally {
    view.unmount();
    stop();
  }
});

it("lets the voice agent generate a real quiz, inspect its answers, and reopen the same iframe", async () => {
  const { chat, view } = setup();
  saveSettings({ ...defaults, apiKey: "test" }, false);
  const quiz = {
    title: "真实测验",
    questions: [
      {
        type: "single",
        question: "1+1等于？",
        options: ["1", "2"],
        answer: ["B"],
        explanation: "两个1合为2",
      },
    ],
    sources: [{ title: "教材", url: "https://www.moe.gov.cn/" }],
  };
  chat
    .mockResolvedValueOnce("实际检索：https://www.moe.gov.cn/")
    .mockResolvedValueOnce(JSON.stringify(quiz));
  try {
    await expect(
      classroomCommands.execute({ name: "quiz.open" }),
    ).rejects.toThrow();
    let result: unknown;
    await act(async () => {
      result = await classroomCommands.execute({
        name: "quiz.generate",
        args: { prompt: "出1道数学单选题" },
      });
    });
    expect(result).toEqual({ title: quiz.title, count: 1 });
    expect(chat.mock.calls[0][3]).toMatchObject({ webSearch: true });
    expect(
      await classroomCommands.execute({
        name: "quiz.inspect",
        args: { index: 0 },
      }),
    ).toEqual(quiz.questions[0]);
    const frame = view.getByTitle(quiz.title);
    await act(async () => {
      await classroomCommands.execute({ name: "quiz.open" });
    });
    expect(view.getByTitle(quiz.title)).toBe(frame);
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    await expect(
      classroomCommands.execute({ name: "quiz.inspect", args: { index: 1 } }),
    ).rejects.toThrow();
    expect(classroomCommands.read("quiz")).toMatchObject({
      open: true,
      generating: false,
      count: 1,
    });
  } finally {
    view.unmount();
  }
});

it("cancels pending quiz generation on manual navigation and never publishes the stale result", async () => {
  const { chat, view } = setup();
  let finish!: (value: string) => void;
  chat.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  let pending!: Promise<unknown>;
  act(() => {
    pending = classroomCommands
      .execute({ name: "quiz.generate", args: { prompt: "出1道题" } })
      .catch((failure) => failure);
  });
  await waitFor(() => expect(chat).toHaveBeenCalledTimes(1));
  const signal = chat.mock.calls[0][1]!;
  act(() => classroomCommands.invalidate());
  expect(signal.aborted).toBe(true);
  await act(async () => {
    finish("检索已取消");
    await pending;
  });
  expect(view.queryByTitle("真实测验")).toBeNull();
  await expect(
    classroomCommands.execute({ name: "quiz.open" }),
  ).rejects.toThrow();
  view.unmount();
});

it("keeps quiz jobs independent and returns each job's own result when they finish out of order", async () => {
  const { chat, view } = setup();
  const makeQuiz = (title: string) => ({
    title,
    questions: [
      {
        type: "short",
        question: `${title}的问题`,
        answer: ["答案"],
        explanation: "说明",
      },
    ],
    sources: [{ title: "教材", url: "https://www.moe.gov.cn/" }],
  });
  let finishFirst!: (value: string) => void;
  let finishSecond!: (value: string) => void;
  chat
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSecond = resolve;
        }),
    )
    .mockResolvedValueOnce(JSON.stringify(makeQuiz("数学测验")))
    .mockResolvedValueOnce(JSON.stringify(makeQuiz("力学测验")));
  const release = classroomCommands.register(
    "canvas.snapshot",
    "@internal",
    () => ({
      text: "实际课件文字",
      image: "data:image/png;base64,visible-equation",
    }),
  );
  try {
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = classroomCommands.execute({
        name: "quiz.generate",
        args: { prompt: "出1道力学题" },
      });
      second = classroomCommands.execute({
        name: "quiz.generate",
        args: { prompt: "出1道数学题" },
      });
    });
    await waitFor(() => expect(chat).toHaveBeenCalledTimes(2));
    expect(chat.mock.calls[0][1]?.aborted).toBe(false);
    expect(JSON.stringify(chat.mock.calls[0][0][1].content)).toContain(
      "data:image/png;base64,visible-equation",
    );
    await act(async () => {
      finishSecond("数学资料 https://www.moe.gov.cn/");
      await expect(second).resolves.toEqual({ title: "数学测验", count: 1 });
    });
    expect(chat.mock.calls[0][1]?.aborted).toBe(false);
    await act(async () => {
      finishFirst("物理资料 https://www.moe.gov.cn/");
      await expect(first).resolves.toEqual({ title: "力学测验", count: 1 });
    });
    expect(
      await classroomCommands.execute({ name: "quiz.inspect" }),
    ).toMatchObject({ title: "数学测验", count: 1 });
    expect(view.getByTitle("数学测验")).toBeVisible();
    expect(view.queryByTitle("力学测验")).toBeNull();
  } finally {
    view.unmount();
    release();
  }
});
