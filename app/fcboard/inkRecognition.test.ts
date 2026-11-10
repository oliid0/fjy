import * as ai from "./ai";
import { recognizeInkContent } from "./inkRecognition";
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
  const model = vi.spyOn(ai, "chat").mockResolvedValue(JSON.stringify(study));
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
    text: "Bonjour",
    study: {
      term: "Bonjour",
      translation: study.translation,
      backend: "translation",
    },
  });
  expect(recognize).not.toHaveBeenCalled();
  expect(model).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(model.mock.calls[0][0])).toContain(
    "data:image/png;base64,word",
  );
});
it.each([defaults.imageModel, "custom-illustrator"])(
  "passes the original magic PNG directly to image model %s without OCR or a planning API",
  async (imageModel) => {
    saveSettings({ ...defaults, apiKey: "test", imageModel }, false);
    const chat = vi.spyOn(ai, "chat");
    const ocrRead = vi.spyOn(ocr, "recognizeHandwriting");
    const capture = vi.fn().mockResolvedValue("data:image/png;base64,source");
    const result = await recognizeInkContent(
      "magic",
      capture,
      [],
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      kind: "magic",
      image: "data:image/png;base64,source",
      transparent: true,
    });
    if (result.kind !== "magic") {
      throw new Error("Expected magic screenshot");
    }
    expect(result.prompt).toContain("若没有文字要求，仅按图生图");
    expect(result.prompt).toContain("结合图中的草图一同创作");
    expect(result.prompt).toContain("Alpha透明通道的PNG");
    expect(capture).toHaveBeenCalledTimes(1);
    expect(chat).not.toHaveBeenCalled();
    expect(ocrRead).not.toHaveBeenCalled();
  },
);

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
