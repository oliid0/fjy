import { encodePCM, startLocalSpeech } from "./localSpeech";

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
      audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
      destination = {};
      createMediaStreamSource = () => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
      });
      resume = resume;
      close = close;
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
});
