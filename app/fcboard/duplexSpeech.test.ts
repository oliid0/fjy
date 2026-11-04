import { startDuplexSpeech } from "./duplexSpeech";
import { startPCMSpeech } from "./localSpeech";
import { classroomCommands } from "./commands";
import { defaults, saveSettings } from "./settings";

const mocks = vi.hoisted(() => ({
  engine: {
    addListener: vi.fn(),
    start: vi.fn(),
    send: vi.fn(),
    stop: vi.fn(),
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
  mocks.engine.stop.mockResolvedValue(undefined);
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

it("uses the documented duplex configuration and 20 ms capture, with the speech key only", async () => {
  const handle = await startDuplexSpeech(callbacks());
  expect(mocks.engine.start).toHaveBeenCalledWith(
    expect.objectContaining({
      key: "speech-key",
      configuration: {
        type: "session.create",
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
    { blockDuration: 0.02 },
  );
  const transport = vi.mocked(startPCMSpeech).mock.calls[0][0];
  await transport.push({ session, pcm: "AAAA", sampleRate: 16000 });
  expect(mocks.engine.send).toHaveBeenLastCalledWith({
    session,
    event: { type: "input_audio_buffer.append", audio: "AAAA" },
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
    expect(signal.aborted).toBe(true);
    expect(capture.cancel).not.toHaveBeenCalled();
  } finally {
    await handle.cancel();
    release();
    stop();
  }
});
