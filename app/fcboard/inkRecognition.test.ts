import * as i18n from "@fcboard/fcboard/i18n";

import * as ai from "./ai";
import {
  calculationAnswerText,
  recognizeInkContent,
  inkRecognitionDelay,
  settleInkRecognition,
} from "./inkRecognition";
import { defaults, saveSettings } from "./settings";
import { languageStudy } from "./test/language";
import * as ocr from "./ocr";
import * as localTranslation from "./localTranslation";
import * as computation from "./mathComputation";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

it("reuses the locally verified candidate result instead of calculating complex LaTeX twice", async () => {
  const latex = String.raw`\sin(30^\circ)`;
  const calculate = vi
    .spyOn(computation, "calculateAsync")
    .mockResolvedValue("1/2");
  vi.spyOn(ocr, "recognizeHandwriting").mockImplementation(
    async (_capture, _signal, _progress, _kind, accept) => {
      expect(await accept!(latex)).toBe(true);
      return latex;
    },
  );
  const result = await recognizeInkContent(
    "calculation",
    vi.fn(),
    [],
    new AbortController().signal,
  );
  expect(result).toMatchObject({
    kind: "calculation",
    expression: latex,
    answer: "1/2",
  });
  expect(calculate).toHaveBeenCalledTimes(1);
});

it("keeps local OCR and translation available without an AI key", async () => {
  saveSettings({ ...defaults, apiKey: "", ocr: "local" }, false);
  const model = vi.spyOn(ai, "chat");
  const recognize = vi
    .spyOn(ocr, "recognizeHandwriting")
    .mockResolvedValue("hello");
  const translate = vi
    .spyOn(localTranslation, "translateLocally")
    .mockResolvedValue({ language: "en", translation: "你好" });
  const result = await recognizeInkContent(
    "language",
    vi.fn(),
    [
      [
        [20, 20],
        [40, 30],
      ],
    ],
    new AbortController().signal,
  );
  expect(result).toMatchObject({
    kind: "language",
    text: "hello",
    study: { backend: "local", translation: "你好", grammar: "", examples: [] },
  });
  expect(recognize).toHaveBeenCalledTimes(1);
  expect(translate).toHaveBeenCalledTimes(1);
  expect(model).not.toHaveBeenCalled();
});

it("sends cloud language ink directly as one cropped image request without OCR", async () => {
  saveSettings(
    {
      ...defaults,
      apiKey: "configured",
      ocr: "local",
      translationProvider: "cloud",
    },
    false,
  );
  const study = { ...languageStudy, term: "Bonjour", language: "fr" };
  const recognize = vi
    .spyOn(ocr, "recognizeHandwriting")
    .mockResolvedValue("Bonjour");
  const model = vi.spyOn(ai, "chat").mockResolvedValue(study.translation);
  const result = await recognizeInkContent(
    "language",
    async () => "data:image/png;base64,word",
    [
      [
        [0, 0],
        [30, 40],
      ],
    ],
    new AbortController().signal,
  );
  expect(result).toMatchObject({
    kind: "language",
    translation: study.translation,
  });
  expect(recognize).not.toHaveBeenCalled();
  expect(model).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(model.mock.calls[0][0])).toContain(
    "data:image/png;base64,word",
  );
});

it("keeps local language recognition independent of cloud OCR and forwards text immediately", async () => {
  saveSettings(
    {
      ...defaults,
      apiKey: "configured",
      ocr: "cloud",
      translationProvider: "local",
      inkLanguage: "es-ES",
    },
    false,
  );
  const recognize = vi
    .spyOn(ocr, "recognizeHandwriting")
    .mockResolvedValue("Buenos días");
  const capture = vi.fn();
  const translate = vi
    .spyOn(localTranslation, "translateLocally")
    .mockResolvedValue({ language: "es", translation: "早上好" });
  await recognizeInkContent(
    "language",
    capture,
    [
      [
        [0, 0],
        [20, 20],
      ],
    ],
    new AbortController().signal,
  );
  expect(recognize.mock.calls[0][8]).toBe(true);
  expect(capture).not.toHaveBeenCalled();
  expect(translate.mock.calls[0][0]).toBe("Buenos días");
});

