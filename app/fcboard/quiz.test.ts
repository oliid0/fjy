import { t } from "@fcboard/fcboard/i18n";

import { waitFor } from "@testing-library/react";

import type { DataURL } from "@fcboard/fcboard/types";

import { generateQuiz, quizDocument, quizUpdate, validateQuiz } from "./quiz";
import { defaults, saveSettings } from "./settings";
import * as ai from "./ai";
import * as images from "./imageGeneration";
import * as graphics from "./quizGraphic";

import type { Quiz } from "./quiz";

const quiz = (): Quiz => ({
  title: "函数测验",
  questions: [
    {
      type: "single",
      question: "f(x)=x²，f(2)等于？",
      options: ["2", "4", "8", "16"],
      answer: ["B"],
      explanation: "将x=2代入，2²=4。",
    },
    {
      type: "fill",
      question: "1+1=____",
      answer: ["2"],
      explanation: "两个1合为2。",
    },
    {
      type: "calculation",
      question: "计算3×4",
      answer: ["12"],
      explanation: "乘法计算。",
      steps: ["3×4=3+3+3+3", "结果为12"],
    },
  ],
  sources: [{ title: "教材", url: "https://www.moe.gov.cn/" }],
});

const candidate = (index: number) => ({
  ...quiz().questions[0],
  question: `独立题目 ${index + 1}`,
  needsImage: false,
});
const taskIndex = (messages: ai.Message[]) => {
  const content = messages[1].content;
  const text =
    typeof content === "string"
      ? content
      : content.find((item) => item.type === "text")!.text;
  return (JSON.parse(text).task as number) - 1;
};
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

it("starts questions immediately with the chosen model and reports an invalid type without another model request", async () => {
  saveSettings(
    { ...defaults, apiKey: "test", textModel: "chosen-model" },
    false,
  );
  const chat = vi
    .spyOn(ai, "chat")
    .mockResolvedValue(
      JSON.stringify({ ...candidate(0), type: "calculation" }),
    );
  const progress = vi.fn();
  const result = await generateQuiz(
    "出1道题",
    new AbortController().signal,
    "real board",
    undefined,
    "single",
    progress,
  );
  expect(chat).toHaveBeenCalledTimes(1);
  expect(chat.mock.calls[0][3]).toMatchObject({ quickVision: true });
  expect(chat.mock.calls[0][3]?.webSearch).toBeUndefined();
  expect(chat.mock.calls[0][2]).toMatchObject({ model: "chosen-model" });
  expect(result.questions).toEqual([]);
  expect(result.errors![0]).toContain(
    t("fcboard.quizForm.typeMismatch", {
      type: t("fcboard.aiMessages.quizType_single"),
    }),
  );
  expect(progress.mock.calls[0][0]).toMatchObject({
    plannedCount: 1,
    generating: true,
    questions: [],
  });
  expect(result.generating).toBe(false);
});

it.each([
  ["出十道初中物理题", 10],
  ["根据第一道题出二十道选择题", 20],
  ["出两道数学题", 2],
])(
  "schedules the exact Chinese count immediately with the complete vision context: %s",
  async (prompt, count) => {
    const chat = vi
      .spyOn(ai, "chat")
      .mockImplementation(async (messages) =>
        JSON.stringify(candidate(taskIndex(messages))),
      );
    const result = await generateQuiz(
      prompt,
      new AbortController().signal,
      "真实板书",
      "data:image/png;base64,actual-board",
    );
    expect(result.questions).toHaveLength(count);
    expect(chat).toHaveBeenCalledTimes(count);
    expect(chat.mock.calls[0][3]?.webSearch).toBeUndefined();
    expect(JSON.stringify(chat.mock.calls[0][0][1].content)).toContain(
      "data:image/png;base64,actual-board",
    );
  },
);

