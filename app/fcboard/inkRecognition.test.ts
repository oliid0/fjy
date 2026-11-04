import * as ai from "./ai";
import { recognizeInkContent } from "./inkRecognition";
import { defaults, saveSettings } from "./settings";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});
it.each(["text", "drawing"])(
  "routes magic %s ink to the requested generation style",
  async (kind) => {
    saveSettings(
      {
        ...defaults,
        apiKey: "test",
        model: "vision",
        imageModel: "illustrator",
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
  saveSettings(
    { ...defaults, apiKey: "test", imageModel: "illustrator" },
    false,
  );
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
