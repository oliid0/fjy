import * as ai from "./ai";
import { recognizeInkContent } from "./inkRecognition";
import { defaults, saveSettings } from "./settings";
import { languageStudy } from "./test/language";
import * as ocr from "./ocr";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

it("sends original handwriting directly to vision for transcription and translation in one model request", async () => {
  saveSettings(
    { ...defaults, apiKey: "configured", ocrModel: "vision" },
    false,
  );
  const model = vi
    .spyOn(ai, "chat")
    .mockResolvedValue(JSON.stringify(languageStudy));
  const recognize = vi.spyOn(ocr, "recognizeHandwriting");
  const image = "data:image/png;base64,handwriting";
  const result = await recognizeInkContent(
    "language",
    async () => image,
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
    text: languageStudy.term,
    study: languageStudy,
  });
  expect(model).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(model.mock.calls[0][0])).toContain(image);
  expect(recognize).not.toHaveBeenCalled();
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
  "does not request unsupported transparent layers for a custom image model with %s ink",
  async (kind) => {
    saveSettings(
      { ...defaults, apiKey: "test", imageModel: "custom-illustrator" },
      false,
    );
    vi.spyOn(ai, "chat").mockResolvedValue(
      JSON.stringify({
        version: 1,
        kind,
        text: "牛顿第一定律演示",
        transparent: false,
      }),
    );
    const result = await recognizeInkContent(
      "magic",
      async () => "data:image/png;base64,ink",
      [],
      new AbortController().signal,
    );
    expect(result).toMatchObject({ kind: "magic", transparent: false });
    if (result.kind !== "magic") {
      throw new Error("Expected magic intent");
    }
    expect(result.prompt).not.toContain("透明图层");
    if (kind === "text") {
      expect(result.prompt).toContain("牛顿第一定律演示");
    }
  },
);

it.each([
  { text: "一个女孩，透明背景" },
  { text: "Un chat sans arrière-plan", transparent: true },
])(
  "rejects an explicit transparent request without confirmed model support: %j",
  async (intent) => {
    saveSettings(
      { ...defaults, apiKey: "test", imageModel: "custom-illustrator" },
      false,
    );
    vi.spyOn(ai, "chat").mockResolvedValue(
      JSON.stringify({ version: 1, kind: "text", ...intent }),
    );
    await expect(
      recognizeInkContent(
        "magic",
        async () => "data:image/png;base64,ink",
        [],
        new AbortController().signal,
      ),
    ).rejects.toThrow("Seedream 5.0");
  },
);
