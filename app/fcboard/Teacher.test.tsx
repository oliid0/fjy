import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { t } from "@fcboard/fcboard/i18n";
import { getDefaultAppState } from "@fcboard/fcboard/appState";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";
import type { DataURL } from "@fcboard/fcboard/types";

import { Teacher } from "./Teacher";
import { render } from "./test/render";
import { classroomCommands } from "./commands";
import * as ai from "./ai";
import * as quizzes from "./quiz";
import * as quizRequests from "./quizRequests";
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
  const view = render(<Teacher api={api} />);
  return { api, chat, view, pointer: () => pointer() };
};

const builderQuiz = () => ({
  title: "Builder quiz",
  questions: [
    {
      type: "calculation" as const,
      question: "2+3=?",
      answer: ["5"],
      explanation: "Add two and three.",
    },
  ],
  sources: [],
});

it("submits builder controls through the shared generation/cards flow without creating board ink", async () => {
  const { api, view } = setup();
  const generate = vi
    .spyOn(quizzes, "generateQuiz")
    .mockResolvedValue(builderQuiz());
  try {
    await act(async () => {
      await classroomCommands.execute({ name: "assistant.open" });
    });
    fireEvent.change(
      await screen.findByRole("combobox", {
        name: t("fcboard.quizForm.grade"),
      }),
      { target: { value: "5" } },
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: t("fcboard.quizForm.type") }),
      { target: { value: "calculation" } },
    );
    fireEvent.click(
      screen.getByRole("radio", { name: t("fcboard.quizForm.easy") }),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: t("fcboard.quizForm.supplement") }),
      { target: { value: "分数加减法" } },
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: t("fcboard.quizForm.generate"),
      }),
    );
    await waitFor(() => expect(view.getByTitle("Builder quiz")).toBeVisible());
    expect(generate).toHaveBeenCalledWith(
      expect.stringContaining("Grade 5"),
      expect.any(AbortSignal),
      "question",
      undefined,
      "calculation",
      expect.any(Function),
    );
    expect(generate.mock.calls[0][0]).toContain("Difficulty: easy");
    expect(generate.mock.calls[0][0]).toContain("分数加减法");
    expect(api.updateScene).not.toHaveBeenCalled();
    expect(classroomCommands.has("question.cancel")).toBe(false);
  } finally {
    view.unmount();
  }
});

it("cancels pending builder inference from the visible loading panel and ignores late completion", async () => {
  const { view } = setup();
  let finish!: (value: ReturnType<typeof builderQuiz>) => void;
  const generate = vi.spyOn(quizzes, "generateQuiz").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  try {
    await act(async () => {
      await classroomCommands.execute({ name: "assistant.open" });
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: t("fcboard.quizForm.generate"),
      }),
    );
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    const result = await screen.findByRole("dialog", {
      name: t("fcboard.quizForm.results"),
    });
    expect(within(result).getByRole("status")).toBeVisible();
    fireEvent.click(
      within(result).getByRole("button", { name: t("buttons.cancel") }),
    );
    expect(generate.mock.calls[0][1].aborted).toBe(true);
    await act(async () => {
      finish(builderQuiz());
    });
    expect(view.queryByTitle("Builder quiz")).toBeNull();
  } finally {
    view.unmount();
  }
});

it("shows a real generation error and preserves the editable request for retry", async () => {
  const { view } = setup();
  vi.spyOn(quizzes, "generateQuiz").mockRejectedValue(
    new Error("provider busy"),
  );
  try {
    await act(async () => {
      await classroomCommands.execute({ name: "assistant.open" });
    });
    fireEvent.change(
      await screen.findByRole("textbox", {
        name: t("fcboard.quizForm.supplement"),
      }),
      { target: { value: "Retry these requirements" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.quizForm.generate") }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("provider busy"),
    );
    await act(async () => {
      await classroomCommands.execute({ name: "assistant.close" });
      await classroomCommands.execute({ name: "assistant.open" });
    });
    expect(
      screen.getByRole("textbox", { name: t("fcboard.quizForm.supplement") }),
    ).toHaveValue("Retry these requirements");
  } finally {
    view.unmount();
  }
});

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
    title: "出1道数学单选题",
    questions: [
      {
        type: "single",
        question: "1+1等于？",
        options: ["1", "2"],
        answer: ["B"],
        explanation: "两个1合为2",
      },
    ],
  };
  chat.mockResolvedValueOnce(
    JSON.stringify({ ...quiz.questions[0], needsImage: false }),
  );
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
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0][3]).toMatchObject({ quickVision: true });
    expect(
      await classroomCommands.execute({
        name: "quiz.inspect",
        args: { index: 0 },
      }),
    ).toMatchObject(quiz.questions[0]);
    const frame = await view.findByTitle(quiz.title);
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
  expect(view.queryByTitle("出1道题")).toBeNull();
  await expect(
    classroomCommands.execute({ name: "quiz.open" }),
  ).rejects.toThrow();
  view.unmount();
});

