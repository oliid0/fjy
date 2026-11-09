import * as ai from "./ai";
import { recognizeInkContent } from "./inkRecognition";
import { defaults, saveSettings } from "./settings";
import { languageStudy } from "./test/language";
import * as ocr from "./ocr";
import * as localTranslation from "./localTranslation";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
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

it("uses explicit cloud translation after independent local OCR without a competing vision request", async () => {
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
    vi.fn(),
    [
      [
        [0, 0],
        [30, 40],
      ],
    ],
    new AbortController().signal,
  );
  expect(result).toMatchObject({ kind: "language", text: "Bonjour", study });
  expect(recognize).toHaveBeenCalledTimes(1);
  expect(model).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(model.mock.calls[0][0])).toContain("Bonjour");
});
it.each(["text", "drawing"])(
  "routes magic %s ink to the requested generation style",
  async (kind) => {
    saveSettings(
      {
        ...defaults,
        apiKey: "test",
        model: "vision",
        imageModel: defaults.imageModel,
      },
      false,
    );
    vi.spyOn(ai, "chat").mockResolvedValue(
      JSON.stringify({ version: 1, kind, text: "一个二次元女孩" }),
    );
    const image = "data:image/png;base64,example";
    const result = await recognizeInkContent(
      "magic",
      async () => image,
      [],
      new AbortController().signal,
    );
    expect(result.kind).toBe("magic");
    if (result.kind !== "magic") {
      throw new Error("Expected magic result");
    }
    expect(result.transparent).toBe(true);
    if (kind === "text") {
      expect(result.image).toBeUndefined();
      expect(result.prompt).toContain("一个二次元女孩");
      expect(result.prompt).not.toContain("铅笔素描");
    } else {
      expect(result.image).toBe(image);
      expect(result.prompt).toContain("参考草图");
    }
  },
);

it("preserves explicit transparency instructions while always requesting subject layers", async () => {
  saveSettings({ ...defaults, apiKey: "test" }, false);
  vi.spyOn(ai, "chat").mockResolvedValue(
    JSON.stringify({
      version: 1,
      kind: "text",
      text: "一个二次元女孩，透明背景",
    }),
  );
  const result = await recognizeInkContent(
    "magic",
    async () => "data:image/png;base64,example",
    [],
    new AbortController().signal,
  );
  expect(result).toMatchObject({ kind: "magic", transparent: true });
  if (result.kind === "magic") {
    expect(result.image).toBeUndefined();
    expect(result.prompt).toContain("一个二次元女孩，透明背景");
  }
});

it.each(["text", "drawing"])(
  "continues magic %s generation on a custom model without unsupported decomposition options",
  async (kind) => {
    saveSettings(
      { ...defaults, apiKey: "test", imageModel: "custom-illustrator" },
      false,
    );
    vi.spyOn(ai, "chat").mockResolvedValue(
      JSON.stringify({
        version: 1,
        kind,
        text: "一个二次元女孩",
        transparent: true,
      }),
    );
    const image = "data:image/png;base64,ink";
    const result = await recognizeInkContent(
      "magic",
      async () => image,
      [],
      new AbortController().signal,
    );
    expect(result).toMatchObject({ kind: "magic", transparent: false });
    if (result.kind !== "magic") {
      throw new Error("Expected magic intent");
    }
    expect(result.image).toBe(kind === "drawing" ? image : undefined);
    expect(result.prompt).not.toContain("透明图层");
  },
);
