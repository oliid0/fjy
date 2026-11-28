import { startDuplexSpeech } from "./duplexSpeech";
import { startPCMSpeech } from "./localSpeech";
import { classroomCommands } from "./commands";
import { runVoiceAgent } from "./voiceAgent";
import { defaults, saveSettings } from "./settings";

const mocks = vi.hoisted(() => ({
  engine: {
    addListener: vi.fn(),
    start: vi.fn(),
    send: vi.fn(),
    pushAudio: vi.fn(),
    stop: vi.fn(),
    audioCapabilities: vi.fn(),
    interruptAudio: vi.fn(),
    captureMode: vi.fn(),
  },
  player: { enqueue: vi.fn(), interrupt: vi.fn(), close: vi.fn() },
}));
vi.mock("@capacitor/core", async (original) => ({
  ...(await original<typeof import("@capacitor/core")>()),
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => mocks.engine,
}));
vi.mock("./voiceAgent", () => ({ runVoiceAgent: vi.fn() }));
vi.mock("./localSpeech", () => ({ startPCMSpeech: vi.fn() }));
vi.mock("./duplexPlayer", () => ({ createDuplexPlayer: () => mocks.player }));

let receive: (message: {
  session: string;
  event: Record<string, unknown>;
}) => void;
let session: string;
let capture: { cancel: ReturnType<typeof vi.fn>; stream: MediaStream };
let removed: ReturnType<typeof vi.fn>;
const emit = (event: Record<string, unknown>) => receive({ session, event });
const callbacks = () => ({
  line: vi.fn(),
  interim: vi.fn(),
  caption: vi.fn(),
  state: vi.fn(),
  status: vi.fn(),
  error: vi.fn(),
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runVoiceAgent).mockReset().mockResolvedValue(undefined);
  saveSettings({ ...defaults, speechKey: "speech-key" }, false);
  removed = vi.fn().mockResolvedValue(undefined);
  capture = {
    cancel: vi.fn().mockResolvedValue(undefined),
    stream: {} as MediaStream,
  };
  mocks.player.enqueue.mockResolvedValue(undefined);
  mocks.player.close.mockResolvedValue(undefined);
  mocks.engine.send.mockResolvedValue(undefined);
  mocks.engine.pushAudio.mockResolvedValue(undefined);
  mocks.engine.stop.mockResolvedValue(undefined);
  mocks.engine.audioCapabilities.mockResolvedValue({ nativeAudio: false });
  mocks.engine.interruptAudio.mockResolvedValue(undefined);
  mocks.engine.captureMode.mockResolvedValue(undefined);
  mocks.engine.addListener.mockImplementation(async (_name, callback) => {
    receive = callback;
    return { remove: removed };
  });
  mocks.engine.start.mockImplementation(async (options) => {
    session = options.session;
    return { session };
  });
  vi.mocked(startPCMSpeech).mockImplementation(async (transport) => {
    await transport.start();
    return { ...capture, stop: capture.cancel };
  });
});
afterEach(() => vi.restoreAllMocks());

it("uses native microphone/socket/speaker without any WebView capture or playback loop", async () => {
  mocks.engine.audioCapabilities.mockResolvedValue({ nativeAudio: true });
  const view = callbacks();
  const handle = await startDuplexSpeech(view);
  try {
    expect(mocks.engine.start).toHaveBeenCalledWith(
      expect.objectContaining({ capture: true, playback: true }),
    );
    expect(startPCMSpeech).not.toHaveBeenCalled();
    emit({ type: "response.output_audio.delta", audio: "AAAA" });
    emit({ type: "audio.playing", playing: true });
    expect(mocks.player.enqueue).not.toHaveBeenCalled();
    expect(view.state).toHaveBeenLastCalledWith("speaking");
    await handle.interrupt();
    expect(mocks.engine.interruptAudio).toHaveBeenCalledWith({ session });
    await handle.prepareRecording!();
    expect(mocks.engine.captureMode).toHaveBeenLastCalledWith({
      session,
      mode: "muted",
    });
    await handle.useRecordingStream!({} as MediaStream);
    expect(startPCMSpeech).toHaveBeenCalledTimes(1);
    await handle.restoreCapture!();
    expect(mocks.engine.captureMode).toHaveBeenLastCalledWith({
      session,
      mode: "native",
    });
    expect(mocks.engine.start).toHaveBeenCalledTimes(1);
  } finally {
    await handle.cancel();
  }
});

