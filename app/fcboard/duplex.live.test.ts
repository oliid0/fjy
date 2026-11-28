import WebSocket from "ws";
import { it } from "vitest";

import { startDuplexSpeech } from "./duplexSpeech";
import { defaults, saveSettings } from "./settings";

const host = vi.hoisted(() => ({
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
  registerPlugin: () => host.engine,
}));

/** Opt-in provider verification: no microphone, fixture audio, visual model or extra reasoning request. */
it.runIf(process.env.FCBOARD_LIVE === "1" && !!process.env.voice_key)(
  "LIVE: streams supplied agent text to Seeduplex and receives PCM with no upstream audio",
  async () => {
    saveSettings({ ...defaults, speechKey: process.env.voice_key! }, false);
    let receive!: (value: {
      session: string;
      event: Record<string, unknown>;
    }) => void;
    let socket: WebSocket | undefined;
    let bytes = 0;
    let audio!: () => void;
    let fail!: (error: Error) => void;
    const heard = new Promise<void>((resolve, reject) => {
      audio = resolve;
      fail = reject;
    });
    void heard.catch(() => {});
    host.engine.addListener.mockImplementation(async (_name, callback) => {
      receive = callback;
      return { remove: async () => {} };
    });
    host.engine.start.mockImplementation(
      ({ session, key, configuration }) =>
        new Promise((resolve, reject) => {
          socket = new WebSocket(
            "wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue",
            { headers: { "X-Api-Key": key } },
          );
          socket.on("open", () => socket!.send(JSON.stringify(configuration)));
          socket.on("error", reject);
          socket.on("message", (data) => {
            const event = JSON.parse(data.toString());
            receive({ session, event });
            if (event.type === "session.created") resolve({ session });
            if (event.type === "response.output_audio.delta") {
              bytes += Buffer.from(event.audio || event.delta, "base64").length;
              audio();
            }
            if (event.type === "error")
              reject(new Error("Speech provider error"));
          });
        }),
    );
    host.engine.send.mockImplementation(async ({ event }) => {
      expect(event.type).not.toBe("input_audio_buffer.append");
      socket!.send(JSON.stringify(event));
    });
    host.engine.interruptAudio.mockResolvedValue(undefined);
    host.engine.stop.mockImplementation(async () => {
      socket?.close();
    });
    const timer = setTimeout(
      () => fail(new Error("Speech output timed out")),
      45000,
    );
    const handle = await startDuplexSpeech({
      caption: () => {},
      state: () => {},
      error: (message) => fail(new Error(message)),
    });
    try {
      const reply = handle.reply();
      reply.update("我已经画好了");
      await reply.finish("我已经画好了三角形。");
      await heard;
      expect(bytes).toBeGreaterThan(0);
    } finally {
      clearTimeout(timer);
      await handle.cancel();
    }
  },
  60000,
);
