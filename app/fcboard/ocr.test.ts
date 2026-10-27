import { recognizeHandwriting } from "./ocr";
import { defaults, saveSettings } from "./settings";

const backend = vi.hoisted(() => ({
  cloud: vi.fn(),
  local: vi.fn(),
  native: vi.fn(),
  nativeAvailable: false,
}));
vi.mock("./digitalInk", () => ({
  hasDigitalInk: () => backend.nativeAvailable,
  recognizeDigitalInk: backend.native,
  prepareDigitalInk: vi.fn(),
}));
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
    backend.native.mockReset();
    backend.nativeAvailable = false;
    saveSettings({ ...defaults, apiKey: "test-key" }, false);
  });
  afterEach(() => vi.useRealTimers());
  it("passes the alphabet surface's English context to bundled Digital Ink without rasterizing", async () => {
    backend.nativeAvailable = true;
    backend.native.mockResolvedValue(["Hello"]);
    saveSettings(
      { ...defaults, ocr: "local", inkLanguage: "zh-Hani-CN" },
      false,
    );
    const capture = vi.fn();
    const strokes: import("./digitalInk").InkInput = [
      [
        [10, 20],
        [30, 40],
      ],
    ];
    expect(
      await recognizeHandwriting(
        capture,
        new AbortController().signal,
        vi.fn(),
        "text",
        undefined,
        strokes,
        "en-US",
      ),
    ).toBe("Hello");
    expect(backend.native.mock.calls[0][3]).toBe("en-US");
    expect(capture).not.toHaveBeenCalled();
    expect(backend.cloud).not.toHaveBeenCalled();
  });
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
  it("uses real native strokes before any screenshot, raster model or cloud request", async () => {
    backend.nativeAvailable = true;
    backend.native.mockResolvedValue(["1+1=", "illegible"]);
    const capture = vi.fn();
    const strokes: [number, number][][] = [
      [
        [10, 10],
        [10, 40],
      ],
    ];
    expect(
      await recognizeHandwriting(
        capture,
        new AbortController().signal,
        vi.fn(),
        "math",
        (text) => text === "1+1=",
        strokes,
      ),
    ).toBe("1+1=");
    expect(backend.native.mock.calls[0][0]).toBe(strokes);
    expect(capture).not.toHaveBeenCalled();
    expect(backend.local).not.toHaveBeenCalled();
    expect(backend.cloud).not.toHaveBeenCalled();
  });
  it("passes actual ranked native alternatives to the writing surface and waits for its choice", async () => {
    backend.nativeAvailable = true;
    backend.native.mockResolvedValue(["你好", "你号"]);
    const choose = vi.fn().mockResolvedValue("你号");
    const capture = vi.fn();
    expect(
      await recognizeHandwriting(
        capture,
        new AbortController().signal,
        vi.fn(),
        "text",
        undefined,
        [
          [
            [0, 0],
            [10, 20],
          ],
        ],
        undefined,
        choose,
      ),
    ).toBe("你号");
    expect(choose).toHaveBeenCalledWith(["你好", "你号"]);
    expect(capture).not.toHaveBeenCalled();
  });
  it("reports an unavailable offline model without disguising a cloud response as local", async () => {
    backend.nativeAvailable = true;
    backend.native.mockRejectedValue(new Error("model not registered"));
    saveSettings({ ...defaults, ocr: "local", apiKey: "test" }, false);
    await expect(
      recognizeHandwriting(
        "image",
        new AbortController().signal,
        vi.fn(),
        "text",
        undefined,
        [[[0, 0]]],
      ),
    ).rejects.toThrow("model not registered");
    expect(backend.cloud).not.toHaveBeenCalled();
    expect(backend.local).not.toHaveBeenCalled();
  });
  it("does not choose a lower ranked candidate just because it produces an answer", async () => {
    backend.nativeAvailable = true;
    backend.native.mockResolvedValue(["illegible", "1+1="]);
    saveSettings({ ...defaults, ocr: "local" }, false);
    await expect(
      recognizeHandwriting(
        "image",
        new AbortController().signal,
        vi.fn(),
        "math",
        (text) => text === "1+1=",
        [[[0, 0]]],
      ),
    ).rejects.toThrow();
    expect(backend.cloud).not.toHaveBeenCalled();
  });
});