it("uses an unchanged native microphone session when its current document frame changes", async () => {
  mocks.engine.audioCapabilities.mockResolvedValue({ nativeAudio: true });
  let stamp = "document-a:1";
  const visualFrame = vi.fn(async (previous?: string) =>
    previous === stamp
      ? undefined
      : { stamp, image: "data:image/jpeg;base64,/9j/" },
  );
  const handle = await startDuplexSpeech({ ...callbacks(), visualFrame });
  const images = () =>
    mocks.engine.send.mock.calls.filter(
      ([message]) => message.event.type === "input_image_buffer.append",
    );
  try {
    expect(mocks.engine.start).toHaveBeenCalledWith(
      expect.objectContaining({
        capture: true,
        configuration: expect.objectContaining({
          session: expect.objectContaining({ model: "1.3.0.0" }),
          extension: expect.objectContaining({
            video: { frame_format: "JPEG", frame_rate: 2 },
          }),
        }),
      }),
    );
    expect(images()).toHaveLength(1);
    expect(images()[0][0].event.image).toBe("/9j/");
    stamp = "document-b:1";
    await vi.waitFor(() => expect(images()).toHaveLength(2), { timeout: 1400 });
    expect(visualFrame).toHaveBeenCalledWith("document-a:1");
    expect(mocks.engine.start).toHaveBeenCalledTimes(1);
    expect(mocks.engine.stop).not.toHaveBeenCalled();
  } finally {
    await handle.cancel();
  }
});

it("releases a native session when retries triggered by a failed send are exhausted", async () => {
  mocks.engine.audioCapabilities.mockResolvedValue({ nativeAudio: true });
  const view = callbacks();
  const handle = await startDuplexSpeech(view);
  const failure = new Error("实时语音连接失败，请检查网络");
  mocks.engine.send.mockRejectedValueOnce(failure);
  mocks.engine.start.mockRejectedValue(failure);
  try {
    await expect(handle.interrupt()).rejects.toThrow(failure.message);
    expect(view.error).toHaveBeenCalledTimes(1);
    expect(view.error).toHaveBeenCalledWith(failure.message);
    await vi.waitFor(() => expect(removed).toHaveBeenCalledTimes(1));
    expect(startPCMSpeech).not.toHaveBeenCalled();
    expect(mocks.engine.start).toHaveBeenCalledTimes(4);
  } finally {
    await handle.cancel();
  }
});

