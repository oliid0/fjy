import { recognizeHandwriting } from "./ocr";
import { defaults, saveSettings } from "./settings";

const backend = vi.hoisted(() => ({
  cloud: vi.fn(),
  local: vi.fn(),
  native: vi.fn(),
  math: vi.fn(),
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
vi.mock("./localMathOcr", () => ({ recognizeLocalMath: backend.math }));
vi.mock("./localOcr", () => ({
  recognizeLocalHandwriting: backend.local,
  warmHandwriting: vi.fn(),
}));

describe("explicit handwriting actions", () => {
  beforeEach(() => {
    backend.cloud.mockReset();
    backend.local.mockReset();
    backend.native.mockReset();
    backend.math
      .mockReset()
      .mockRejectedValue(new Error("Math model unavailable"));
    backend.nativeAvailable = false;
    saveSettings({ ...defaults, apiKey: "test-key" }, false);
  });
  afterEach(() => vi.useRealTimers());
  it("prefers structural math over a plausible flattened native answer", async () => {
    backend.nativeAvailable = true;
    backend.native.mockResolvedValue(["12"]);
    backend.math.mockResolvedValue(String.raw`\frac{1}{2}`);
    const capture = vi.fn();
    const strokes: import("./digitalInk").InkInput = [
      [
        [20, 10],
        [35, 35],
      ],
      [
        [10, 45],
        [55, 45],
      ],
      [
        [20, 55],
        [35, 80],
      ],
    ];
    const validate = vi.fn(
      async (text: string) => text === String.raw`\frac{1}{2}`,
    );
    expect(
      await recognizeHandwriting(
        capture,
        new AbortController().signal,
        vi.fn(),
        "math",
        validate,
        strokes,
      ),
    ).toBe(String.raw`\frac{1}{2}`);
    expect(backend.native).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(backend.local).not.toHaveBeenCalled();
    expect(backend.cloud).not.toHaveBeenCalled();
    expect(validate).toHaveBeenCalledTimes(1);
  });
  it("rejects a flattened math-model fraction and asks configured vision for exact LaTeX", async () => {
    backend.nativeAvailable = true;
    backend.math.mockResolvedValue("12");
    backend.cloud.mockResolvedValue(String.raw`\frac{1}{2}`);
    const strokes: import("./digitalInk").InkInput = [
      [
        [20, 10],
        [35, 35],
      ],
      [
        [10, 45],
        [55, 45],
      ],
      [
        [20, 55],
        [35, 80],
      ],
    ];
    expect(
      await recognizeHandwriting(
        "selected-ink",
        new AbortController().signal,
        vi.fn(),
        "math",
        undefined,
        strokes,
      ),
    ).toBe(String.raw`\frac{1}{2}`);
    expect(backend.native).not.toHaveBeenCalled();
    expect(backend.local).not.toHaveBeenCalled();
    const prompt = backend.cloud.mock.calls[0][0][0].content;
    expect(prompt).toContain("standard LaTeX");
    expect(prompt).toContain("without solving");
    expect(prompt).toContain("fraction bars");
    expect(prompt).toContain("÷ is division");
    expect(prompt).toContain("never as minus");
  });
  it("keeps division dots out of the text recognizer's plausible minus shortcut", async () => {
    backend.nativeAvailable = true;
    backend.native.mockResolvedValue(["12-3"]);
    backend.math.mockResolvedValue(String.raw`12\div3`);
    const strokes: import("./digitalInk").InkInput = [
      [
        [10, 10],
        [25, 50],
      ],
      [
        [45, 30],
        [65, 30],
      ],
      [[55, 22]],
      [[55, 38]],
      [
        [85, 10],
        [100, 50],
      ],
    ];
    const capture = vi.fn();
    await expect(
      recognizeHandwriting(
        capture,
        new AbortController().signal,
        vi.fn(),
        "math",
        undefined,
        strokes,
      ),
    ).resolves.toBe(String.raw`12\div3`);
    expect(backend.native).not.toHaveBeenCalled();
    expect(backend.math).toHaveBeenCalledWith(strokes, expect.any(AbortSignal));
    expect(backend.local).not.toHaveBeenCalled();
    expect(backend.cloud).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });
  it("routes a vertical column to native math with its rule intact, without flattening operands", async () => {
    backend.nativeAvailable = true;
    backend.math.mockResolvedValue("11\n+11\n----");
    const strokes: import("./digitalInk").InkInput = [
      [
        [20, 10],
        [30, 40],
      ],
      [
        [20, 65],
        [30, 95],
      ],
      [
        [0, 105],
        [70, 105],
      ],
    ];
    const capture = vi.fn();
    await expect(
      recognizeHandwriting(
        capture,
        new AbortController().signal,
        vi.fn(),
        "math",
        undefined,
        strokes,
      ),
    ).resolves.toBe("11\n+11\n----");
    expect(backend.math).toHaveBeenCalledWith(strokes, expect.any(AbortSignal));
    expect(backend.native).not.toHaveBeenCalled();
    expect(backend.local).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });
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
  it("finishes local math OCR without starting a cloud competitor", async () => {
    backend.cloud.mockResolvedValue("1+1=");
    backend.local.mockResolvedValue("1+1=");
    const result = await recognizeHandwriting(
      "selection",
      new AbortController().signal,
      vi.fn(),
      "math",
    );
    expect(result).toBe("1+1=");
    expect(backend.cloud).not.toHaveBeenCalled();
    expect(backend.local).toHaveBeenCalledTimes(1);
  });
  it("falls back from explicitly selected cloud recognition to local on network error", async () => {
    saveSettings({ ...defaults, apiKey: "test-key", ocr: "cloud" }, false);
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
  it("accepts a valid later native math candidate without allocating a raster model", async () => {
    backend.nativeAvailable = true;
    backend.native.mockResolvedValue(["ll+ll=", "11+11=", "11+1="]);
    const capture = vi.fn();
    const choose = vi.fn().mockResolvedValue("11+11=");
    const result = await recognizeHandwriting(
      capture,
      new AbortController().signal,
      vi.fn(),
      "math",
      (text) => text === "11+11=",
      [
        [
          [10, 10],
          [20, 20],
        ],
      ],
      undefined,
      choose,
    );
    expect(result).toBe("11+11=");
    expect(choose).toHaveBeenCalledWith(["11+11="]);
    expect(capture).not.toHaveBeenCalled();
    expect(backend.math).not.toHaveBeenCalled();
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
  it("reports native text failure without starting the browser raster model", async () => {
    backend.nativeAvailable = true;
    backend.native.mockRejectedValue(new Error("native failure"));
    saveSettings({ ...defaults, ocr: "local", apiKey: "" }, false);
    await expect(
      recognizeHandwriting(
        vi.fn(),
        new AbortController().signal,
        vi.fn(),
        "text",
        undefined,
        [[[0, 0]]],
      ),
    ).rejects.toThrow("Native handwriting");
    expect(backend.local).not.toHaveBeenCalled();
    expect(backend.cloud).not.toHaveBeenCalled();
  });
  it("falls back to structured math when the native first candidate fails validation", async () => {
    backend.nativeAvailable = true;
    backend.native.mockResolvedValue(["unreadable"]);
    backend.math.mockResolvedValue(String.raw`\frac{1}{2}`);
    const capture = vi.fn();
    saveSettings({ ...defaults, apiKey: "" }, false);
    expect(
      await recognizeHandwriting(
        capture,
        new AbortController().signal,
        vi.fn(),
        "math",
        (text) => text === String.raw`\frac{1}{2}`,
        [
          [
            [0, 0],
            [20, 20],
          ],
        ],
      ),
    ).toBe(String.raw`\frac{1}{2}`);
    expect(capture).not.toHaveBeenCalled();
    expect(backend.native).toHaveBeenCalledTimes(1);
    expect(backend.cloud).not.toHaveBeenCalled();
  });
  it("keeps the missing-language-pack flow local in automatic mode without sending a screenshot to another recognizer", async () => {
    backend.nativeAvailable = true;
    const failure = Object.assign(new Error("Language pack required"), {
      code: "HANDWRITING_MODEL_REQUIRED",
    });
    backend.native.mockRejectedValue(failure);
    const capture = vi.fn();
    await expect(
      recognizeHandwriting(
        capture,
        new AbortController().signal,
        vi.fn(),
        "text",
        undefined,
        [[[0, 0]]],
      ),
    ).rejects.toBe(failure);
    expect(capture).not.toHaveBeenCalled();
    expect(backend.local).not.toHaveBeenCalled();
    expect(backend.cloud).not.toHaveBeenCalled();
  });
  it("preserves native ranking when more than one complete math candidate is valid", async () => {
    backend.nativeAvailable = true;
    backend.native.mockResolvedValue(["11+11=", "1+1="]);
    saveSettings({ ...defaults, ocr: "local" }, false);
    await expect(
      recognizeHandwriting(
        "image",
        new AbortController().signal,
        vi.fn(),
        "math",
        (text) => text === "1+1=" || text === "11+11=",
        [[[0, 0]]],
      ),
    ).resolves.toBe("11+11=");
    expect(backend.cloud).not.toHaveBeenCalled();
  });
});

it("never loads PaddleOCR after an Android handwriting failure", async () => {
  vi.clearAllMocks();
  backend.nativeAvailable = true;
  backend.native.mockRejectedValue(new Error("native unavailable"));
  saveSettings({ ...defaults, ocr: "local", apiKey: "" }, false);
  await expect(
    recognizeHandwriting(
      vi.fn(),
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
    ),
  ).rejects.toThrow("Native handwriting");
  expect(backend.local).not.toHaveBeenCalled();
  expect(backend.cloud).not.toHaveBeenCalled();
});
