import { translateLocally } from "./localTranslation";
import { offlineInference } from "./offlineInference";
vi.mock("./offlineInference", () => ({ offlineInference: vi.fn() }));
afterEach(() => vi.clearAllMocks());
it("uses only the local English/Chinese model with no API settings", async () => {
  vi.mocked(offlineInference).mockResolvedValue([
    { translation_text: "你好世界" },
  ]);
  expect(
    await translateLocally(
      "Hello world",
      "zh-CN",
      new AbortController().signal,
    ),
  ).toEqual({ language: "en", translation: "你好世界" });
  expect(offlineInference).toHaveBeenCalledWith(
    { kind: "translation", text: "Hello world", source: "en", target: "zh" },
    expect.any(AbortSignal),
  );
});
it("preserves all text while bounding long inputs into sequential chunks", async () => {
  vi.mocked(offlineInference).mockResolvedValue([
    { translation_text: "translated" },
  ]);
  const text = "你好，世界。".repeat(50);
  await translateLocally(text, "en-US", new AbortController().signal);
  expect(
    vi
      .mocked(offlineInference)
      .mock.calls.map(([task]) =>
        task.kind === "translation" ? task.text : "",
      )
      .join(""),
  ).toBe(text);
  expect(
    vi
      .mocked(offlineInference)
      .mock.calls.every(
        ([task]) => task.kind === "translation" && task.text.length <= 81,
      ),
  ).toBe(true);
});
it("reports missing language pairs and aborts without a remote fallback", async () => {
  await expect(
    translateLocally("hello", "ja", new AbortController().signal),
  ).rejects.toThrow();
  const controller = new AbortController();
  controller.abort();
  await expect(
    translateLocally("hello", "zh", controller.signal),
  ).rejects.toThrow();
  expect(offlineInference).not.toHaveBeenCalled();
});
