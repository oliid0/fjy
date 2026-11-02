import * as ai from "./ai";
import { recognizeInkContent } from "./inkRecognition";
import { defaults, saveSettings } from "./settings";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});
it("uses vision only for ambiguous ink and rejects unsupported visual guesses", async () => {
  const provider = vi
    .spyOn(ai, "chat")
    .mockResolvedValueOnce('{"shape":"star"}')
    .mockResolvedValueOnce('{"shape":"octagon"}');
  const capture = vi.fn().mockResolvedValue("data:image/png;base64,ambiguous");
  const signal = new AbortController().signal;
  expect(await recognizeInkContent("shape", capture, [], signal)).toEqual({
    kind: "shape",
    shape: "star",
  });
  expect(provider.mock.calls[0][0][0].content).toEqual(
    expect.arrayContaining([
      {
        type: "image_url",
        image_url: { url: "data:image/png;base64,ambiguous" },
      },
    ]),
  );
  expect(provider.mock.calls[0][3]).toMatchObject({
    maxTokens: 512,
    timeoutMs: 12000,
  });
  await expect(
    recognizeInkContent("shape", capture, [], signal),
  ).rejects.toThrow("No recognized ink object");
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
      JSON.stringify({ version: 1, kind, text: "一个漂亮的女孩" }),
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
    expect(result.prompt).toContain("透明背景");
    if (kind === "text") {
      expect(result.image).toBeUndefined();
      expect(result.prompt).toContain("铅笔素描");
      expect(result.prompt).toContain("一个漂亮的女孩");
    } else {
      expect(result.image).toBe(image);
      expect(result.prompt).toContain("3D");
    }
  },
);
