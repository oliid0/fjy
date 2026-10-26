import { t, setLanguage, languages } from "@excalidraw/excalidraw/i18n";

import { startSystemSpeech } from "./speech";

const offline = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("./localSpeech", () => ({ startLocalSpeech: offline.start }));

const native = vi.hoisted(() => ({
  available: vi.fn(),
  requestPermissions: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => false },
  registerPlugin: () => native,
}));
vi.mock("@capacitor-community/speech-recognition", () => ({
  SpeechRecognition: native,
}));

describe("Android system speech", () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(async () => {
    vi.clearAllMocks();
    await setLanguage(languages.find((lang) => lang.code === "zh-CN")!);
    native.start.mockReset();
    native.start.mockResolvedValue({ matches: [] });
    native.available.mockResolvedValue({ available: true });
    native.requestPermissions.mockResolvedValue({
      speechRecognition: "granted",
    });
    native.stop.mockResolvedValue(undefined);
    offline.stop.mockResolvedValue(undefined);
    offline.cancel.mockResolvedValue(undefined);
    offline.start.mockResolvedValue({
      stop: offline.stop,
      cancel: offline.cancel,
    });
  });
  it("falls back to bundled Chinese recognition when Android has no system provider", async () => {
    native.available.mockResolvedValue({ available: false });
    const stop = await startSystemSpeech(vi.fn(), vi.fn());
    expect(offline.start).toHaveBeenCalled();
    expect(native.start).not.toHaveBeenCalled();
    stop();
    expect(offline.cancel).toHaveBeenCalled();
  });
  it("requires microphone permission before invoking an Android provider", async () => {
    native.available.mockResolvedValue({ available: true });
    native.requestPermissions.mockResolvedValue({
      speechRecognition: "denied",
    });
    await expect(startSystemSpeech(vi.fn(), vi.fn())).rejects.toThrow(
      t("fcboard.allow_microphone_and_speech_recognition_access"),
    );
  });
  it("executes only one final offline command and ignores text after cancellation", async () => {
    native.available.mockResolvedValue({ available: false });
    const result = vi.fn();
    const stop = await startSystemSpeech(result, vi.fn());
    const deliver = offline.start.mock.calls.at(-1)![0];
    deliver({ time: 0, text: "画一个圆" });
    deliver({ time: 1, text: "重复尾句" });
    expect(result).toHaveBeenCalledTimes(1);
    expect(offline.stop).toHaveBeenCalled();
    stop();
    deliver({ time: 2, text: "过期指令" });
    expect(result).toHaveBeenCalledTimes(1);
  });
  it("passes only final recognition results to the command handler", async () => {
    native.start.mockResolvedValue({ matches: ["帮我画个立方体"] });
    const result = vi.fn();
    const stop = await startSystemSpeech(result, vi.fn());
    await Promise.resolve();
    expect(result).toHaveBeenCalledWith("帮我画个立方体");
    expect(native.start).toHaveBeenCalledWith(
      expect.objectContaining({
        partialResults: false,
        popup: false,
        language: "zh-CN",
      }),
    );
    stop();
  });
  it("ignores a late result after the user stops listening", async () => {
    let finish!: (value: { matches: string[] }) => void;
    native.start.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const result = vi.fn();
    const stop = await startSystemSpeech(result, vi.fn());
    stop();
    finish({ matches: ["不应执行的指令"] });
    await Promise.resolve();
    expect(result).not.toHaveBeenCalled();
    expect(native.stop).toHaveBeenCalled();
  });
  it("falls back once when an installed system service cannot actually start", async () => {
    native.start.mockRejectedValue({ code: "speech-11" });
    const result = vi.fn();
    const stop = await startSystemSpeech(result, vi.fn());
    for (let i = 0; i < 12; i++) {
      await Promise.resolve();
    }
    expect(offline.start).toHaveBeenCalledTimes(1);
    const deliver = offline.start.mock.calls.at(-1)![0];
    deliver({ time: 0, text: "画一个圆" });
    expect(result).toHaveBeenCalledWith("画一个圆");
    stop();
  });
  it("restarts after a quiet continuous interval without opening another microphone", async () => {
    vi.useFakeTimers();
    native.start
      .mockRejectedValueOnce({ code: "speech-6" })
      .mockResolvedValue({ matches: [] });
    const stop = await startSystemSpeech(vi.fn(), vi.fn(), true);
    await vi.advanceTimersByTimeAsync(300);
    expect(native.start).toHaveBeenCalledTimes(2);
    expect(offline.start).not.toHaveBeenCalled();
    stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(native.start).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
  it("does not reopen the offline microphone after Android interrupts a session", async () => {
    native.start.mockRejectedValue({ code: "cancelled" });
    const error = vi.fn();
    const stop = await startSystemSpeech(vi.fn(), error);
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
    }
    expect(offline.start).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      t("fcboard.speech_recognition_ended_start_listening_again"),
    );
    stop();
  });
  it("passes the selected interface language to Android rather than forcing Chinese", async () => {
    await setLanguage(languages.find((lang) => lang.code === "en")!);
    const stop = await startSystemSpeech(vi.fn(), vi.fn());
    expect(native.start).toHaveBeenCalledWith(
      expect.objectContaining({ language: "en" }),
    );
    stop();
  });
});
