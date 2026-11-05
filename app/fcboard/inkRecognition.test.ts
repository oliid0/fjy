import * as ai from "./ai";
import { recognizeInkContent } from "./inkRecognition";
import { defaults, saveSettings } from "./settings";
import { languageStudy } from "./test/language";
import * as ocr from "./ocr";
import * as localOcr from "./localOcr";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

it("starts direct vision without waiting for unavailable local recognition", async () => {
  saveSettings(
    { ...defaults, apiKey: "configured", ocrModel: "vision" },
    false,
  );
  const model = vi
    .spyOn(ai, "chat")
    .mockResolvedValue(JSON.stringify(languageStudy));
  const recognize = vi.spyOn(ocr, "recognizeHandwriting");
  vi.spyOn(localOcr, "recognizeLocalHandwriting").mockRejectedValue(
    new Error("local unavailable"),
  );
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

it("races local text plus its original image against direct vision and cancels the slower result", async () => {
  saveSettings(
    { ...defaults, apiKey: "configured", ocrModel: "vision" },
    false,
  );
  const capture = vi.fn().mockResolvedValue("data:image/png;base64,french");
  vi.spyOn(localOcr, "recognizeLocalHandwriting").mockResolvedValue("Bonjour");
  let directSignal: AbortSignal | undefined;
  const study = { ...languageStudy, term: "Bonjour", language: "fr" };
  const model = vi
    .spyOn(ai, "chat")
    .mockImplementation(async (messages, signal) => {
      if (JSON.stringify(messages).includes('\\"selection\\":\\"Bonjour\\"')) {
        return JSON.stringify(study);
      }
      directSignal = signal;
      return new Promise(() => {});
    });
  const result = await recognizeInkContent(
    "language",
    capture,
    [
      [
        [0, 0],
        [30, 40],
      ],
    ],
    new AbortController().signal,
  );
  expect(result).toMatchObject({ kind: "language", text: "Bonjour", study });
  expect(capture).toHaveBeenCalledTimes(1);
  expect(model).toHaveBeenCalledTimes(2);
  expect(
    model.mock.calls.every(([messages]) =>
      JSON.stringify(messages).includes("data:image/png;base64,french"),
    ),
  ).toBe(true);
  expect(directSignal?.aborted).toBe(true);
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

it("preserves magic ink and fails before vision or generation when transparent layers are unsupported", async () => {
  saveSettings(
    { ...defaults, apiKey: "test", imageModel: "custom-illustrator" },
    false,
  );
  const model = vi.spyOn(ai, "chat");
  const capture = vi.fn();
  await expect(
    recognizeInkContent("magic", capture, [], new AbortController().signal),
  ).rejects.toThrow("Seedream 5.0");
  expect(model).not.toHaveBeenCalled();
  expect(capture).not.toHaveBeenCalled();
});

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
