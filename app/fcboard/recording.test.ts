import {
  BoardRecorder,
  loadRecordings,
  saveRecordings,
  timestamp,
} from "./recording";

describe("recording lifecycle", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("saves and reloads playable blobs and timestamped transcripts", async () => {
    await saveRecordings([
      {
        id: "lesson",
        created: 1,
        duration: 80,
        mode: "audio",
        blob: new Blob(["audio"], { type: "audio/webm" }),
        transcript: [{ time: 31, text: "知识点" }],
        summary: "总结",
      },
    ]);
    const loaded = await loadRecordings();
    expect(loaded[0].transcript[0]).toEqual({ time: 31, text: "知识点" });
    expect(loaded[0].blob.size).toBe(5);
    expect(timestamp(80)).toBe("01:20");
    await saveRecordings([]);
  });
  it("reports denied permissions without leaving a recording active", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn().mockRejectedValue(new Error("permission denied")),
      },
    });
    vi.stubGlobal("MediaRecorder", class {});
    const recorder = new BoardRecorder();
    await expect(recorder.start("audio", vi.fn())).rejects.toThrow(
      "permission denied",
    );
    recorder.dispose();
  });
  it("releases every media track after stop and preserves recorded data", async () => {
    const stop = vi.fn();
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi
          .fn()
          .mockResolvedValue({ getTracks: () => [{ stop }] }),
      },
    });
    class FakeRecorder {
      static isTypeSupported() {
        return true;
      }
      mimeType = "audio/webm";
      state = "inactive";
      ondataavailable?: (event: { data: Blob }) => void;
      onstop?: () => void;
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["audio"]) });
        this.onstop?.();
      }
    }
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    const recorder = new BoardRecorder();
    const ended = vi.fn();
    await recorder.start("audio", ended);
    const result = await recorder.stop();
    expect(result.blob.size).toBe(5);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledTimes(1);
  });
});
