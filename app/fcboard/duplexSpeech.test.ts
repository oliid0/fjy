import { waitFor } from "@testing-library/react";

import { startDuplexSpeech } from "./duplexSpeech";
import { defaults, saveSettings } from "./settings";

const mocks = vi.hoisted(() => ({
  engine: {
    addListener: vi.fn(),
    start: vi.fn(),
    send: vi.fn(),
    stop: vi.fn(),
    interruptAudio: vi.fn(),
  },
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => mocks.engine,
}));
let receive: (message: {
  session: string;
  event: Record<string, unknown>;
}) => void;
let session: string;
const emit = (event: Record<string, unknown>, id = session) =>
  receive({ session: id, event });
const view = () => ({ caption: vi.fn(), state: vi.fn(), error: vi.fn() });
const events = () => mocks.engine.send.mock.calls.map(([input]) => input.event);
beforeEach(() => {
  vi.resetAllMocks();
  saveSettings({ ...defaults, speechKey: "speech-key" }, false);
  mocks.engine.addListener.mockImplementation(async (_name, callback) => {
    receive = callback;
    return { remove: vi.fn() };
  });
  mocks.engine.start.mockImplementation(async (options) => {
    session = options.session;
    return { session };
  });
  mocks.engine.send.mockImplementation(async ({ event }) => {
    if (event.type === "response.cancel")
      queueMicrotask(() => emit({ type: "response.canceled" }));
  });
  mocks.engine.stop.mockResolvedValue(undefined);
  mocks.engine.interruptAudio.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
});

it("starts an output-only session with official mute, selected voice and speed, without audio/video input", async () => {
  saveSettings(
    {
      ...defaults,
      speechKey: "speech-key",
      speechVoice: "my-voice",
      speechSpeed: 20,
    },
    false,
  );
  const handle = await startDuplexSpeech(view());
  try {
    expect(mocks.engine.start.mock.calls[0][0]).toMatchObject({
      configuration: {
        session: {
          model: "1.2.6.1",
          audio: { output: { voice: "my-voice", speed: 20 } },
          tools: [],
        },
      },
    });
    expect(mocks.engine.start.mock.calls[0][0]).not.toHaveProperty("capture");
    expect(events().map((event) => event.type)).toEqual([
      "input_audio_mute.commit",
    ]);
  } finally {
    await handle.cancel();
  }
});

it("streams exact agent text before completion and sends one commit without another model", async () => {
  const handle = await startDuplexSpeech(view());
  try {
    const reply = handle.reply();
    reply.update("我已经");
    await waitFor(() =>
      expect(events()).toContainEqual(
        expect.objectContaining({
          type: "speech_text_buffer.replacement.append",
          text: "我已经",
        }),
      ),
    );
    expect(
      events().some(
        (event) => event.type === "speech_text_buffer.replacement.commit",
      ),
    ).toBe(false);
    reply.update("我已经画好了");
    await reply.finish("我已经画好了");
    expect(
      events()
        .filter(
          (event) => event.type === "speech_text_buffer.replacement.append",
        )
        .map((event) => event.text),
    ).toEqual(["我已经", "画好了"]);
    expect(
      events().filter(
        (event) => event.type === "speech_text_buffer.replacement.commit",
      ),
    ).toHaveLength(1);
  } finally {
    await handle.cancel();
  }
});

it("keeps old audio until a new agent produces text, then suppresses all late old deltas", async () => {
  const handle = await startDuplexSpeech(view());
  try {
    const old = handle.reply();
    old.update("我已经画");
    await waitFor(() =>
      expect(events().some((event) => event.text === "我已经画")).toBe(true),
    );
    const next = handle.reply();
    expect(mocks.engine.interruptAudio).toHaveBeenCalledTimes(0);
    next.update("好的，已改成正方形");
    await next.finish("好的，已改成正方形");
    old.update("我已经画好了三角形");
    await old.finish("我已经画好了三角形");
    expect(mocks.engine.interruptAudio).toHaveBeenCalledTimes(1);
    expect(
      events()
        .filter((event) => event.type.endsWith(".append"))
        .at(-1)?.text,
    ).toBe("好的，已改成正方形");
  } finally {
    await handle.cancel();
  }
});

it("uses synthesized text for stable subtitles, rather than displaying agent tokens ahead of speech", async () => {
  vi.useFakeTimers();
  const callbacks = view();
  const handle = await startDuplexSpeech(callbacks);
  try {
    emit({ type: "response.output_text.delta", delta: "我已经" });
    emit({ type: "response.output_text.delta", delta: "画好了" });
    expect(callbacks.caption).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(120);
    expect(callbacks.caption.mock.calls).toEqual([["我已经画好了"]]);
    emit({ type: "response.output_text.done", text: "我已经画好了。" });
    expect(callbacks.caption).toHaveBeenLastCalledWith("我已经画好了。");
  } finally {
    await handle.cancel();
  }
});

it("reopens and mutes each disconnected output session without taking the microphone", async () => {
  const handle = await startDuplexSpeech(view());
  try {
    for (let index = 0; index < 4; index++) {
      emit({ type: "session.closed" });
      await waitFor(() =>
        expect(mocks.engine.start).toHaveBeenCalledTimes(index + 2),
      );
      await waitFor(() =>
        expect(
          events().filter((event) => event.type === "input_audio_mute.commit"),
        ).toHaveLength(index + 2),
      );
    }
  } finally {
    await handle.cancel();
  }
});

it("ignores events after close and cancels only the current reply on abort", async () => {
  const callbacks = view();
  const handle = await startDuplexSpeech(callbacks);
  const abort = new AbortController();
  const reply = handle.reply(abort.signal);
  reply.update("正在讲解");
  await waitFor(() =>
    expect(events().some((event) => event.text === "正在讲解")).toBe(true),
  );
  abort.abort();
  reply.update("不可播报");
  await reply.finish("不可播报");
  await handle.cancel();
  emit({ type: "response.output_text.done", text: "late" });
  expect(callbacks.caption).not.toHaveBeenCalledWith("late");
  expect(events().some((event) => event.text === "不可播报")).toBe(false);
});
