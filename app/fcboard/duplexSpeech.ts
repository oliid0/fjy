import { Capacitor, registerPlugin } from "@capacitor/core";
import { t } from "@fcboard/fcboard/i18n";

import { currentSettings } from "./settings";

import type { PluginListenerHandle } from "@capacitor/core";

type Event = Record<string, unknown>;
const engine = registerPlugin<{
  addListener(
    name: "event",
    receive: (value: { session: string; event: Event }) => void,
  ): Promise<PluginListenerHandle>;
  start(options: {
    session: string;
    key: string;
    configuration: Event;
  }): Promise<{ session: string }>;
  send(options: { session: string; event: Event }): Promise<void>;
  stop(options: { session: string }): Promise<void>;
  interruptAudio(options: { session: string }): Promise<void>;
}>("FcboardDuplexSpeech");

export type SpeechReply = {
  update(text: string): void;
  finish(text: string): Promise<void>;
  cancel(): void;
};
export type DuplexSpeechHandle = {
  reply(signal?: AbortSignal): SpeechReply;
  speak(text: string, signal?: AbortSignal): Promise<void>;
  interrupt(): Promise<void>;
  cancel(): Promise<void>;
};

/** PDF pp.125–137: output-only Seeduplex. No microphone or visual input exists here. */
export const startDuplexSpeech = async (options: {
  caption: (text: string) => void;
  state: (state: "listening" | "thinking" | "speaking") => void;
  error: (message: string) => void;
  signal?: AbortSignal;
}): Promise<DuplexSpeechHandle> => {
  options.signal?.throwIfAborted();
  if (!Capacitor.isNativePlatform())
    throw new Error(
      t("fcboard.use_the_android_app_for_direct_doubao_cloud_speech"),
    );
  const key = currentSettings().speechKey.trim();
  if (!key)
    throw new Error(
      t("fcboard.enter_your_doubao_speech_api_key_in_voice_settings"),
    );
  let session = "";
  let closed = false;
  let ready = false;
  let opening: Promise<void> | undefined;
  let configurationKey = "";
  let sequence = Promise.resolve();
  let epoch = 0;
  let inputOrder = 0;
  let latestReply = 0;
  let replyActive = false;
  let playing = false;
  let caption = "";
  let captionTimer: ReturnType<typeof setTimeout> | undefined;
  let cancelled: (() => void) | undefined;
  const send = (event: Event) =>
    engine.send({
      session,
      event: { ...event, event_id: crypto.randomUUID() },
    });
  const showCaption = (text: string, final = false) => {
    caption = text;
    if (final) {
      clearTimeout(captionTimer);
      captionTimer = undefined;
      options.caption(caption);
    } else if (!captionTimer)
      captionTimer = setTimeout(() => {
        captionTimer = undefined;
        if (!closed) options.caption(caption);
      }, 120);
  };
  const ensure = (): Promise<void> => {
    if (closed)
      return Promise.reject(new DOMException("Speech closed", "AbortError"));
    const settings = currentSettings();
    const desired = JSON.stringify([
      settings.speechKey,
      settings.speechVoice,
      settings.speechSpeed,
    ]);
    if (ready && desired === configurationKey) return Promise.resolve();
    if (ready) ready = false;
    if (opening) return opening;
    opening = (async () => {
      let failure: unknown;
      for (let attempt = 0; attempt < 3 && !closed; attempt++) {
        if (session) await engine.stop({ session }).catch(() => {});
        session = crypto.randomUUID();
        try {
          await engine.start({
            session,
            key: settings.speechKey.trim(),
            configuration: {
              type: "session.create",
              session: {
                model: "1.2.6.1",
                instructions:
                  "Speak only the supplied replacement text. Do not reason, use tools or generate your own replies.",
                audio: {
                  input: { format: { type: "pcm", rate: 16000 } },
                  output: {
                    format: { type: "pcm_s16le", rate: 24000 },
                    voice:
                      currentSettings().speechVoice.trim() ||
                      "zh_female_vv_jupiter_bigtts",
                    speed: Math.max(
                      -50,
                      Math.min(100, currentSettings().speechSpeed || 0),
                    ),
                  },
                },
                tools: [],
              },
            },
          });
          if (closed) {
            await engine.stop({ session });
            return;
          }
          // Official application-level mute keeps a session alive without upstream audio.
          await send({ type: "input_audio_mute.commit" });
          ready = true;
          configurationKey = desired;
          return;
        } catch (error) {
          failure = error;
          if (/HTTP\s*(401|403)|InvalidSpeaker|permission/i.test(String(error)))
            break;
          if (!closed && attempt < 2)
            await new Promise((resolve) =>
              setTimeout(resolve, 250 * 2 ** attempt),
            );
        }
      }
      throw failure || new Error("Speech connection unavailable");
    })().finally(() => {
      opening = undefined;
    });
    return opening;
  };
  const listener = await engine.addListener(
    "event",
    ({ session: id, event }) => {
      if (closed || id !== session) return;
      const type = event.type;
      if (type === "response.canceled") {
        cancelled?.();
        cancelled = undefined;
      }
      if (type === "audio.playing") {
        playing = !!event.playing;
        options.state(playing ? "speaking" : "listening");
      }
      if (type === "response.done") replyActive = false;
      // Service text follows actual synthesis segments, rather than raw agent token updates.
      if (
        type === "response.output_text.delta" &&
        typeof (event.delta || event.text) === "string"
      )
        showCaption(caption + (event.delta || event.text));
      if (
        type === "response.output_text.done" &&
        typeof event.text === "string"
      )
        showCaption(event.text, true);
      if (type === "error" || type === "session.closed") {
        const reconnect = ready;
        ready = false;
        epoch++;
        replyActive = false;
        playing = false;
        cancelled?.();
        cancelled = undefined;
        if (reconnect) {
          options.state("listening");
          void ensure().catch((error) => {
            if (!closed)
              options.error(
                error instanceof Error ? error.message : String(error),
              );
          });
        }
      }
    },
  );
  const interrupt = async () => {
    epoch++;
    clearTimeout(captionTimer);
    captionTimer = undefined;
    caption = "";
    if (!ready || closed || (!replyActive && !playing)) return;
    replyActive = false;
    playing = false;
    const acknowledgement = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (cancelled === finish) cancelled = undefined;
        resolve();
      }, 1200);
      const finish = () => {
        clearTimeout(timer);
        resolve();
      };
      cancelled = finish;
    });
    await engine.interruptAudio({ session });
    await send({ type: "response.cancel" });
    await acknowledgement;
    caption = "";
  };
  const reply = (signal?: AbortSignal): SpeechReply => {
    const order = ++inputOrder;
    let version: number | undefined;
    let text = "";
    let abandoned = false;
    let committed = false;
    const current = () =>
      !closed && !abandoned && !signal?.aborted && order >= latestReply;
    const enqueue = (run: () => Promise<void>) => {
      const next = sequence.then(async () => {
        if (current()) await run();
      });
      sequence = next.catch(() => {});
      return next;
    };
    const update = (value: string) => {
      if (!current() || committed || !value || value === text) return;
      const previous = text;
      text = value;
      const delta = value.startsWith(previous)
        ? value.slice(previous.length)
        : value;
      void enqueue(async () => {
        await ensure();
        if (!current()) return;
        const restart =
          version === undefined ||
          version !== epoch ||
          !value.startsWith(previous);
        if (restart) {
          await interrupt();
          if (!current()) return;
          latestReply = order;
          version = epoch;
          caption = "";
        }
        if (version !== epoch || !current()) return;
        replyActive = true;
        await send({
          type: "speech_text_buffer.replacement.append",
          text: restart ? value : delta,
        });
      }).catch((error) => {
        if (current())
          options.error(error instanceof Error ? error.message : String(error));
      });
    };
    const abort = () => {
      abandoned = true;
      if (version === epoch) void interrupt().catch(() => {});
    };
    signal?.addEventListener("abort", abort, { once: true });
    return {
      update,
      finish: async (value) => {
        update(value);
        committed = true;
        try {
          await enqueue(async () => {
            if (version === epoch && text)
              await send({ type: "speech_text_buffer.replacement.commit" });
          });
        } finally {
          signal?.removeEventListener("abort", abort);
        }
      },
      cancel: () => {
        signal?.removeEventListener("abort", abort);
        abort();
      },
    };
  };
  const cancel = async () => {
    if (closed) return;
    closed = true;
    ready = false;
    epoch++;
    clearTimeout(captionTimer);
    cancelled?.();
    cancelled = undefined;
    options.signal?.removeEventListener("abort", onAbort);
    await engine.stop({ session }).catch(() => {});
    await opening?.catch(() => {});
    await listener.remove();
  };
  const onAbort = () => {
    void cancel();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    await ensure();
    options.signal?.throwIfAborted();
  } catch (error) {
    await cancel();
    throw error;
  }
  return {
    reply,
    speak: (text, signal) => reply(signal).finish(text),
    interrupt,
    cancel,
  };
};
