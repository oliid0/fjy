import { act, waitFor } from "@testing-library/react";
import { getDefaultAppState } from "@fcboard/fcboard/appState";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { Teacher } from "./Teacher";
import { render } from "./test/render";
import { classroomCommands } from "./commands";
import * as ai from "./ai";
import * as quizzes from "./quiz";
import { defaults, saveSettings } from "./settings";

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

it("does not register the removed lesson player or its panels", () => {
  const { view } = setup();
  try {
    for (const name of [
      "lesson.ask",
      "lesson.teach",
      "lesson.resume",
      "lesson.audio",
      "lesson.reopen",
    ]) {
      expect(classroomCommands.has(name)).toBe(false);
    }
    expect(classroomCommands.read("teacher")).toBeUndefined();
    expect(view.container.querySelector(".fc-teacher")).toBeNull();
  } finally {
    view.unmount();
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

it("uses the supplied selected PNG for Quiz without recapturing the whole canvas", async () => {
  const { view } = setup();
  const generate = vi.spyOn(quizzes, "generateQuiz").mockResolvedValue({
    title: "Selection quiz",
    questions: [
      {
        type: "short",
        question: "What is shown?",
        answer: ["A dog"],
        explanation: "The selection shows a dog.",
      },
    ],
    sources: [],
  });
  const snapshot = vi.fn();
  const stop = classroomCommands.register(
    "canvas.snapshot",
    "@internal",
    snapshot,
  );
  const controller = new AbortController();
  try {
    await act(async () => {
      expect(
        await classroomCommands.execute({
          name: "quiz.generate",
          args: {
            prompt: "出题",
            context: { text: "", image: "data:image/png;base64,selected" },
            signal: controller.signal,
          },
        }),
      ).toEqual({ title: "Selection quiz", count: 1 });
    });
    expect(generate).toHaveBeenCalledWith(
      "出题",
      expect.any(AbortSignal),
      "",
      "data:image/png;base64,selected",
    );
    expect(snapshot).not.toHaveBeenCalled();
    expect(ai.boardContext).not.toHaveBeenCalled();
  } finally {
    stop();
    view.unmount();
  }
});