it("keeps quiz jobs independent and returns each job's own result when they finish out of order", async () => {
  const { chat, view } = setup();
  const question = (topic: string) =>
    JSON.stringify({
      type: "short",
      question: `${topic}的问题`,
      answer: ["答案"],
      explanation: "说明",
      needsImage: false,
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
    );
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
      finishSecond(question("数学"));
      await expect(second).resolves.toEqual({ title: "出1道数学题", count: 1 });
    });
    expect(chat.mock.calls[0][1]?.aborted).toBe(false);
    await act(async () => {
      finishFirst(question("力学"));
      await expect(first).resolves.toEqual({ title: "出1道力学题", count: 1 });
    });
    expect(
      await classroomCommands.execute({ name: "quiz.inspect" }),
    ).toMatchObject({ title: "出1道数学题", count: 1 });
    expect(view.getByTitle("出1道数学题")).toBeVisible();
    expect(view.queryByTitle("出1道力学题")).toBeNull();
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
      undefined,
      expect.any(Function),
    );
    expect(snapshot).not.toHaveBeenCalled();
    expect(ai.boardContext).not.toHaveBeenCalled();
  } finally {
    stop();
    view.unmount();
  }
});

it("publishes the latest partial quiz immediately while preserving its iframe through final completion", async () => {
  const { view } = setup();
  let publish!: NonNullable<Parameters<typeof quizzes.generateQuiz>[5]>;
  let finish!: (quiz: quizzes.Quiz) => void;
  vi.spyOn(quizzes, "generateQuiz").mockImplementation(
    (_prompt, _signal, _context, _image, _type, onProgress) => {
      publish = onProgress!;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  );
  let job!: Promise<unknown>;
  act(() => {
    job = classroomCommands.execute({
      name: "quiz.generate",
      args: { prompt: "出2道题" },
    });
  });
  await waitFor(() => expect(typeof publish).toBe("function"));
  const partial: quizzes.Quiz = {
    ...builderQuiz(),
    id: "partial",
    plannedCount: 2,
    generating: true,
  };
  act(() => publish(partial));
  const frame = view.getByTitle(partial.title);
  expect(frame).toBeVisible();
  expect(classroomCommands.read("quiz")).toMatchObject({
    count: 1,
    generating: true,
  });
  expect(
    await classroomCommands.execute({
      name: "quiz.inspect",
      args: { index: 0 },
    }),
  ).toEqual(partial.questions[0]);
  await act(async () => {
    finish({ ...partial, generating: false });
    await job;
  });
  expect(view.getByTitle(partial.title)).toBe(frame);
  expect(classroomCommands.read("quiz")).toMatchObject({
    count: 1,
    generating: false,
  });
  view.unmount();
});

it("immediately stops visible native-style pending work, ignores its late progress and can retry the same image after reopen", async () => {
  const { view } = setup();
  let publish!: NonNullable<Parameters<typeof quizzes.generateQuiz>[5]>;
  let finish!: (quiz: quizzes.Quiz) => void;
  vi.spyOn(quizzes, "generateQuiz").mockImplementation(
    (_prompt, _signal, _context, _image, _type, onProgress) => {
      publish = onProgress!;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  );
  let job!: Promise<unknown>;
  act(() => {
    job = classroomCommands
      .execute({ name: "quiz.generate", args: { prompt: "出2道题" } })
      .catch(() => undefined);
  });
  await waitFor(() => expect(typeof publish).toBe("function"));
  const partial: quizzes.Quiz = {
    ...builderQuiz(),
    id: "cancel-images",
    plannedCount: 2,
    generating: true,
    questions: [
      {
        ...builderQuiz().questions[0],
        id: "image-1",
        image: {
          method: "draw",
          spec: {
            mode: "vega-lite" as const,
            spec: {
              data: { values: [{ x: 1, y: 2 }] },
              mark: "point",
              encoding: {
                x: { field: "x", type: "quantitative" },
                y: { field: "y", type: "quantitative" },
              },
            },
          },
          caption: "两个苹果",
          status: "pending",
        },
      },
    ],
  };
  act(() => publish(partial));
  const frame = view.getByTitle(partial.title) as HTMLIFrameElement;
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  fireEvent.load(frame);
  const channel = post.mock.calls.at(-1)![0].channel;
  fireEvent.click(
    within(
      screen.getByRole("dialog", { name: t("fcboard.quizForm.results") }),
    ).getByRole("button", { name: t("buttons.close") }),
  );
  expect(classroomCommands.read("quiz")).toMatchObject({
    open: false,
    generating: false,
  });
  act(() => publish({ ...partial, title: "late stale title" }));
  expect(classroomCommands.read("quiz")).toMatchObject({
    title: partial.title,
  });
  await act(async () => {
    await classroomCommands.execute({ name: "quiz.open" });
  });
  expect(view.getByTitle(partial.title)).toBe(frame);
  expect(
    await classroomCommands.execute({
      name: "quiz.inspect",
      args: { index: 0 },
    }),
  ).toMatchObject({ image: { status: "error" } });
  await act(async () => {
    finish(partial);
    await job;
  });
  const retry = vi
    .spyOn(quizRequests, "generateQuizImage")
    .mockResolvedValue("data:image/png;base64,aGVsbG8=" as DataURL);
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        data: { type: "quiz-retry-image", channel, id: "image-1" },
      }),
    );
  });
  expect(retry).toHaveBeenCalledTimes(1);
  expect(
    await classroomCommands.execute({
      name: "quiz.inspect",
      args: { index: 0 },
    }),
  ).toMatchObject({
    image: { status: "ready", dataURL: "data:image/png;base64,aGVsbG8=" },
  });
  expect(view.getByTitle(partial.title)).toBe(frame);
  view.unmount();
});
