import { generateQuiz, gradeChoice, parseQuiz } from "./quiz";
import * as ai from "./ai";
import { defaults, saveSettings } from "./settings";

const paper = () => ({
  title: "高一数学",
  questions: [
    {
      id: "q1",
      type: "single",
      prompt: "若x=2，x²等于多少？",
      options: ["2", "4", "8", "16"],
      answer: ["4"],
      explanation: "2²=2×2=4。",
    },
  ],
  sources: [{ title: "教材资料", url: "https://example.com/course" }],
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

it("requests provider search, validates the requested question count and preserves sources", async () => {
  saveSettings(
    { ...defaults, apiKey: "test", textModel: "teaching-model" },
    false,
  );
  const chat = vi
    .spyOn(ai, "chat")
    .mockImplementation(async (_messages, _signal, _settings, options) => {
      options?.onSearch?.({ count: 1, sources: paper().sources });
      return JSON.stringify(paper());
    });
  const result = await generateQuiz(
    "出1道高一数学选择题",
    new AbortController().signal,
  );
  expect(result.sources).toEqual(paper().sources);
  expect(chat.mock.calls[0][2]?.model).toBe("teaching-model");
  expect(chat.mock.calls[0][3]).toMatchObject({ webSearch: true });
  await expect(
    generateQuiz("出10道高一数学选择题", new AbortController().signal),
  ).rejects.toThrow("实际返回1题");
});

it("refuses missing sources, inconsistent choices, duplicate ids and incomplete papers", () => {
  expect(() => parseQuiz({ ...paper(), sources: [] })).toThrow();
  expect(() =>
    parseQuiz({
      ...paper(),
      questions: [{ ...paper().questions[0], answer: ["absent"] }],
    }),
  ).toThrow();
  expect(() =>
    parseQuiz({
      ...paper(),
      questions: [paper().questions[0], paper().questions[0]],
    }),
  ).toThrow();
  expect(() => parseQuiz({ ...paper(), questions: [] })).toThrow();
  expect(() =>
    parseQuiz({
      ...paper(),
      sources: [{ title: "invalid", url: "data:text/html,invalid" }],
    }),
  ).toThrow();
});

it("grades multiple choice as a complete set and leaves subjective answers for review", () => {
  const question = {
    ...parseQuiz(paper()).questions[0],
    type: "multiple" as const,
    options: ["A", "B", "C"],
    answer: ["A", "C"],
  };
  expect(gradeChoice(question, ["C", "A"])).toBe(true);
  expect(gradeChoice(question, ["A"])).toBe(false);
  expect(gradeChoice({ ...question, type: "analysis" }, ["A"])).toBeUndefined();
});
