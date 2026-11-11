import { startDuplexSpeech } from "./duplexSpeech";
import { startPCMSpeech } from "./localSpeech";
import { classroomCommands } from "./commands";
import { defaults, saveSettings } from "./settings";
import { registerBoardAgents } from "./boardAgents";
import * as ai from "./ai";

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
const call = (id: string, name: string, args = {}) => ({
  call_id: id,
  name: "board_command",
  arguments: JSON.stringify({ name, args }),
});
const toolReplies = () =>
  mocks.engine.send.mock.calls
    .map(([value]) => value.event)
    .filter((event) => event.type === "conversation.item.create");

beforeEach(() => {
  vi.clearAllMocks();
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

it("recovers native-only input and tool-result sending without a WebView capture handle", async () => {
  mocks.engine.audioCapabilities.mockResolvedValue({ nativeAudio: true });
  const view = callbacks();
  let finish!: () => void;
  let owner!: AbortSignal;
  const release = classroomCommands.register("canvas.text", "Write", (args) => {
    owner = args.signal as AbortSignal;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  const handle = await startDuplexSpeech(view);
  try {
    emit({ type: "session.created", session: { id: "native-dialog" } });
    emit({
      type: "response.function_call_arguments.done",
      items: [call("write", "canvas.text")],
    });
    await vi.waitFor(() => expect(finish).toBeDefined());
    emit({ type: "error", message: "实时语音连接中断" });
    await vi.waitFor(() => expect(mocks.engine.start).toHaveBeenCalledTimes(2));
    expect(mocks.engine.start).toHaveBeenLastCalledWith(
      expect.objectContaining({
        capture: true,
        playback: true,
        configuration: expect.objectContaining({
          session: expect.objectContaining({ id: "native-dialog" }),
        }),
      }),
    );
    expect(owner.aborted).toBe(false);
    // An actual control/result send also recovers through the native session.
    mocks.engine.send.mockRejectedValueOnce(new Error("实时语音网络发送过慢"));
    await handle.interrupt();
    expect(mocks.engine.start).toHaveBeenCalledTimes(3);
    expect(mocks.engine.send).toHaveBeenLastCalledWith({
      session,
      event: { type: "response.cancel" },
    });
    emit({ type: "conversation.item.input_audio_transcription.started" });
    emit({
      type: "conversation.item.input_audio_transcription.completed",
      text: "原生收音继续",
    });
    expect(view.line).toHaveBeenCalledWith(
      expect.objectContaining({ text: "原生收音继续" }),
    );
    expect(startPCMSpeech).not.toHaveBeenCalled();
    expect(view.error).not.toHaveBeenCalled();
    expect(owner.aborted).toBe(false);
    finish();
    await vi.waitFor(() => expect(toolReplies()).toHaveLength(1));
  } finally {
    finish?.();
    await handle.cancel();
    release();
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

it("keeps receiving microphone input and output after malformed or failed tool calls", async () => {
  const release = classroomCommands.register(
    "canvas.erase",
    "Erase",
    async () => {
      throw new Error("Agent unavailable");
    },
  );
  const view = callbacks();
  const handle = await startDuplexSpeech(view);
  try {
    emit({
      type: "response.function_call_arguments.done",
      items: [{ name: "board_command" }],
    });
    emit({
      type: "response.function_call_arguments.done",
      items: [call("failed", "canvas.erase")],
    });
    await vi.waitFor(() => expect(toolReplies()).toHaveLength(1));
    const id = "one-turn";
    emit({
      type: "conversation.item.input_audio_transcription.started",
      event_id: id,
    });
    emit({
      type: "conversation.item.input_audio_transcription.delta",
      transcript: "继续对话",
      event_id: id,
    });
    emit({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "继续对话",
      event_id: id,
    });
    emit({ type: "response.output_text.delta", text: "可以", event_id: id });
    emit({ type: "response.output_audio.delta", audio: "AAAA", event_id: id });
    await vi
      .mocked(startPCMSpeech)
      .mock.calls[0][0].push({ session, pcm: "AAAA", sampleRate: 16000 });
    expect(view.line).toHaveBeenCalledWith(
      expect.objectContaining({ text: "继续对话" }),
    );
    expect(view.caption).toHaveBeenLastCalledWith("可以");
    expect(mocks.player.enqueue).toHaveBeenCalledWith("AAAA");
    expect(mocks.engine.pushAudio).toHaveBeenCalled();
    expect(view.error).not.toHaveBeenCalled();
    expect(view.status).not.toHaveBeenCalled();
    expect(capture.cancel).not.toHaveBeenCalled();
  } finally {
    await handle.cancel();
    release();
  }
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

it("acknowledges long board work immediately and speaks explicit task text while that work continues", async () => {
  const agents = registerBoardAgents();
  let finish!: () => void;
  let owner!: AbortSignal;
  const release = classroomCommands.register(
    "experiment.run",
    "Run an experiment",
    (args) => {
      owner = args.signal as AbortSignal;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
  );
  const view = callbacks();
  const handle = await startDuplexSpeech(view);
  try {
    emit({
      type: "response.function_call_arguments.done",
      items: [call("experiment", "experiment.run")],
    });
    await vi.waitFor(() => expect(toolReplies()).toHaveLength(1));
    expect(
      JSON.parse(toolReplies()[0].items[0].content[0].text).result.state,
    ).toBe("running");
    expect(finish).toBeDefined();
    await classroomCommands.execute({
      name: "agent.say",
      args: { text: "这段文字需要朗读", signal: owner },
    });
    await vi.waitFor(() =>
      expect(mocks.engine.send).toHaveBeenCalledWith(
        expect.objectContaining({
          event: {
            type: "speech_text_buffer.replacement.append",
            text: "这段文字需要朗读",
          },
        }),
      ),
    );
    expect(
      (classroomCommands.read("agents") as { state: string }[])[0].state,
    ).toBe("running");
    emit({ type: "conversation.item.input_audio_transcription.started" });
    emit({
      type: "conversation.item.input_audio_transcription.completed",
      text: "再补充一点信息",
    });
    expect(view.line).toHaveBeenCalledWith(
      expect.objectContaining({ text: "再补充一点信息" }),
    );
    expect(view.status).not.toHaveBeenCalled();
    expect(view.error).not.toHaveBeenCalled();
    expect(capture.cancel).not.toHaveBeenCalled();
    finish();
  } finally {
    await handle.cancel();
    release();
    agents();
  }
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
          tools: [expect.objectContaining({ name: "board_command" })],
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

it("streams input captions, final transcript, reply text and PCM independently", async () => {
  const view = callbacks();
  const handle = await startDuplexSpeech(view);
  emit({ type: "conversation.item.input_audio_transcription.started" });
  emit({
    type: "conversation.item.input_audio_transcription.delta",
    text: "写一个标题",
  });
  expect(view.interim).toHaveBeenLastCalledWith({
    time: expect.any(Number),
    text: "写一个标题",
  });
  expect(view.line).not.toHaveBeenCalled();
  emit({
    type: "conversation.item.input_audio_transcription.completed",
    transcript: "写一个标题",
  });
  expect(view.line).toHaveBeenCalledWith({
    time: expect.any(Number),
    text: "写一个标题",
  });
  emit({ type: "response.output_text.delta", delta: "正在" });
  emit({ type: "response.output_text.delta", delta: "书写" });
  expect(view.caption).toHaveBeenLastCalledWith("正在书写");
  emit({ type: "response.output_audio.delta", delta: "AAAA" });
  expect(mocks.player.enqueue).toHaveBeenCalledWith("AAAA");
  await handle.cancel();
  const before = view.caption.mock.calls.length;
  emit({ type: "response.output_text.delta", delta: "late" });
  expect(view.caption).toHaveBeenCalledTimes(before);
  expect(removed).toHaveBeenCalledTimes(1);
});

it("keeps capture and later speech live while a real tool is pending, then returns one deduplicated result per call id", async () => {
  let finish!: () => void;
  let written = 0;
  const release = classroomCommands.register(
    "canvas.text",
    "Write on the current board",
    async (args) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      (args.signal as AbortSignal).throwIfAborted();
      written++;
      return { id: "written-object" };
    },
  );
  const view = callbacks();
  const handle = await startDuplexSpeech(view);
  try {
    emit({
      type: "response.function_call_arguments.done",
      items: [call("first", "canvas.text", { text: "电流和电阻" })],
    });
    await vi.waitFor(() => expect(typeof finish).toBe("function"));
    emit({ type: "conversation.item.input_audio_transcription.started" });
    emit({
      type: "conversation.item.input_audio_transcription.completed",
      text: "再画一个圆",
    });
    expect(view.line).toHaveBeenCalledWith(
      expect.objectContaining({ text: "再画一个圆" }),
    );
    await vi
      .mocked(startPCMSpeech)
      .mock.calls[0][0].push({ session, pcm: "AAAA", sampleRate: 16000 });
    expect(toolReplies()).toHaveLength(0);
    finish();
    await vi.waitFor(() => expect(toolReplies()).toHaveLength(1));
    const first = toolReplies()[0].items[0];
    expect(first).toMatchObject({ call_id: "first", role: "tool" });
    expect(JSON.parse(first.content[0].text)).toMatchObject({
      ok: true,
      result: { id: "written-object" },
    });
    emit({
      type: "response.function_call_arguments.done",
      items: [call("first", "canvas.text")],
    });
    await vi.waitFor(() => expect(toolReplies()).toHaveLength(2));
    expect(written).toBe(1);
    expect(capture.cancel).not.toHaveBeenCalled();
  } finally {
    await handle.cancel();
    release();
  }
});

it("returns failures for unavailable commands rather than claiming success, preserving batch call ids", async () => {
  const handle = await startDuplexSpeech(callbacks());
  emit({
    type: "response.function_call_arguments.done",
    items: [call("private", "ui.invoke"), call("missing", "missing.command")],
  });
  await vi.waitFor(() => expect(toolReplies()).toHaveLength(1));
  expect(
    toolReplies()[0].items.map((item: { call_id: string }) => item.call_id),
  ).toEqual(["private", "missing"]);
  expect(
    toolReplies()[0].items.map(
      (item: { content: { text: string }[] }) =>
        JSON.parse(item.content[0].text).ok,
    ),
  ).toEqual([false, false]);
  await handle.cancel();
});

it("cancels stale board work on manual navigation without closing microphone capture", async () => {
  let signal!: AbortSignal;
  const release = classroomCommands.register("canvas.text", "Write", (args) => {
    signal = args.signal as AbortSignal;
    return new Promise(() => {});
  });
  const handle = await startDuplexSpeech(callbacks());
  try {
    emit({
      type: "response.function_call_arguments.done",
      items: [call("old-page", "canvas.text")],
    });
    await vi.waitFor(() => expect(signal).toBeDefined());
    classroomCommands.invalidate();
    await vi.waitFor(() => expect(toolReplies()).toHaveLength(1));
    expect(signal.aborted).toBe(true);
    expect(JSON.parse(toolReplies()[0].items[0].content[0].text).ok).toBe(
      false,
    );
    expect(
      mocks.engine.send.mock.calls.some(
        ([value]) => value.event.type === "session.update",
      ),
    ).toBe(true);
    expect(capture.cancel).not.toHaveBeenCalled();
  } finally {
    await handle.cancel();
    release();
  }
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

it("runs explicit interruption immediately instead of waiting behind unfinished board work", async () => {
  let signal!: AbortSignal;
  const release = classroomCommands.register("canvas.text", "Write", (args) => {
    signal = args.signal as AbortSignal;
    return new Promise(() => {});
  });
  const stopped = vi.fn();
  const stop = classroomCommands.register("voice.interrupt", "Stop", stopped);
  const handle = await startDuplexSpeech(callbacks());
  try {
    emit({
      type: "response.function_call_arguments.done",
      items: [call("long-work", "canvas.text")],
    });
    await vi.waitFor(() => expect(signal).toBeDefined());
    emit({
      type: "response.function_call_arguments.done",
      items: [call("stop", "voice.interrupt")],
    });
    await vi.waitFor(() => expect(stopped).toHaveBeenCalledTimes(1));
    expect(signal.aborted).toBe(false);
    expect(capture.cancel).not.toHaveBeenCalled();
  } finally {
    await handle.cancel();
    release();
    stop();
  }
});

it("executes an independent later tool while an earlier call is unfinished, preserving dependent batch order", async () => {
  let finish!: () => void;
  const order: string[] = [];
  const releases = [
    classroomCommands.register(
      "canvas.text",
      "Write",
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    ),
    classroomCommands.register("canvas.select", "Select", () => {
      order.push("select");
    }),
    classroomCommands.register("canvas.style", "Style", () => {
      order.push("style");
    }),
  ];
  const handle = await startDuplexSpeech(callbacks());
  try {
    emit({
      type: "response.function_call_arguments.done",
      items: [call("slow", "canvas.text")],
    });
    await vi.waitFor(() => expect(finish).toBeDefined());
    emit({
      type: "response.function_call_arguments.done",
      items: [
        call("selection", "canvas.select"),
        call("style", "canvas.style"),
      ],
    });
    await vi.waitFor(() => expect(toolReplies()).toHaveLength(1));
    expect(order).toEqual(["select", "style"]);
    expect(toolReplies()[0].items[0].call_id).toBe("selection");
    finish();
    await vi.waitFor(() => expect(toolReplies()).toHaveLength(2));
  } finally {
    await handle.cancel();
    releases.forEach((release) => release());
  }
});

it("acknowledges long resource work immediately and keeps typed drawing and conversation live", async () => {
  let finish!: () => void;
  const draw = vi.fn((args) => ({ strokes: args.strokes }));
  const releases = [
    classroomCommands.register(
      "resources.generate",
      "Generate resource",
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    ),
    classroomCommands.register("canvas.ink", "Draw", draw),
    registerBoardAgents(),
  ];
  const view = callbacks();
  const handle = await startDuplexSpeech(view);
  try {
    emit({
      type: "response.function_call_arguments.done",
      items: [call("resource", "resources.generate", { prompt: "交互电路" })],
    });
    await vi.waitFor(() => expect(toolReplies()).toHaveLength(1));
    const result = JSON.parse(toolReplies()[0].items[0].content[0].text);
    expect(result).toMatchObject({
      ok: true,
      result: { state: "running", id: expect.any(String) },
    });
    emit({ type: "conversation.item.input_audio_transcription.started" });
    emit({
      type: "conversation.item.input_audio_transcription.completed",
      text: "再画苹果",
    });
    emit({
      type: "response.function_call_arguments.done",
      items: [
        {
          name: "board_draw",
          call_id: "draw",
          arguments: JSON.stringify({
            strokes: [
              [
                [20, 30],
                [40, 50],
              ],
            ],
            select: false,
          }),
        },
      ],
    });
    await vi.waitFor(() => expect(toolReplies()).toHaveLength(2));
    expect(JSON.parse(toolReplies()[1].items[0].content[0].text)).toMatchObject(
      {
        ok: true,
        result: { state: "running", command: "canvas.ink" },
      },
    );
    await vi.waitFor(() =>
      expect(draw).toHaveBeenCalledWith(
        expect.objectContaining({
          strokes: [
            [
              [20, 30],
              [40, 50],
            ],
          ],
          select: false,
        }),
      ),
    );
    expect(view.line).toHaveBeenCalledWith(
      expect.objectContaining({ text: "再画苹果" }),
    );
    expect(capture.cancel).not.toHaveBeenCalled();
    finish();
  } finally {
    await handle.cancel();
    releases.forEach((release) => release());
  }
});

it("keeps live dialogue independent of the removed lesson audio controller", async () => {
  const pause = vi.fn();
  const audio = vi
    .fn()
    .mockRejectedValue(new Error("Legacy lesson controller unavailable"));
  const releases = [
    classroomCommands.register("lesson.pause", "Pause", pause),
    classroomCommands.register("lesson.audio", "@internal", audio),
    classroomCommands.context("teacher", () => ({ mode: "teaching" })),
  ];
  const handle = await startDuplexSpeech(callbacks());
  try {
    emit({ type: "conversation.item.input_audio_transcription.started" });
    expect(audio).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    emit({ type: "response.canceled" });
    expect(audio).not.toHaveBeenCalled();
    emit({
      type: "conversation.item.input_audio_transcription.completed",
      text: "继续画图",
    });
    emit({ type: "response.done" });
    expect(audio).not.toHaveBeenCalled();
    expect(capture.cancel).not.toHaveBeenCalled();
  } finally {
    await handle.cancel();
    releases.forEach((release) => release());
  }
});

it("delivers a strong backend research answer through the same realtime synthesis connection after the user finishes", async () => {
  let finish!: (answer: string) => void;
  vi.spyOn(ai, "chat").mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const release = registerBoardAgents();
  const handle = await startDuplexSpeech(callbacks());
  try {
    emit({ type: "conversation.item.input_audio_transcription.started" });
    emit({
      type: "response.function_call_arguments.done",
      items: [
        {
          name: "board_task",
          call_id: "research",
          arguments: JSON.stringify({
            role: "research",
            prompt: "联网核实牛顿第一定律",
          }),
        },
      ],
    });
    await vi.waitFor(() => expect(finish).toBeDefined());
    finish("依据教材，无外力时物体保持静止或匀速直线运动。");
    await vi.waitFor(() =>
      expect(
        (classroomCommands.read("agents") as { state: string }[])[0].state,
      ).toBe("completed"),
    );
    expect(
      mocks.engine.send.mock.calls.some(
        ([value]) =>
          value.event.type === "speech_text_buffer.replacement.append",
      ),
    ).toBe(false);
    emit({
      type: "conversation.item.input_audio_transcription.completed",
      text: "继续",
    });
    emit({ type: "response.done" });
    await vi.waitFor(() =>
      expect(mocks.engine.send).toHaveBeenCalledWith(
        expect.objectContaining({
          event: {
            type: "speech_text_buffer.replacement.append",
            text: "依据教材，无外力时物体保持静止或匀速直线运动。",
          },
        }),
      ),
    );
    await vi.waitFor(() =>
      expect(mocks.engine.send).toHaveBeenCalledWith(
        expect.objectContaining({
          event: { type: "speech_text_buffer.replacement.commit" },
        }),
      ),
    );
    expect(capture.cancel).not.toHaveBeenCalled();
  } finally {
    await handle.cancel();
    release();
  }
});

it("commits one final transcript per utterance while retaining a repeated sentence in a new turn", async () => {
  const view = callbacks();
  const handle = await startDuplexSpeech(view);
  try {
    emit({ type: "conversation.item.input_audio_transcription.started" });
    emit({
      type: "conversation.item.input_audio_transcription.delta",
      text: "你好",
    });
    emit({
      type: "conversation.item.input_audio_transcription.completed",
      text: "你好",
    });
    emit({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "你好",
    });
    emit({
      type: "conversation.item.input_audio_transcription.completed",
      text: "你好",
      event_id: "final-repeat",
    });
    expect(view.line).toHaveBeenCalledTimes(1);
    emit({ type: "response.output_text.done", text: "你好，请讲。" });
    emit({ type: "response.output_text.done", text: "你好，请讲。" });
    expect(classroomCommands.read("conversation")).toEqual([
      { role: "user", content: "你好" },
      { role: "assistant", content: "你好，请讲。" },
    ]);
    emit({ type: "conversation.item.input_audio_transcription.started" });
    emit({
      type: "conversation.item.input_audio_transcription.completed",
      text: "你好",
    });
    expect(view.line).toHaveBeenCalledTimes(2);
  } finally {
    await handle.cancel();
  }
});

it("preserves repeated fragments when event_id is reused as correlation metadata", async () => {
  const view = callbacks();
  const handle = await startDuplexSpeech(view);
  try {
    emit({
      type: "response.output_text.delta",
      text: "正在",
      event_id: "text-1",
    });
    emit({
      type: "response.output_text.delta",
      text: "板书",
      event_id: "text-2",
    });
    emit({
      type: "response.output_text.delta",
      text: "板书",
      event_id: "text-2",
    });
    expect(view.caption).toHaveBeenLastCalledWith("正在板书板书");
    emit({ type: "response.output_text.done", text: "正在板书" });
    emit({
      type: "response.output_text.delta",
      delta: "哈",
      event_id: "word-1",
    });
    emit({
      type: "response.output_text.delta",
      delta: "哈",
      event_id: "word-1",
    });
    emit({
      type: "response.output_text.delta",
      delta: "哈",
      event_id: "word-2",
    });
    expect(view.caption).toHaveBeenLastCalledWith("哈哈哈");
  } finally {
    await handle.cancel();
  }
});

it.each(["实时语音连接中断", "AudioQueryError [50000000]"])(
  "recovers %s using the server dialog id without cancelling capture or unfinished tools",
  async (failure) => {
    const view = callbacks();
    let finish!: () => void;
    let request!: AbortSignal;
    const release = classroomCommands.register(
      "canvas.text",
      "Write",
      (args) => {
        request = args.signal as AbortSignal;
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
    );
    const handle = await startDuplexSpeech(view);
    const oldSession = session;
    let restore!: () => void;
    try {
      emit({ type: "session.created", session: { id: "provider-dialog" } });
      emit({
        type: "response.function_call_arguments.done",
        items: [call("unfinished", "canvas.text")],
      });
      await vi.waitFor(() => expect(finish).toBeDefined());
      mocks.engine.start.mockImplementationOnce((options) => {
        session = options.session;
        return new Promise((resolve) => {
          restore = () => resolve({ session });
        });
      });
      emit({ type: "error", message: failure });
      const transport = vi.mocked(startPCMSpeech).mock.calls[0][0];
      const pushes = mocks.engine.pushAudio.mock.calls.length;
      await transport.push({
        session: oldSession,
        pcm: "AAAA",
        sampleRate: 16000,
      });
      expect(mocks.engine.pushAudio).toHaveBeenCalledTimes(pushes);
      await vi.waitFor(() => expect(restore).toBeDefined());
      expect(session).not.toBe(oldSession);
      expect(mocks.engine.start).toHaveBeenLastCalledWith(
        expect.objectContaining({
          configuration: expect.objectContaining({
            session: expect.objectContaining({ id: "provider-dialog" }),
          }),
        }),
      );
      expect(request.aborted).toBe(false);
      expect(capture.cancel).not.toHaveBeenCalled();
      finish();
      restore();
      await vi.waitFor(() => expect(toolReplies()).toHaveLength(1));
      await transport.push({
        session: oldSession,
        pcm: "AAAA",
        sampleRate: 16000,
      });
      expect(mocks.engine.pushAudio).toHaveBeenLastCalledWith({
        session,
        pcm: "AAAA",
        sampleRate: 16000,
      });
      expect(view.error).not.toHaveBeenCalled();
      const captions = view.caption.mock.calls.length;
      receive({
        session: oldSession,
        event: { type: "response.output_text.delta", delta: "stale" },
      });
      expect(view.caption).toHaveBeenCalledTimes(captions);
    } finally {
      restore?.();
      await handle.cancel();
      release();
    }
  },
);

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

it("keeps listening after an isolated ASR failure and prunes long context using only actual old paired message ids", async () => {
  const view = callbacks();
  const release = classroomCommands.context("teacher", () => ({
    title: "牛顿第二定律",
    step: 6,
  }));
  const handle = await startDuplexSpeech(view);
  try {
    emit({ type: "conversation.item.input_audio_transcription.started" });
    emit({
      type: "conversation.item.input_audio_transcription.failed",
      message: "重说这句话",
    });
    expect(capture.cancel).not.toHaveBeenCalled();
    expect(view.error).not.toHaveBeenCalled();
    for (let i = 0; i < 8; i++) {
      emit({ type: "response.done" });
    }
    const retrieval = mocks.engine.send.mock.calls
      .map(([value]) => value.event)
      .find((event) => event.type === "conversation.item.retrieve");
    expect(retrieval).toEqual({
      type: "conversation.item.retrieve",
      event_id: expect.any(String),
    });
    emit({
      type: "conversation.item.retrieved",
      event_id: "retrieved",
      items: Array.from({ length: 32 }, (_, index) => ({
        id: `message-${index}`,
        role: index % 2 ? "assistant" : "user",
      })),
    });
    expect(mocks.engine.send).toHaveBeenCalledWith(
      expect.objectContaining({
        event: {
          type: "conversation.item.delete",
          items: [2, 4, 6].map((index) => ({ id: `message-${index}` })),
        },
      }),
    );
    expect(mocks.engine.send).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          type: "session.update",
          session: expect.objectContaining({
            instructions: expect.stringContaining("牛顿第二定律"),
          }),
        }),
      }),
    );
  } finally {
    await handle.cancel();
    release();
  }
});

it("retains the original user goal alongside recent turns and seeds only complete pairs when a dialog id was unavailable", async () => {
  const handle = await startDuplexSpeech(callbacks());
  try {
    for (let i = 0; i < 9; i++) {
      emit({ type: "conversation.item.input_audio_transcription.started" });
      emit({
        type: "conversation.item.input_audio_transcription.completed",
        text: i ? `问题${i}` : "用初中物理方式讲牛顿第一定律",
      });
      emit({ type: "response.output_text.done", text: `回答${i}` });
    }
    const history = classroomCommands.read("conversation") as {
      role: string;
      content: string;
    }[];
    expect(history).toHaveLength(14);
    expect(history[0]).toEqual({
      role: "user",
      content: "用初中物理方式讲牛顿第一定律",
    });
    expect(history[1]).toEqual({ role: "assistant", content: "回答0" });
    emit({ type: "error", message: "实时语音连接中断" });
    await vi.waitFor(() => expect(mocks.engine.start).toHaveBeenCalledTimes(2));
    const configuration = mocks.engine.start.mock.calls[1][0].configuration;
    const pairs = configuration.extension.dialog.dialog_context;
    expect(pairs).toHaveLength(14);
    expect(pairs[0]).toEqual({
      role: "user",
      text: "用初中物理方式讲牛顿第一定律",
    });
    expect(
      pairs.every(
        (item: { role: string }, index: number) =>
          item.role === (index % 2 ? "assistant" : "user"),
      ),
    ).toBe(true);
  } finally {
    await handle.cancel();
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

it("replaces revised live snapshots before finalization while retaining explicit repeated deltas", async () => {
  const view = callbacks();
  const handle = await startDuplexSpeech(view);
  try {
    emit({ type: "conversation.item.input_audio_transcription.started" });
    emit({
      type: "conversation.item.input_audio_transcription.delta",
      transcript: "今天是晴天",
    });
    emit({
      type: "conversation.item.input_audio_transcription.delta",
      transcript: "今天是雨天",
    });
    expect(view.caption).toHaveBeenLastCalledWith("今天是雨天");
    expect(view.interim).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "今天是雨天" }),
    );
    expect(view.line).not.toHaveBeenCalled();
    emit({
      type: "conversation.item.input_audio_transcription.delta",
      delta: "先画一个圆",
    });
    emit({
      type: "conversation.item.input_audio_transcription.delta",
      delta: "先画一个方形",
    });
    expect(view.caption).toHaveBeenLastCalledWith("先画一个方形");
    emit({ type: "response.output_text.delta", text: "哈" });
    emit({ type: "response.output_text.delta", text: "哈" });
    expect(view.caption).toHaveBeenLastCalledWith("哈哈");
    emit({ type: "response.output_text.delta", delta: "哈" });
    expect(view.caption).toHaveBeenLastCalledWith("哈哈哈");
  } finally {
    await handle.cancel();
  }
});
