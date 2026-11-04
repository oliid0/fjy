import { readFileSync, writeFileSync } from "node:fs";

import WebSocket from "ws";

import { startDuplexSpeech } from "./duplexSpeech";
import { calculateAsync } from "./mathComputation";
import { classroomCommands } from "./commands";
import { defaults, saveSettings } from "./settings";
import { encodePCM } from "./localSpeech";

const host = vi.hoisted(() => ({
  engine: {
    addListener: vi.fn(),
    start: vi.fn(),
    send: vi.fn(),
    stop: vi.fn(),
  },
  capture: vi.fn(),
  audio: vi.fn(),
}));
vi.mock("@capacitor/core", async (original) => ({
  ...(await original<typeof import("@capacitor/core")>()),
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => host.engine,
}));
vi.mock("./localSpeech", async (original) => ({
  ...(await original<typeof import("./localSpeech")>()),
  startPCMSpeech: host.capture,
}));
vi.mock("./duplexPlayer", () => ({
  createDuplexPlayer: () => ({
    enqueue: host.audio,
    interrupt: () => {},
    close: async () => {},
  }),
}));

/** A real provider test with a paced, synthesized Chinese microphone fixture.
 * Only the Android/WebAudio host is adapted; production session, event and tool code runs. */
it.runIf(process.env.FCBOARD_LIVE === "1" && !!process.env.voice_key)(
  "LIVE: transcribes Chinese, executes local board math, returns the true call result and receives streamed speech",
  async () => {
    const pcm = readFileSync("/tmp/fjy-live-duplex-input.pcm");
    const key = process.env.voice_key!;
    saveSettings(
      { ...defaults, speechKey: key, assistantVoice: "duplex" },
      false,
    );
    let receive!: (message: {
      session: string;
      event: Record<string, unknown>;
    }) => void;
    let socket: WebSocket | undefined;
    let clientSession = "";
    let closing = false;
    let cancelled = false;
    let pump = Promise.resolve();
    let audioBytes = 0;
    let spoken = "";
    let result: { expression: string; answer: string } | undefined;
    const transcript: string[] = [];
    const events: Record<string, number> = {};
    let pass!: () => void;
    let fail!: (error: Error) => void;
    const complete = new Promise<void>((resolve, reject) => {
      pass = resolve;
      fail = reject;
    });
    void complete.catch(() => {});
    const progress = () => {
      if (result?.answer === "2" && audioBytes > 0 && /2|二|两/.test(spoken)) {
        pass();
      }
    };
    host.engine.addListener.mockImplementation(async (_name, callback) => {
      receive = callback;
      return { remove: async () => {} };
    });
    host.engine.start.mockImplementation(
      (options) =>
        new Promise((resolve, reject) => {
          clientSession = options.session;
          socket = new WebSocket(
            "wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue",
            { headers: { "X-Api-Key": key }, handshakeTimeout: 12000 },
          );
          socket.on("open", () =>
            socket!.send(JSON.stringify(options.configuration)),
          );
          socket.on("message", (message) => {
            const event = JSON.parse(message.toString());
            events[event.type] = (events[event.type] || 0) + 1;
            receive({ session: clientSession, event });
            if (event.type === "session.created") {
              resolve({ session: clientSession });
            }
            if (event.type === "error") {
              reject(new Error(String(event.message || "Seeduplex error")));
            }
          });
          socket.on("unexpected-response", (_request, response) =>
            reject(new Error(`Seeduplex HTTP ${response.statusCode}`)),
          );
          socket.on("error", (error) => {
            if (!closing) {
              reject(error);
              receive({
                session: clientSession,
                event: { type: "error", message: error.message },
              });
            }
          });
        }),
    );
    host.engine.send.mockImplementation(async ({ event }) => {
      socket!.send(JSON.stringify(event));
    });
    host.engine.stop.mockImplementation(async () => {
      closing = true;
      socket?.terminate();
    });
    host.audio.mockImplementation(async (value: string) => {
      audioBytes += Buffer.from(value, "base64").length;
      progress();
    });
    host.capture.mockImplementation(async (transport) => {
      await transport.start();
      pump = (async () => {
        let offset = 0;
        while (!cancelled) {
          const bytes =
            offset < pcm.length
              ? pcm.subarray(offset, Math.min(offset + 640, pcm.length))
              : Buffer.alloc(640);
          offset += 640;
          const samples = new Float32Array(Math.floor(bytes.length / 2));
          for (let i = 0; i < samples.length; i++) {
            samples[i] = bytes.readInt16LE(i * 2) / 32768;
          }
          await transport.push({
            session: clientSession,
            pcm: encodePCM(samples),
            sampleRate: 16000,
          });
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      })();
      void pump.catch((error) => fail(error));
      return {
        stop: async () => {},
        cancel: async () => {
          cancelled = true;
          await pump.catch(() => {});
        },
      };
    });
    const release = classroomCommands.register(
      "math.evaluate",
      "使用本地计算器验证args.expression，返回真实expression与answer；不写板。",
      async (args) => {
        const expression = String(args.expression);
        result = { expression, answer: await calculateAsync(expression) };
        progress();
        return result;
      },
    );
    let handle: Awaited<ReturnType<typeof startDuplexSpeech>> | undefined;
    const timer = setTimeout(
      () => fail(new Error("Real duplex turn timed out")),
      45000,
    );
    try {
      handle = await startDuplexSpeech({
        line: (line) => transcript.push(line.text),
        interim: () => {},
        caption: (text) => {
          spoken = text;
          progress();
        },
        state: () => {},
        status: () => {},
        error: (message) =>
          fail(new Error(message.replaceAll(key, "[redacted]"))),
      });
      await complete;
      expect(result).toEqual({ expression: "1+1", answer: "2" });
      expect(events["response.function_call_arguments.done"]).toBeGreaterThan(
        0,
      );
      expect(
        host.engine.send.mock.calls.some(
          ([value]) => value.event.type === "conversation.item.create",
        ),
      ).toBe(true);
    } finally {
      clearTimeout(timer);
      cancelled = true;
      await handle?.cancel();
      closing = true;
      socket?.terminate();
      release();
      writeFileSync(
        "/tmp/fjy-live-duplex-report.json",
        JSON.stringify(
          { transcript, reply: spoken, result, audioBytes, events },
          null,
          2,
        ),
      );
    }
  },
  60000,
);
