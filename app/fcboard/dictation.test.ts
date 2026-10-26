import { startDictation } from "./dictation";
import { defaults, saveSettings } from "./settings";
import * as speech from "./speech";
import * as cloud from "./cloudSpeech";
import * as local from "./localSpeech";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["cloud", "local"] as const)(
  "uses the configured %s stream for question dictation",
  async (provider) => {
    saveSettings({ ...defaults, speech: provider }, false);
    const handle = { stop: vi.fn(), cancel: vi.fn() };
    const start =
      provider === "cloud"
        ? vi.spyOn(cloud, "startCloudSpeech").mockResolvedValue(handle)
        : vi.spyOn(local, "startLocalSpeech").mockResolvedValue(handle);
    const text = vi.fn();
    const error = vi.fn();
    const session = await startDictation(text, error);
    start.mock.calls[0][0]({ text: "问题", time: 0 });
    expect(text).toHaveBeenCalledWith("问题");
    await session.cancel();
    expect(handle.cancel).toHaveBeenCalledTimes(1);
  },
);

it("keeps system dictation continuous and exposes explicit stop and cancel", async () => {
  saveSettings({ ...defaults, speech: "system" }, false);
  const stop = vi.fn();
  const start = vi.spyOn(speech, "startSystemSpeech").mockResolvedValue(stop);
  const text = vi.fn();
  const error = vi.fn();
  const handle = await startDictation(text, error);
  expect(start).toHaveBeenCalledWith(text, error, true);
  await handle.cancel();
  expect(stop).toHaveBeenCalledTimes(1);
});

it("flushes a custom recording once, releases capture and suppresses a cancelled late transcription", async () => {
  saveSettings({ ...defaults, speech: "custom" }, false);
  const release = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi
        .fn()
        .mockResolvedValue({ getTracks: () => [{ stop: release }] }),
    },
  });
  class Recorder {
    state = "inactive";
    mimeType = "audio/webm";
    onstop?: () => void;
    ondataavailable?: (event: { data: Blob }) => void;
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["audio"]) });
      this.onstop?.();
    }
  }
  vi.stubGlobal("MediaRecorder", Recorder);
  let finish!: (value: { time: number; text: string }[]) => void;
  const transcribe = vi
    .spyOn(speech, "transcribe")
    .mockImplementation(() => new Promise((resolve) => (finish = resolve)));
  const text = vi.fn();
  const handle = await startDictation(text, vi.fn());
  const stopped = handle.stop();
  await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1));
  const cancelled = handle.cancel();
  finish([{ time: 0, text: "late" }]);
  await Promise.all([stopped, cancelled]);
  expect(release).toHaveBeenCalledTimes(1);
  expect(text).not.toHaveBeenCalled();
  await handle.stop();
  expect(transcribe).toHaveBeenCalledTimes(1);
});
