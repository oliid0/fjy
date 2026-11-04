import { generateQuiz, quizDocument, validateQuiz } from "./quiz";
import { defaults, saveSettings } from "./settings";
import * as ai from "./ai";

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
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});
it("researches online before generating the exact requested batch and retries invalid question data", async () => {
  saveSettings(
    { ...defaults, apiKey: "test", textModel: "chosen-model" },
    false,
  );
  const invalid = quiz();
  invalid.questions[0].answer = ["H"];
  const chat = vi
    .spyOn(ai, "chat")
    .mockResolvedValueOnce("已检索教材知识：https://www.moe.gov.cn/")
    .mockResolvedValueOnce(JSON.stringify(invalid))
    .mockResolvedValueOnce(JSON.stringify(quiz()));
  const result = await generateQuiz("出3道题", new AbortController().signal);
  expect(result.questions).toHaveLength(3);
  expect(chat.mock.calls[0][3]).toMatchObject({ webSearch: true });
  expect(chat.mock.calls[1][2]).toMatchObject({ model: "chosen-model" });
  expect(chat.mock.calls[2][0].at(-1)?.content).toContain("选择题");
});
it("rejects truncated counts, duplicate questions, invalid choice keys and missing sources", () => {
  expect(() => validateQuiz(quiz(), 10)).toThrow();
  const duplicate = quiz();
  duplicate.questions.push(duplicate.questions[0]);
  expect(() => validateQuiz(duplicate)).toThrow();
  const wrong = quiz();
  wrong.questions[0].answer = ["Z"];
  expect(() => validateQuiz(wrong)).toThrow();
  expect(() => validateQuiz({ ...quiz(), sources: [] })).toThrow();
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