it("never starts local OCR or translation after a failed cloud image request", async () => {
  saveSettings(
    { ...defaults, apiKey: "configured", translationProvider: "cloud" },
    false,
  );
  vi.spyOn(ai, "chat").mockRejectedValue(new Error("vision unavailable"));
  const recognize = vi.spyOn(ocr, "recognizeHandwriting");
  const translate = vi.spyOn(localTranslation, "translateLocally");
  await expect(
    recognizeInkContent(
      "language",
      async () => "data:image/png;base64,word",
      [],
      new AbortController().signal,
    ),
  ).rejects.toThrow("vision unavailable");
  expect(recognize).not.toHaveBeenCalled();
  expect(translate).not.toHaveBeenCalled();
});

it("never silently starts local recognition when cloud translation has no key", async () => {
  saveSettings(
    { ...defaults, translationProvider: "cloud", apiKey: "" },
    false,
  );
  const recognize = vi.spyOn(ocr, "recognizeHandwriting");
  const capture = vi.fn();
  await expect(
    recognizeInkContent("language", capture, [], new AbortController().signal),
  ).rejects.toThrow();
  expect(recognize).not.toHaveBeenCalled();
  expect(capture).not.toHaveBeenCalled();
});
it("discards local language output if the selected handwriting language changes while translating", async () => {
  saveSettings(
    { ...defaults, translationProvider: "local", inkLanguage: "en-US" },
    false,
  );
  vi.spyOn(ocr, "recognizeHandwriting").mockResolvedValue("hello");
  vi.spyOn(localTranslation, "translateLocally").mockImplementation(
    async () => {
      saveSettings(
        { ...defaults, translationProvider: "local", inkLanguage: "es-ES" },
        false,
      );
      return { language: "en", translation: "你好" };
    },
  );
  await expect(
    recognizeInkContent("language", vi.fn(), [], new AbortController().signal),
  ).rejects.toMatchObject({ name: "AbortError" });
});

it.each([
  ["zh-CN", "en", "It is sunny today.", "今天是晴天。", "zh-CN"],
  ["en", "zh", "今天是晴天。", "It is sunny today.", "en"],
  ["es-ES", "en", "It is sunny today.", "Hoy hace sol.", "es-ES"],
  ["es-ES", "zh", "今天是晴天。", "Hoy hace sol.", "es-ES"],
])(
  "translates multilingual handwriting into UI target %s in one cloud image call",
  async (code, _language, _term, translation, targetLanguage) => {
    vi.spyOn(i18n, "getLanguage").mockReturnValue({
      ...i18n.getLanguage(),
      code,
    });
    saveSettings(
      { ...defaults, apiKey: "configured", translationProvider: "cloud" },
      false,
    );
    const recognize = vi.spyOn(ocr, "recognizeHandwriting");
    const model = vi.spyOn(ai, "chat").mockResolvedValue(translation);
    const result = await recognizeInkContent(
      "language",
      async () => "data:image/png;base64,sentence",
      [],
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      kind: "language",
      targetLanguage,
      translation,
    });
    expect(model).toHaveBeenCalledTimes(1);
    expect(recognize).not.toHaveBeenCalled();
    expect(model.mock.calls[0][0][1].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining(`"targetLanguage":"${targetLanguage}"`),
        }),
      ]),
    );
  },
);

it("passes handwritten LaTeX to the existing plot parser without a local OCR candidate", async () => {
  saveSettings(
    { ...defaults, mathTranscription: "cloud", apiKey: "configured" },
    false,
  );
  const recognize = vi.spyOn(ocr, "recognizeHandwriting");
  const model = vi
    .spyOn(ai, "chat")
    .mockResolvedValue(String.raw`y=\frac{x^2}{2}`);
  const result = await recognizeInkContent(
    "function",
    async () => "data:image/png;base64,function",
    [],
    new AbortController().signal,
  );
  expect(result).toMatchObject({
    kind: "function",
    plot: { expression: "((x^2)/(2))" },
  });
  expect(recognize).not.toHaveBeenCalled();
  expect(JSON.stringify(model.mock.calls[0][0])).toContain(
    "data:image/png;base64,function",
  );
});

