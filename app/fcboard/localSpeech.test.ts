import { encodePCM, startLocalSpeech, startPCMSpeech } from "./localSpeech";

const engine = vi.hoisted(() => ({
  prepare: vi.fn(),
  start: vi.fn(),
  push: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => engine,
}));

describe("built-in speech audio lifecycle", () => {
  let emit: (value: unknown) => void;
  let trackStop: ReturnType<typeof vi.fn>;
  let stream: MediaStream;
  let close: ReturnType<typeof vi.fn>;
  let resume: ReturnType<typeof vi.fn>;
  let fallbackInput: (samples: Float32Array) => void;
  beforeEach(() => {
    engine.prepare.mockResolvedValue(undefined);
    engine.start.mockResolvedValue({ session: "session-1" });
    engine.push.mockResolvedValue({
      lines: [{ time: 0, text: "帮我画个立方体" }],
    });
    engine.stop.mockResolvedValue({ lines: [{ time: 1, text: "末尾文稿" }] });
    trackStop = vi.fn();
    stream = {
      getTracks: () => [{ stop: trackStop }],
    } as unknown as MediaStream;
    close = vi.fn().mockResolvedValue(undefined);
    resume = vi.fn().mockResolvedValue(undefined);
    class Context {
      sampleRate = 48000;
      audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
      destination = {};
      createMediaStreamSource = () => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
      });
      resume = resume;
      close = close;
      createScriptProcessor = () => {
        const processor = {
          onaudioprocess: null as
            | ((event: {
                inputBuffer: { getChannelData: () => Float32Array };
              }) => void)
            | null,
          connect: vi.fn(),
          disconnect: vi.fn(),
        };
        fallbackInput = (samples) =>
          processor.onaudioprocess?.({
            inputBuffer: { getChannelData: () => samples },
          });
        return processor;
      };
    }
    class Worklet {
      port = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage: () => this.port.onmessage?.({ data: { flushed: true } }),
      };
      connect = vi.fn();
      disconnect = vi.fn();
      constructor() {
        emit = (data) => this.port.onmessage?.({ data });
      }
    }
    vi.stubGlobal("AudioContext", Context);
    vi.stubGlobal("AudioWorkletNode", Worklet);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("resumes audio in the initiating action before waiting for the native model/session", async () => {
    const handle = await startLocalSpeech(vi.fn(), vi.fn(), stream);
    expect(resume.mock.invocationCallOrder[0]).toBeLessThan(
      engine.start.mock.invocationCallOrder.at(-1)!,
    );
    await handle.cancel();
  });

  it("does not declare microphone readiness until actual nonempty PCM arrives", async () => {
    const handle = await startLocalSpeech(vi.fn(), vi.fn(), stream);
    const ready = vi.fn();
    void handle.ready!.then(ready);
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    emit({ pcm: new Float32Array(), sampleRate: 16000 });
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    emit({ pcm: new Float32Array([0.5]), sampleRate: 16000 });
    await handle.ready;
    expect(ready).toHaveBeenCalledTimes(1);
    await handle.cancel();
  });

  it("recovers a worklet with no samples using real fallback PCM and exact 16k cloud resampling", async () => {
    vi.useFakeTimers();
    const error = vi.fn();
    const handle = await startPCMSpeech(engine, vi.fn(), error, stream, true);
    await vi.advanceTimersByTimeAsync(1500);
    fallbackInput(new Float32Array(4800).fill(0.5));
    await handle.ready;
    await vi.advanceTimersByTimeAsync(0);
    const options = engine.push.mock.calls.at(-1)![0];
    expect(options.sampleRate).toBe(16000);
    const bytes = Uint8Array.from(atob(options.pcm), (value) =>
      value.charCodeAt(0),
    );
    expect(bytes).toHaveLength(3200);
    expect(new DataView(bytes.buffer).getInt16(0, true)).toBe(16384);
    expect(error).not.toHaveBeenCalled();
    await handle.cancel();
    expect(trackStop).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("reports a microphone that never delivers samples and releases its audio context", async () => {
    vi.useFakeTimers();
    const error = vi.fn();
    const handle = await startLocalSpeech(vi.fn(), error, stream);
    await vi.advanceTimersByTimeAsync(12000);
    await handle.cancel();
    expect(error).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(trackStop).not.toHaveBeenCalled();
  });

  it("keeps watching an established audio stream and detects a later stalled microphone", async () => {
    vi.useFakeTimers();
    const error = vi.fn();
    const handle = await startLocalSpeech(vi.fn(), error, stream);
    emit({ pcm: new Float32Array([0.5]), sampleRate: 16000 });
    await vi.advanceTimersByTimeAsync(11000);
    expect(error).not.toHaveBeenCalled();
    emit({ pcm: new Float32Array([0.5]), sampleRate: 16000 });
    await vi.advanceTimersByTimeAsync(11000);
    expect(error).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(error).toHaveBeenCalledTimes(1);
    await handle.cancel();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("releases capture immediately when cancelling a still-running inference", async () => {
    let resolve!: (value: { lines: [] }) => void;
    engine.push.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const handle = await startLocalSpeech(vi.fn(), vi.fn(), stream);
    emit({ pcm: new Float32Array([0.5]), sampleRate: 16000 });
    await vi.waitFor(() => expect(resolve).toBeDefined());
    const ending = handle.cancel();
    try {
      await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    } finally {
      resolve({ lines: [] });
      await ending;
    }
    expect(trackStop).not.toHaveBeenCalled();
  });

  it("reports live words and speech activity without executing a partial sentence", async () => {
    const final = vi.fn();
    const interim = vi.fn();
    const activity = vi.fn();
    engine.push.mockResolvedValueOnce({
      lines: [],
      activity: true,
      interim: { time: 0.2, text: "今天讲牛顿" },
    });
    const handle = await startLocalSpeech(
      final,
      vi.fn(),
      stream,
      activity,
      interim,
    );
    emit({ pcm: new Float32Array([0.5]), sampleRate: 16000 });
    await vi.waitFor(() =>
      expect(interim).toHaveBeenCalledWith({ time: 0.2, text: "今天讲牛顿" }),
    );
    expect(activity).toHaveBeenCalledTimes(1);
    expect(final).not.toHaveBeenCalled();
    engine.push.mockResolvedValueOnce({
      lines: [{ time: 0.2, text: "今天讲牛顿定律" }],
      activity: false,
      interim: null,
    });
    emit({ pcm: new Float32Array([0.5]), sampleRate: 16000 });
    await vi.waitFor(() =>
      expect(final.mock.calls[0]?.[0]).toEqual({
        time: 0.2,
        text: "今天讲牛顿定律",
      }),
    );
    expect(interim).toHaveBeenLastCalledWith(null);
    await handle.cancel();
  });

  it("encodes signed PCM16 in little-endian order with clipping", () => {
    const bytes = Uint8Array.from(
      atob(encodePCM(new Float32Array([-2, -1, 0, 1, 2]))),
      (value) => value.charCodeAt(0),
    );
    const view = new DataView(bytes.buffer);
    expect(
      Array.from({ length: 5 }, (_, i) => view.getInt16(i * 2, true)),
    ).toEqual([-32768, -32768, 0, 32767, 32767]);
  });

  it("flushes final transcript and releases processing without stopping a shared recording stream", async () => {
    const onLine = vi.fn();
    const handle = await startLocalSpeech(onLine, vi.fn(), stream);
    emit({ pcm: new Float32Array([0.5]), sampleRate: 48000 });
    await vi.waitFor(() => expect(engine.push).toHaveBeenCalled());
    await handle.stop();
    expect(onLine.mock.calls.map(([line]) => line.text)).toEqual([
      "帮我画个立方体",
      "末尾文稿",
    ]);
    expect(trackStop).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("cancels late engine results without executing a voice command", async () => {
    let resolve!: (value: { lines: { time: number; text: string }[] }) => void;
    engine.push.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const onLine = vi.fn();
    const handle = await startLocalSpeech(onLine, vi.fn(), stream);
    emit({ pcm: new Float32Array([0.5]), sampleRate: 16000 });
    await vi.waitFor(() => expect(resolve).toBeDefined());
    const cancellation = handle.cancel();
    resolve({ lines: [{ time: 0, text: "不应执行" }] });
    await cancellation;
    expect(onLine).not.toHaveBeenCalled();
    expect(engine.stop).toHaveBeenCalledWith({ session: "session-1" });
  });

  it("delivers cloud segments while capture stays open and discards on cancellation", async () => {
    const transport = {
      start: vi.fn().mockResolvedValue({ session: "cloud" }),
      push: vi
        .fn()
        .mockResolvedValue({ lines: [{ time: 1, text: "画一个圆" }] }),
      stop: vi.fn().mockResolvedValue({ lines: [] }),
    };
    const onLine = vi.fn();
    const handle = await startPCMSpeech(
      transport,
      onLine,
      vi.fn(),
      stream,
      true,
    );
    emit({ pcm: new Float32Array(1600), sampleRate: 16000 });
    await vi.waitFor(() =>
      expect(onLine.mock.calls[0]?.[0]).toEqual({ time: 1, text: "画一个圆" }),
    );
    expect(transport.stop).not.toHaveBeenCalled();
    await handle.cancel();
    expect(transport.stop).toHaveBeenCalledWith({
      session: "cloud",
      discard: true,
    });
    expect(trackStop).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