it("cancels the actual native startup before accepting a handle and can reopen", async () => {
  mocks.engine.audioCapabilities.mockResolvedValue({ nativeAudio: true });
  let finish!: () => void;
  mocks.engine.start.mockImplementationOnce((options) => {
    session = options.session;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  const abort = new AbortController();
  const opening = startDuplexSpeech({ ...callbacks(), signal: abort.signal });
  const rejected = expect(opening).rejects.toMatchObject({
    name: "AbortError",
  });
  await vi.waitFor(() => expect(finish).toBeDefined());
  abort.abort();
  await vi.waitFor(() =>
    expect(mocks.engine.stop).toHaveBeenCalledWith({ session }),
  );
  finish();
  await rejected;
  expect(startPCMSpeech).not.toHaveBeenCalled();
  const next = await startDuplexSpeech(callbacks());
  expect(mocks.engine.start).toHaveBeenCalledTimes(2);
  await next.cancel();
});

it("waits for actual capture readiness before accepting the duplex session", async () => {
  let ready!: () => void;
  vi.mocked(startPCMSpeech).mockImplementationOnce(async (transport) => {
    await transport.start();
    return {
      ...capture,
      stop: capture.cancel,
      ready: new Promise<void>((resolve) => {
        ready = resolve;
      }),
    };
  });
  const opened = vi.fn();
  const opening = startDuplexSpeech(callbacks()).then((handle) => {
    opened();
    return handle;
  });
  await vi.waitFor(() => expect(ready).toBeDefined());
  expect(opened).not.toHaveBeenCalled();
  ready();
  const handle = await opening;
  expect(opened).toHaveBeenCalledTimes(1);
  await handle.cancel();
});

it("uses the documented duplex configuration and batches bridge transfers for native 20 ms pacing", async () => {
  const handle = await startDuplexSpeech(callbacks());
  expect(mocks.engine.start).toHaveBeenCalledWith(
    expect.objectContaining({
      key: "speech-key",
      configuration: {
        type: "session.create",
        extension: expect.objectContaining({
          asr: { extra: expect.objectContaining({ enable_asr_twopass: true }) },
        }),
        session: expect.objectContaining({
          model: "1.2.6.1",
          audio: {
            input: { format: { type: "pcm", rate: 16000 } },
            output: expect.objectContaining({
              format: { type: "pcm_s16le", rate: 24000 },
            }),
          },
          tools: [],
        }),
      },
    }),
  );
  expect(startPCMSpeech).toHaveBeenCalledWith(
    expect.anything(),
    expect.any(Function),
    expect.any(Function),
    undefined,
    true,
    undefined,
    undefined,
    { blockDuration: 0.1 },
  );
  const transport = vi.mocked(startPCMSpeech).mock.calls[0][0];
  await transport.push({ session, pcm: "AAAA", sampleRate: 16000 });
  expect(mocks.engine.pushAudio).toHaveBeenLastCalledWith({
    session,
    pcm: "AAAA",
    sampleRate: 16000,
  });
  expect(handle.stream).toBe(capture.stream);
  await handle.cancel();
});

it("forces final transcription before stop and closes capture, socket, audio and listener once", async () => {
  const view = callbacks();
  const handle = await startDuplexSpeech(view);
  mocks.engine.send.mockImplementation(async (value) => {
    if (value.event.type === "input_audio_buffer.commit") {
      emit({
        type: "conversation.item.input_audio_transcription.completed",
        text: "最后一句",
      });
    }
  });
  await handle.stop();
  await handle.cancel();
  expect(view.line).toHaveBeenCalledWith(
    expect.objectContaining({ text: "最后一句" }),
  );
  expect(capture.cancel).toHaveBeenCalledTimes(1);
  expect(mocks.engine.stop).toHaveBeenCalledTimes(1);
  expect(mocks.player.close).toHaveBeenCalledTimes(1);
  expect(removed).toHaveBeenCalledTimes(1);
});

it("recovers a failed PCM transfer without rejecting the shared microphone capture", async () => {
  const view = callbacks();
  const handle = await startDuplexSpeech(view);
  try {
    mocks.engine.pushAudio.mockRejectedValueOnce(
      new Error("实时语音网络发送过慢"),
    );
    const transport = vi.mocked(startPCMSpeech).mock.calls[0][0];
    await expect(
      transport.push({ session, pcm: "AAAA", sampleRate: 16000 }),
    ).resolves.toEqual({ lines: [] });
    await vi.waitFor(() => expect(mocks.engine.start).toHaveBeenCalledTimes(2));
    expect(capture.cancel).not.toHaveBeenCalled();
    expect(view.error).not.toHaveBeenCalled();
  } finally {
    await handle.cancel();
  }
});

it("reports authorization failures immediately and limits repeated network reconnects", async () => {
  const view = callbacks();
  const handle = await startDuplexSpeech(view);
  emit({
    type: "error",
    message: "实时语音连接失败 (HTTP 401)，请检查密钥与 Seeduplex 权限",
  });
  await vi.waitFor(() => expect(capture.cancel).toHaveBeenCalledTimes(1));
  expect(mocks.engine.start).toHaveBeenCalledTimes(1);
  expect(view.error).toHaveBeenCalledWith(expect.stringContaining("HTTP 401"));
  await handle.cancel();

  view.error.mockClear();
  const next = await startDuplexSpeech(view);
  try {
    mocks.engine.start.mockRejectedValue(new Error("实时语音连接超时"));
    emit({ type: "error", message: "实时语音连接中断" });
    await vi.waitFor(
      () => expect(view.error).toHaveBeenCalledWith("实时语音连接超时"),
      { timeout: 3000 },
    );
    expect(mocks.engine.start).toHaveBeenCalledTimes(5); // two initial sessions + three recovery attempts
  } finally {
    await next.cancel();
  }
});

it("does not reopen capture or deliver late events when closed during a reconnect", async () => {
  const view = callbacks();
  const handle = await startDuplexSpeech(view);
  let restore!: () => void;
  mocks.engine.start.mockImplementationOnce((options) => {
    session = options.session;
    return new Promise((resolve) => {
      restore = () => resolve({ session });
    });
  });
  emit({ type: "error", message: "实时语音连接中断" });
  await vi.waitFor(() => expect(restore).toBeDefined());
  await handle.cancel();
  const states = view.state.mock.calls.length;
  restore();
  await vi.waitFor(() => expect(mocks.engine.stop).toHaveBeenCalledTimes(3));
  emit({
    type: "conversation.item.input_audio_transcription.completed",
    text: "迟到的文稿",
  });
  expect(view.line).not.toHaveBeenCalled();
  expect(view.state).toHaveBeenCalledTimes(states);
  expect(startPCMSpeech).toHaveBeenCalledTimes(1);
  expect(capture.cancel).toHaveBeenCalledTimes(1);
});

it("executes a completed utterance exactly once without waiting for a speech model tool call", async () => {
  let finish!: (answer: string) => void;
  vi.mocked(runVoiceAgent).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = callbacks();
  const handle = await startDuplexSpeech(view);
  try {
    emit({ type: "conversation.item.input_audio_transcription.started" });
    emit({
      type: "conversation.item.input_audio_transcription.delta",
      text: "手写标题能量",
    });
    emit({
      type: "conversation.item.input_audio_transcription.completed",
      text: "手写标题能量",
    });
    emit({
      type: "conversation.item.input_audio_transcription.completed",
      text: "手写标题能量",
    });
    emit({ type: "response.output_text.delta", delta: "已经完成" });
    emit({ type: "response.output_audio.delta", audio: "unverified" });
    await vi.waitFor(() => expect(runVoiceAgent).toHaveBeenCalledTimes(1));
    expect(runVoiceAgent).toHaveBeenCalledTimes(1);
    expect(runVoiceAgent).toHaveBeenCalledWith(
      "手写标题能量",
      [],
      expect.any(AbortSignal),
      expect.any(AbortSignal),
    );
    expect(view.line).toHaveBeenCalledTimes(1);
    expect(mocks.player.enqueue).not.toHaveBeenCalled();
    expect(view.caption).not.toHaveBeenCalledWith("已经完成");
    finish("标题已写入当前白板。");
    await vi.waitFor(() =>
      expect(mocks.engine.send).toHaveBeenCalledWith(
        expect.objectContaining({
          event: {
            type: "speech_text_buffer.replacement.append",
            text: "标题已写入当前白板。",
          },
        }),
      ),
    );
    emit({ type: "response.output_audio.delta", audio: "actual" });
    expect(mocks.player.enqueue).toHaveBeenCalledWith("actual");
    emit({ type: "response.done" });
    emit({ type: "response.output_audio.delta", audio: "late-default" });
    expect(mocks.player.enqueue).toHaveBeenCalledTimes(1);
  } finally {
    await handle.cancel();
  }
});

it("cancels a pending operation on manual navigation and drops its late reply", async () => {
  let finish!: (answer: string) => void;
  vi.mocked(runVoiceAgent).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const handle = await startDuplexSpeech(callbacks());
  try {
    emit({ type: "conversation.item.input_audio_transcription.started" });
    emit({
      type: "conversation.item.input_audio_transcription.completed",
      text: "画电路图",
    });
    await vi.waitFor(() => expect(runVoiceAgent).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(runVoiceAgent).mock.calls[0][2];
    classroomCommands.invalidate();
    expect(signal.aborted).toBe(true);
    finish("已画好");
    await Promise.resolve();
    await Promise.resolve();
    expect(
      mocks.engine.send.mock.calls.some(
        ([value]) =>
          value.event.type === "speech_text_buffer.replacement.append",
      ),
    ).toBe(false);
    expect(capture.cancel).not.toHaveBeenCalled();
  } finally {
    await handle.cancel();
  }
});

it("waits for a preceding edit before starting the next dictated operation", async () => {
  let complete!: () => void;
  const agent = vi.mocked(runVoiceAgent).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = () => resolve(undefined);
      }),
  );
  const handle = await startDuplexSpeech(callbacks());
  try {
    for (const text of ["新建白板", "写下水循环"]) {
      emit({ type: "conversation.item.input_audio_transcription.started" });
      emit({
        type: "conversation.item.input_audio_transcription.completed",
        text,
      });
    }
    await vi.waitFor(() => expect(agent).toHaveBeenCalledTimes(1));
    complete();
    await vi.waitFor(() => expect(agent).toHaveBeenCalledTimes(2));
    expect(agent.mock.calls[1][1]).toContainEqual({
      role: "user",
      content: "新建白板",
    });
  } finally {
    await handle.cancel();
  }
});