it.each([
  [
    [
      [
        [0, 0],
        [0, 30],
      ],
      [
        [12, 15],
        [24, 15],
      ],
      [
        [18, 9],
        [18, 21],
      ],
      [
        [35, 0],
        [35, 30],
      ],
      [
        [46, 10],
        [62, 10],
      ],
      [
        [46, 18],
        [62, 18],
      ],
    ],
    undefined,
  ],
  [
    [
      [
        [22, 0],
        [22, 19],
      ],
      [
        [22, 28],
        [22, 47],
      ],
      [
        [1, 37],
        [12, 37],
      ],
      [
        [7, 31],
        [7, 43],
      ],
      [
        [1, 52],
        [34, 52],
      ],
    ],
    { mode: "column", lines: 2 },
  ],
] as const)(
  "places the cloud answer at the written completion mark",
  async (strokes, layout) => {
    saveSettings(
      { ...defaults, mathTranscription: "cloud", apiKey: "configured" },
      false,
    );
    const recognize = vi.spyOn(ocr, "recognizeHandwriting");
    const calculate = vi.spyOn(computation, "calculateAsync");
    vi.spyOn(ai, "chat").mockResolvedValue("2");
    const result = await recognizeInkContent(
      "calculation",
      async () => "data:image/png;base64,calculation",
      strokes.map((stroke) => stroke.map(([x, y]) => [x, y])),
      new AbortController().signal,
    );
    if (result.kind !== "calculation") {
      throw new Error("Expected a calculation");
    }
    expect(result.layout).toEqual(layout);
    expect(calculationAnswerText(result)).toBe("2");
    expect(recognize).not.toHaveBeenCalled();
    expect(calculate).not.toHaveBeenCalled();
  },
);

it.each(["The answer is 2.", "1+1=2", "∅"])(
  "rejects a cloud calculation response without a standalone result (%s)",
  async (response) => {
    saveSettings(
      { ...defaults, mathTranscription: "cloud", apiKey: "configured" },
      false,
    );
    vi.spyOn(ai, "chat").mockResolvedValue(response);
    await expect(
      recognizeInkContent(
        "calculation",
        async () => "data:image/png;base64,calculation",
        [],
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  },
);

it("starts all three pens promptly and overlaps local math inference with the completion pause", async () => {
  saveSettings(
    { ...defaults, mathTranscription: "cloud", translationProvider: "cloud" },
    false,
  );
  expect(inkRecognitionDelay("function", [])).toBe(250);
  expect(inkRecognitionDelay("calculation", [])).toBe(250);
  expect(inkRecognitionDelay("language", [])).toBe(250);
  const timer = vi.spyOn(globalThis, "setTimeout");
  await settleInkRecognition(
    "function",
    Date.now() - 250,
    new AbortController().signal,
  );
  expect(timer).not.toHaveBeenCalled();
  saveSettings(
    { ...defaults, mathTranscription: "local", translationProvider: "local" },
    false,
  );
  expect(inkRecognitionDelay("function", [])).toBe(350);
  expect(inkRecognitionDelay("calculation", [])).toBe(350);
  expect(inkRecognitionDelay("language", [])).toBe(350);
  vi.useFakeTimers();
  try {
    const commit = vi.fn();
    const complete = settleInkRecognition(
      "function",
      Date.now() - 350,
      new AbortController().signal,
    ).then(commit);
    await vi.advanceTimersByTimeAsync(349);
    expect(commit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await complete;
    expect(commit).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it.each(["calculation", "function"] as const)(
  "uses exactly one fast cloud %s request with no OCR or AI review",
  async (mode) => {
    saveSettings(
      { ...defaults, apiKey: "configured", mathTranscription: "cloud" },
      false,
    );
    const model = vi
      .spyOn(ai, "chat")
      .mockResolvedValue(mode === "function" ? "y=x" : "2");
    const ocrCall = vi.spyOn(ocr, "recognizeHandwriting");
    await recognizeInkContent(
      mode,
      async () => "data:image/png;base64,ink",
      [],
      new AbortController().signal,
    );
    expect(model).toHaveBeenCalledTimes(1);
    expect(model.mock.calls[0][3]).toMatchObject({
      quickVision: true,
      useVisionModel: true,
    });
    expect(ocrCall).not.toHaveBeenCalled();
  },
);
