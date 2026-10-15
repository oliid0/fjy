import { startSystemSpeech } from "./speech";

const native = vi.hoisted(() => ({
  available: vi.fn(),
  requestPermissions: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
}));
vi.mock("@capacitor-community/speech-recognition", () => ({
  SpeechRecognition: native,
}));

describe("Android system speech", () => {
  beforeEach(() => {
    native.available.mockResolvedValue({ available: true });
    native.requestPermissions.mockResolvedValue({
      speechRecognition: "granted",
    });
    native.stop.mockResolvedValue(undefined);
  });
  it("requires an installed recognizer and microphone permission", async () => {
    native.available.mockResolvedValue({ available: false });
    await expect(startSystemSpeech(vi.fn(), vi.fn())).rejects.toThrow(
      "语音识别服务",
    );
    native.available.mockResolvedValue({ available: true });
    native.requestPermissions.mockResolvedValue({
      speechRecognition: "denied",
    });
    await expect(startSystemSpeech(vi.fn(), vi.fn())).rejects.toThrow("权限");
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
});
