import { translateLocally } from "./localTranslation";
import { translateNatively } from "./nativeTranslation";
import { defaults, saveSettings } from "./settings";
import { offlineInference } from "./offlineInference";

const native = vi.hoisted(() => ({
  translate: vi.fn(),
  infer: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => "android", isNativePlatform: () => true },
  registerPlugin: () => native,
}));
vi.mock("./offlineInference", () => ({ offlineInference: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  native.cancel.mockResolvedValue(undefined);
  saveSettings({ ...defaults, inkLanguage: "auto" }, false);
});
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

it("detects Spanish natively and returns Chinese without starting any renderer model", async () => {
  native.translate.mockResolvedValue({ language: "es", translation: "早上好" });
  await expect(
    translateLocally("Buenos días", "zh-CN", new AbortController().signal),
  ).resolves.toEqual({ language: "es", translation: "早上好" });
  expect(native.translate).toHaveBeenCalledWith({
    id: expect.any(String),
    text: "Buenos días",
    source: "auto",
    target: "zh-CN",
  });
  expect(offlineInference).not.toHaveBeenCalled();
});
it("does not let a legacy handwriting preference override native language detection", async () => {
  saveSettings({ ...defaults, inkLanguage: "es-ES" }, false);
  native.translate.mockResolvedValue({
    language: "es",
    translation: "こんにちは",
  });
  await translateLocally("Hola", "ja-JP", new AbortController().signal);
  expect(native.translate.mock.calls[0][0]).toMatchObject({
    source: "auto",
    target: "ja-JP",
  });
});
it("aborts immediately, cancels the native queue entry and ignores a late SDK result", async () => {
  let finish!: (value: { language: string; translation: string }) => void;
  native.translate.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const controller = new AbortController();
  const task = translateNatively("hello", "zh-CN", controller.signal);
  const failure = expect(task).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await failure;
  expect(native.cancel).toHaveBeenCalledWith({
    id: native.translate.mock.calls[0][0].id,
  });
  finish({ language: "en", translation: "迟到" });
  await Promise.resolve();
  expect(offlineInference).not.toHaveBeenCalled();
});
it("rejects native failures and invalid outputs without a hidden WASM or cloud retry", async () => {
  native.translate.mockRejectedValueOnce(
    new Error("model download unavailable"),
  );
  await expect(
    translateLocally("¿Hola?", "zh-CN", new AbortController().signal),
  ).rejects.toThrow("model download unavailable");
  native.translate.mockResolvedValueOnce({ language: "es", translation: "" });
  await expect(
    translateLocally("¿Hola?", "zh-CN", new AbortController().signal),
  ).rejects.toThrow("Invalid local translation result");
  expect(offlineInference).not.toHaveBeenCalled();
});

it.each(["hello", "hi", "yes", "thank"])(
  "sends short English %s to native OPUS exactly once without a browser model",
  async (text) => {
    native.infer.mockResolvedValue({ language: "en", translation: "译文" });
    await expect(
      translateLocally(text, "zh-CN", new AbortController().signal),
    ).resolves.toEqual({ language: "en", translation: "译文" });
    expect(native.infer).toHaveBeenCalledTimes(1);
    expect(native.infer).toHaveBeenCalledWith({
      id: expect.any(String),
      kind: "translation",
      text,
      source: "en",
      target: "zh",
    });
    expect(native.translate).not.toHaveBeenCalled();
    expect(offlineInference).not.toHaveBeenCalled();
  },
);
it("does not fall back into WebView when the OPUS process dies", async () => {
  native.infer.mockRejectedValue(new Error("Native model process stopped"));
  await expect(
    translateLocally("你好", "en", new AbortController().signal),
  ).rejects.toThrow("Native model process stopped");
  expect(offlineInference).not.toHaveBeenCalled();
});
