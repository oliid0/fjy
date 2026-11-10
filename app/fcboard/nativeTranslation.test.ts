import { translateLocally } from "./localTranslation";
import { translateNatively } from "./nativeTranslation";
import { defaults, saveSettings } from "./settings";
import { offlineInference } from "./offlineInference";

const native = vi.hoisted(() => ({ translate: vi.fn(), cancel: vi.fn() }));
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
it("uses the downloaded handwriting source pack for ambiguous short words", async () => {
  saveSettings({ ...defaults, inkLanguage: "es-ES" }, false);
  native.translate.mockResolvedValue({
    language: "es",
    translation: "こんにちは",
  });
  await translateLocally("Hola", "ja-JP", new AbortController().signal);
  expect(native.translate.mock.calls[0][0]).toMatchObject({
    source: "es-ES",
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
    translateLocally("hola", "zh-CN", new AbortController().signal),
  ).rejects.toThrow("model download unavailable");
  native.translate.mockResolvedValueOnce({ language: "es", translation: "" });
  await expect(
    translateLocally("hola", "zh-CN", new AbortController().signal),
  ).rejects.toThrow("Invalid local translation result");
  expect(offlineInference).not.toHaveBeenCalled();
});
