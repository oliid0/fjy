import { recognizeHandwriting } from "./ocr";
import { defaults, saveSettings } from "./settings";

const backend = vi.hoisted(() => ({ cloud: vi.fn(), local: vi.fn() }));
vi.mock("./ai", () => ({
  chat: backend.cloud,
  visualMessage: (text: string, image: string) => ({
    role: "user",
    content: [text, image],
  }),
}));
vi.mock("./localOcr", () => ({
  recognizeLocalHandwriting: backend.local,
  warmHandwriting: vi.fn(),
}));

describe("explicit handwriting actions", () => {
  beforeEach(() => {
    backend.cloud.mockReset();
    backend.local.mockReset();
    saveSettings({ ...defaults, apiKey: "test-key" }, false);
  });
  afterEach(() => vi.useRealTimers());
  it("starts specialized cloud OCR and local OCR together, with bounded output", async () => {
    backend.cloud.mockResolvedValue("1+1=");
    backend.local.mockResolvedValue("1+1=");
    const result = await recognizeHandwriting(
      "selection",
      new AbortController().signal,
      vi.fn(),
      "math",
    );
    expect(result).toBe("1+1=");
    expect(backend.cloud).toHaveBeenCalledTimes(1);
    expect(backend.local).toHaveBeenCalledTimes(1);
    expect(backend.cloud.mock.calls[0][3]).toEqual({
      maxTokens: 256,
      timeoutMs: 6000,
    });
  });
  it("silently uses local recognition when cloud errors instead of asking for another selection", async () => {
    backend.cloud.mockRejectedValue(new Error("network"));
    backend.local.mockResolvedValue("1+1=");
    expect(
      await recognizeHandwriting(
        "selection",
        new AbortController().signal,
        vi.fn(),
        "math",
      ),
    ).toBe("1+1=");
  });
  it("does not let an unparseable local result beat valid cloud math", async () => {
    backend.local.mockResolvedValue("illegible");
    backend.cloud.mockResolvedValue("1+1=");
    expect(
      await recognizeHandwriting(
        "selection",
        new AbortController().signal,
        vi.fn(),
        "math",
        (text) => text === "1+1=",
      ),
    ).toBe("1+1=");
  });
  it("uses only local OCR without a key or in explicit offline mode", async () => {
    saveSettings({ ...defaults, apiKey: "" }, false);
    backend.local.mockResolvedValue("1+1=");
    await recognizeHandwriting(
      "selection",
      new AbortController().signal,
      vi.fn(),
    );
    expect(backend.cloud).not.toHaveBeenCalled();
  });
});