it.each(["出零道题", "出0道题", "出五十一道题", "出一百道题"])(
  "rejects invalid count before any model: %s",
  async (prompt) => {
    const chat = vi.spyOn(ai, "chat");
    await expect(
      generateQuiz(prompt, new AbortController().signal),
    ).rejects.toThrow(t("fcboard.aiMessages.quizDescribeRequest"));
    expect(chat).not.toHaveBeenCalled();
  },
);

it("starts all twelve independent questions simultaneously and publishes completion order before a stalled first task", async () => {
  const pending = new Map<number, (value: string) => void>();
  const request = new AbortController();
  let running = 0;
  let maximum = 0;
  vi.spyOn(ai, "chat").mockImplementation(async (messages, signal) => {
    const index = taskIndex(messages);
    running++;
    maximum = Math.max(maximum, running);
    try {
      return await new Promise<string>((resolve, reject) => {
        pending.set(index, resolve);
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    } finally {
      running--;
    }
  });
  const progress = vi.fn();
  const job = generateQuiz(
    "出12道题",
    request.signal,
    "",
    undefined,
    undefined,
    progress,
  );
  try {
    await waitFor(() => expect(pending.size).toBe(12));
    pending.get(1)!(JSON.stringify(candidate(1)));
    await waitFor(() =>
      expect(progress.mock.calls.at(-1)?.[0].questions[0].question).toBe(
        "独立题目 2",
      ),
    );
    expect(running).toBeLessThanOrEqual(12);
    await waitFor(() => expect(pending.has(10)).toBe(true));
    for (const [index, finish] of pending) {
      finish(JSON.stringify(candidate(index)));
    }
    await waitFor(() => expect(pending.has(11)).toBe(true));
    pending.get(11)!(JSON.stringify(candidate(11)));
    const result = await job;
    expect(result.questions).toHaveLength(12);
    expect(result.questions[0].question).toBe("独立题目 2");
    expect(maximum).toBe(12);
  } finally {
    request.abort();
    await job.catch(() => {});
  }
});

it("rejects truncated counts, duplicate questions, invalid choice keys while allowing an original quiz without invented sources", () => {
  expect(() => validateQuiz(quiz(), 10)).toThrow();
  const duplicate = quiz();
  duplicate.questions.push(duplicate.questions[0]);
  expect(() => validateQuiz(duplicate)).toThrow();
  const wrong = quiz();
  wrong.questions[0].answer = ["Z"];
  expect(() => validateQuiz(wrong)).toThrow();
  expect(validateQuiz({ ...quiz(), sources: [] }).sources).toEqual([]);
  expect(() => validateQuiz({ ...quiz(), sources: undefined })).toThrow();
});
it("creates an isolated single-card-per-question document with distinct response controls and escaped model text", () => {
  const value = quiz();
  value.title = "</script><script>alert(1)</script>";
  const html = quizDocument(value);
  const doc = new DOMParser().parseFromString(html, "text/html");
  expect(doc.querySelectorAll("article.card")).toHaveLength(3);
  expect(doc.querySelectorAll("script")).toHaveLength(1);
  expect(doc.querySelector("h1")?.textContent).toBe(value.title);
  expect(
    doc.querySelectorAll(".card")[0].querySelectorAll('input[type="radio"]'),
  ).toHaveLength(4);
  expect(
    doc.querySelectorAll(".card")[1].querySelectorAll("input,textarea,button"),
  ).toHaveLength(0);
  expect(
    doc.querySelectorAll(".card")[2].querySelectorAll(".steps li"),
  ).toHaveLength(2);
  expect(doc.querySelectorAll(".card details.answer")).toHaveLength(3);
  expect(doc.querySelectorAll(".segment")).toHaveLength(3);
  expect(
    doc
      .querySelector("meta[http-equiv='Content-Security-Policy']")
      ?.getAttribute("content"),
  ).toContain("default-src 'none'");
});

/** Execute the exact sandbox document script in its own browser window. Only
 * geometry and native scroll are supplied because jsdom has no layout engine. */
const interactiveQuiz = (value: Quiz) => {
  const html = quizDocument(value);
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const script = parsed.querySelector("script")!.textContent!;
  parsed.querySelector("script")!.remove();
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const win = iframe.contentWindow as Window & typeof globalThis;
  const doc = win.document;
  doc.open();
  doc.write(parsed.documentElement.outerHTML);
  doc.close();
  const frames: FrameRequestCallback[] = [];
  win.matchMedia = vi.fn().mockReturnValue({ matches: false });
  win.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  const deck = doc.querySelector<HTMLElement>("#deck")!;
  Object.defineProperty(deck, "clientWidth", { value: 800 });
  deck.scrollTo = (options) => {
    deck.scrollLeft = (options as ScrollToOptions).left!;
    deck.dispatchEvent(new Event("scroll"));
  };
  win.eval(script);
  const cards = [...doc.querySelectorAll<HTMLElement>(".card")];
  const flush = () =>
    frames.splice(0).forEach((callback) => callback(performance.now()));
  return { win, doc, cards, flush, close: () => iframe.remove() };
};

it("replaces pending slots progressively without resetting answers, position or the persistent ready card", () => {
  const initial: Quiz = {
    ...quiz(),
    id: "progressive",
    plannedCount: 3,
    generating: true,
    questions: [],
  };
  const view = interactiveQuiz(initial);
  const send = (
    value: Quiz,
    channel = "standalone",
    source = view.win.parent,
  ) => {
    view.win.dispatchEvent(
      new view.win.MessageEvent("message", {
        source,
        data: { type: "quiz-progress", channel, ...quizUpdate(value) },
      }),
    );
  };
  const first = { ...quiz().questions[0], id: "first" };
  const second = {
    ...quiz().questions[0],
    id: "second",
    question: "如图选择",
    image: {
      method: "draw" as const,
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
      status: "pending" as const,
    },
  };
  try {
    expect(view.doc.querySelectorAll('[role="status"]')).toHaveLength(3);
    send({ ...initial, questions: [first] }, "unrelated");
    expect(view.doc.querySelector(".choices")).toBeNull();
    send({ ...initial, questions: [first] }, "standalone", view.win);
    expect(view.doc.querySelector(".choices")).toBeNull();
    send({ ...initial, questions: [first] });
    const card = view.doc.querySelector<HTMLElement>('.card[data-id="first"]')!;
    card.querySelectorAll<HTMLInputElement>("input")[1].click();
    view.doc.querySelector<HTMLButtonElement>("#next")!.click();
    view.flush();
    expect(view.doc.querySelector("#page")!.textContent).toBe("2 / 3");
    expect(
      view.doc.querySelector('.card[data-index="1"] [role="status"]'),
    ).not.toBeNull();
    send({ ...initial, questions: [first, second] });
    expect(
      view.doc.querySelector<HTMLFieldSetElement>(
        '.card[data-id="second"] fieldset',
      )!.disabled,
    ).toBe(false);
    send({
      ...initial,
      questions: [
        first,
        {
          ...second,
          image: {
            ...second.image,
            status: "ready",
            dataURL: "data:image/png;base64,aGVsbG8=" as DataURL,
          },
        },
      ],
    });
    expect(
      view.doc
        .querySelector('.card[data-id="second"] .quiz-image img')
        ?.getAttribute("src"),
    ).toBe("data:image/png;base64,aGVsbG8=");
    expect(
      view.doc.querySelector<HTMLFieldSetElement>(
        '.card[data-id="second"] fieldset',
      )!.disabled,
    ).toBe(false);
    expect(view.doc.querySelector('.card[data-id="first"]')).toBe(card);
    expect(card.querySelectorAll<HTMLInputElement>("input")[1].checked).toBe(
      true,
    );
    expect(card.querySelector<HTMLDetailsElement>(".answer")!.open).toBe(true);
    expect(view.doc.querySelector("#page")!.textContent).toBe("2 / 3");
    const problem = card.querySelector<HTMLElement>(".problem")!;
    const solution = card.querySelector<HTMLElement>(".solution")!;
    expect(problem.contains(solution)).toBe(false);
    expect(view.win.getComputedStyle(problem).overflow).toBe("auto");
    expect(view.win.getComputedStyle(solution).overflow).toBe("auto");
  } finally {
    view.close();
  }
});

it("keeps generated questions and answers usable when a picture fails and retries only that picture", () => {
  const value: Quiz = {
    ...quiz(),
    plannedCount: 2,
    generating: false,
    errors: ["provider failed"],
    questions: [
      {
        ...quiz().questions[0],
        id: "retry",
        image: {
          method: "draw" as const,
          spec: {
            mode: "jsxgraph",
            boundingbox: [-1, 5, 5, -1],
            elements: [{ id: "A", type: "point", parents: [0, 0] }],
          },
          caption: "apple",
          status: "error",
          error: "quota exceeded",
        },
      },
    ],
  };
  const view = interactiveQuiz(value);
  const post = vi.spyOn(view.win.parent, "postMessage");
  try {
    expect(view.doc.querySelectorAll('[role="alert"]')).toHaveLength(2);
    const card = view.cards[0];
    expect(card.querySelector("h2")!.textContent).toBe(
      value.questions[0].question,
    );
    expect(card.querySelector<HTMLFieldSetElement>("fieldset")!.disabled).toBe(
      false,
    );
    card.querySelectorAll<HTMLInputElement>("input")[1].click();
    expect(card.querySelector<HTMLDetailsElement>(".answer")!.open).toBe(true);
    expect(card.querySelector(".answer-key")!.textContent).toBe("B");
    expect(card.querySelector(".solution")!.textContent).toContain(
      value.questions[0].explanation,
    );
    expect(card.querySelector(".verdict")).toHaveAttribute(
      "data-correct",
      "true",
    );
    view.doc.querySelector<HTMLButtonElement>("[data-retry-image]")!.click();
    expect(post).toHaveBeenCalledWith(
      { type: "quiz-retry-image", channel: "standalone", id: "retry" },
      "*",
    );
    expect(view.doc.querySelector(".loading")).toBeNull();
    const pending: Quiz = {
      ...value,
      questions: [
        {
          ...value.questions[0],
          image: { ...value.questions[0].image!, status: "pending" },
        },
      ],
    };
    view.win.dispatchEvent(
      new view.win.MessageEvent("message", {
        source: view.win.parent,
        data: {
          type: "quiz-progress",
          channel: "standalone",
          ...quizUpdate(pending, value),
        },
      }),
    );
    expect(view.doc.querySelector('.card[data-id="retry"]')).toBe(card);
    expect(card.querySelectorAll<HTMLInputElement>("input")[1].checked).toBe(
      true,
    );
    expect(card.querySelector<HTMLDetailsElement>(".answer")!.open).toBe(true);
    expect(card.querySelector<HTMLFieldSetElement>("fieldset")!.disabled).toBe(
      false,
    );
    expect(card.querySelector('[role="status"]')).not.toBeNull();
  } finally {
    view.close();
  }
});

it("grades single choice immediately, marks the correct option, toggles answers on repeated double-clicks and keeps answers across animated navigation", () => {
  const view = interactiveQuiz(quiz());
  try {
    const first = view.cards[0];
    first.querySelectorAll<HTMLInputElement>("input")[0].click();
    expect(first.querySelector(".verdict")?.getAttribute("data-correct")).toBe(
      "false",
    );
    expect(first.querySelector<HTMLDetailsElement>(".answer")!.open).toBe(true);
    expect(
      first.querySelector(".choice.correct")?.getAttribute("data-key"),
    ).toBe("B");
    expect(first.querySelector(".choice.wrong")?.getAttribute("data-key")).toBe(
      "A",
    );
    first.querySelectorAll<HTMLInputElement>("input")[1].click();
    expect(first.querySelector(".verdict")?.getAttribute("data-correct")).toBe(
      "true",
    );
    first.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(first.querySelector<HTMLDetailsElement>(".answer")!.open).toBe(
      false,
    );
    first.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(first.querySelector<HTMLDetailsElement>(".answer")!.open).toBe(true);
    view.doc.querySelector<HTMLButtonElement>("#next")!.click();
    view.flush();
    expect(view.doc.querySelector("#page")!.textContent).toBe("2 / 3");
    expect(
      view.doc.querySelector("#progress")!.getAttribute("aria-valuenow"),
    ).toBe("2");
    expect(view.doc.querySelectorAll(".segment.current")).toHaveLength(2);
    expect(view.cards[1].querySelector("input,textarea,button")).toBeNull();
    view.cards[1].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(
      view.cards[1].querySelector<HTMLDetailsElement>(".answer")!.open,
    ).toBe(true);
    view.doc.querySelector<HTMLButtonElement>("#prev")!.click();
    view.flush();
    expect(first.querySelectorAll<HTMLInputElement>("input")[1].checked).toBe(
      true,
    );
    expect(first.querySelector<HTMLDetailsElement>(".answer")!.open).toBe(true);
  } finally {
    view.close();
  }
});

it("checks the complete multiple-choice set after confirmation and grades true-false directly", () => {
  const value = quiz();
  value.questions[0] = {
    type: "multiple",
    question: "选择偶数",
    options: ["2", "3", "4"],
    answer: ["A", "C"],
    explanation: "2与4均为偶数",
  };
  value.questions[1] = {
    type: "true_false",
    question: "1大于2",
    answer: ["false"],
    explanation: "1小于2",
  };
  const view = interactiveQuiz(value);
  try {
    const card = view.cards[0];
    const check = card.querySelector<HTMLButtonElement>(".check")!;
    const options = card.querySelectorAll<HTMLInputElement>("input");
    expect(check.disabled).toBe(true);
    options[0].click();
    expect(check.disabled).toBe(false);
    expect(card.querySelector<HTMLDetailsElement>(".answer")!.open).toBe(false);
    check.click();
    expect(card.querySelector(".verdict")!.getAttribute("data-correct")).toBe(
      "false",
    );
    options[2].click();
    check.click();
    expect(card.querySelector(".verdict")!.getAttribute("data-correct")).toBe(
      "true",
    );
    view.cards[1].querySelectorAll<HTMLInputElement>("input")[1].click();
    expect(
      view.cards[1].querySelector(".verdict")!.getAttribute("data-correct"),
    ).toBe("true");
    expect(
      view.cards[1].querySelector<HTMLDetailsElement>(".answer")!.open,
    ).toBe(true);
  } finally {
    view.close();
  }
});

it("supports touch double-tap without reversing on a following browser double-click, and ignores a swipe", () => {
  const view = interactiveQuiz(quiz());
  try {
    const card = view.cards[2];
    const answer = card.querySelector<HTMLDetailsElement>(".answer")!;
    const pointer = (type: string, x = 100) =>
      card.dispatchEvent(
        Object.assign(new Event(type, { bubbles: true }), {
          pointerType: "touch",
          clientX: x,
          clientY: 100,
        }),
      );
    pointer("pointerdown");
    pointer("pointerup");
    pointer("pointerdown");
    pointer("pointerup");
    expect(answer.open).toBe(true);
    card.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(answer.open).toBe(true);
    pointer("pointerdown");
    pointer("pointerup");
    pointer("pointerdown");
    pointer("pointerup");
    expect(answer.open).toBe(false);
    pointer("pointerdown");
    pointer("pointerup", 200);
    pointer("pointerdown");
    pointer("pointerup", 200);
    expect(answer.open).toBe(false);
  } finally {
    view.close();
  }
});