it("allows an operation's own page transition and preserves the session owner on spoken interruption", async () => {
  let finish!: (answer: string) => void;
  vi.mocked(runVoiceAgent).mockImplementationOnce((_text, _history, signal) => {
    classroomCommands.invalidate(signal);
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const handle = await startDuplexSpeech(callbacks());
  try {
    emit({ type: "conversation.item.input_audio_transcription.started" });
    emit({
      type: "conversation.item.input_audio_transcription.completed",
      text: "下一页并解释",
    });
    await vi.waitFor(() => expect(runVoiceAgent).toHaveBeenCalledTimes(1));
    const [, , turn, owner] = vi.mocked(runVoiceAgent).mock.calls[0];
    expect(turn.aborted).toBe(false);
    await handle.interrupt();
    expect(owner!.aborted).toBe(false);
    finish("当前第二页的内容。");
    await vi.waitFor(() =>
      expect(
        mocks.engine.send.mock.calls.some(
          ([value]) =>
            value.event.type === "speech_text_buffer.replacement.commit",
        ),
      ).toBe(true),
    );
    await handle.cancel();
    expect(owner!.aborted).toBe(true);
  } finally {
    await handle.cancel();
  }
});

it("keeps speech capture usable after an execution failure without announcing success", async () => {
  const view = callbacks();
  vi.mocked(runVoiceAgent)
    .mockRejectedValueOnce(new Error("对象已删除"))
    .mockResolvedValueOnce("这是新的解释");
  const handle = await startDuplexSpeech(view);
  try {
    emit({ type: "conversation.item.input_audio_transcription.started" });
    emit({
      type: "conversation.item.input_audio_transcription.completed",
      text: "移动这个对象",
    });
    await vi.waitFor(() =>
      expect(view.caption).toHaveBeenCalledWith("对象已删除"),
    );
    expect(capture.cancel).not.toHaveBeenCalled();
    emit({ type: "conversation.item.input_audio_transcription.started" });
    emit({
      type: "conversation.item.input_audio_transcription.completed",
      text: "解释一下",
    });
    await vi.waitFor(() =>
      expect(mocks.engine.send).toHaveBeenCalledWith(
        expect.objectContaining({
          event: {
            type: "speech_text_buffer.replacement.append",
            text: "这是新的解释",
          },
        }),
      ),
    );
  } finally {
    await handle.cancel();
  }
});

it("clears a released recording stream even when native microphone restoration fails", async () => {
  mocks.engine.audioCapabilities.mockResolvedValue({ nativeAudio: true });
  const handle = await startDuplexSpeech(callbacks());
  try {
    await handle.prepareRecording!();
    await handle.useRecordingStream!({} as MediaStream);
    expect(handle.stream).toBe(capture.stream);
    mocks.engine.captureMode.mockRejectedValueOnce(new Error("restore failed"));
    await expect(handle.restoreCapture!()).rejects.toThrow("restore failed");
    expect(handle.stream).toBeUndefined();
    await handle.prepareRecording!();
    expect(handle.stream).toBeUndefined();
    expect(capture.cancel).toHaveBeenCalledTimes(1);
  } finally {
    await handle.cancel();
  }
});

it("executes repeated page requests in separate speech turns while ignoring a duplicated final event", async () => {
  let page = 1;
  vi.mocked(runVoiceAgent).mockImplementation(async () => {
    page++;
    return undefined;
  });
  const view = callbacks();
  const handle = await startDuplexSpeech(view);
  try {
    for (let turn = 0; turn < 2; turn++) {
      emit({
        type: "conversation.item.input_audio_transcription.started",
        event_id: "reused-correlation",
      });
      emit({
        type: "conversation.item.input_audio_transcription.delta",
        text: "下一",
      });
      emit({
        type: "conversation.item.input_audio_transcription.delta",
        text: "下一页",
      });
      emit({
        type: "conversation.item.input_audio_transcription.completed",
        text: "下一页",
      });
      emit({
        type: "conversation.item.input_audio_transcription.completed",
        text: "下一页",
      });
    }
    await vi.waitFor(() => expect(runVoiceAgent).toHaveBeenCalledTimes(2));
    expect(page).toBe(3);
    expect(view.line.mock.calls.map(([line]) => line.text)).toEqual([
      "下一页",
      "下一页",
    ]);
  } finally {
    await handle.cancel();
  }
});
