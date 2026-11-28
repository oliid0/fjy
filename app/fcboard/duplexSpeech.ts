import { Capacitor, registerPlugin } from "@capacitor/core";

import { t } from "@fcboard/fcboard/i18n";

import { recognitionPattern } from "./recognitionVocabulary";
import { aiLanguagePolicy } from "./aiLocale";

import { classroomCommands } from "./commands";
import { createDuplexPlayer } from "./duplexPlayer";
import { startPCMSpeech } from "./localSpeech";
import { currentSettings } from "./settings";
import { runVoiceAgent } from "./voiceAgent";
import { speechExtension } from "./speechContext";

import type { PluginListenerHandle } from "@capacitor/core";
import type { LocalSpeechHandle } from "./localSpeech";
import type { TranscriptLine } from "./speech";
import type { Message } from "./ai";
import type { BoardTask } from "./boardAgents";

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
    capture?: boolean;
    playback?: boolean;
  }): Promise<{ session: string }>;
  send(options: { session: string; event: Event }): Promise<void>;
  pushAudio(options: {
    session: string;
    pcm: string;
    sampleRate: number;
  }): Promise<void>;
  stop(options: { session: string }): Promise<void>;
  audioCapabilities(): Promise<{ nativeAudio: boolean }>;
  interruptAudio(options: { session: string }): Promise<void>;
  captureMode(options: {
    session: string;
    mode: "native" | "shared" | "muted";
  }): Promise<void>;
}>("FcboardDuplexSpeech");

export type DuplexSpeechHandle = LocalSpeechHandle & {
  readonly startedAt: number;
  readonly stream?: MediaStream;
  interrupt(): Promise<void>;
  flush(): Promise<void>;
  speak(text: string): Promise<void>;
  prepareRecording?(): Promise<void>;
  useRecordingStream?(stream: MediaStream): Promise<void>;
  restoreCapture?(): Promise<void>;
};

const instructions = () =>
  `${aiLanguagePolicy(
    "input",
  )}\nTranscribe the user's speech. The application executes whiteboard requests using its live command router and supplies the actual reply through speech_text_buffer.replacement. Never announce that a board operation is complete yourself. Do not call tools or invent actions.`;

/** Supplied speech PDF pp.125–137, confirmed against official web_duplex_demo:
 * JSON frames, native-paced 20 ms PCM input, PCM16/24 kHz output and call_id results. */
export const startDuplexSpeech = async (options: {
  line: (line: TranscriptLine) => void;
  interim: (line: TranscriptLine | null) => void;
  caption: (text: string) => void;
  state: (state: "listening" | "thinking" | "speaking") => void;
  status: (message: string) => void;
  error: (message: string) => void;
  stream?: MediaStream;
  signal?: AbortSignal;
  visualFrame?: (
    previousStamp?: string,
    immediate?: boolean,
  ) => Promise<{ stamp: string; image: string } | undefined>;
}): Promise<DuplexSpeechHandle> => {
  options.signal?.throwIfAborted();
  if (!Capacitor.isNativePlatform()) {
    throw new Error(
      t("fcboard.use_the_android_app_for_direct_doubao_cloud_speech"),
    );
  }
  const key = currentSettings().speechKey.trim();
  if (!key) {
    throw new Error(
      t("fcboard.enter_your_doubao_speech_api_key_in_voice_settings"),
    );
  }
  let session = crypto.randomUUID();
  let nativeAudio = false;
  try {
    nativeAudio = (await engine.audioCapabilities()).nativeAudio;
  } catch {
    /* Older installed shells retain their existing shared capture path. */
  }
  let nativeCaptureRequested = !options.stream;
  let nativeReady = false;
  let dialogId: string | undefined;
  const startedAt = Date.now();
  let closed = false;
  let closing = false;
  let recovering = false;
  let recovery: Promise<void> | undefined;
  let recoveryAttempts = 0;
  let finishing: Promise<void> | undefined;
  let capture: LocalSpeechHandle | undefined;
  let input = "";
  let reply = "";
  let inputAt = 0;
  let inputCommitted = false;
  let turns = 0;
  let contextRequest: string | undefined;
  let contextRequestedAt = 0;
  let initialUserId: string | undefined;
  let speaking = false;
  let queued = 0;
  let responding = false;
  let inputActive = false;
  let audioTransfers = 0;
  let visualTimer: ReturnType<typeof setInterval> | undefined;
  let visualStamp: string | undefined;
  let sendingFrame: Promise<void> | undefined;
  let lastFrameSent = -Infinity;
  const frameInterval = 550;
  const conversationHistory: Message[] = [];
  const initialConversation: Message[] = [];
  const conversationMessages = () => [
    ...initialConversation.filter(
      (item) => !conversationHistory.includes(item),
    ),
    ...conversationHistory,
  ];
  const remember = (role: "user" | "assistant", content: string) => {
    if (content.trim()) {
      const message: Message = { role, content: content.slice(0, 4000) };
      conversationHistory.push(message);
      if (
        (!initialConversation.length && role === "user") ||
        (initialConversation.length === 1 && role === "assistant")
      ) {
        initialConversation.push(message);
      }
      if (conversationHistory.length > 12) {
        conversationHistory.shift();
      }
    }
  };
  const releaseConversation = classroomCommands.context(
    "conversation",
    conversationMessages,
  );
  let flush:
    | { resolve: () => void; reject: (error: Error) => void }
    | undefined;
  const pending = new Set<AbortController>();
  let execution = Promise.resolve();
  const taskScope = new AbortController();
  let replying = false;
  const announcements: { text: string; taskId?: string }[] = [];
  const boardTasks = () =>
    (classroomCommands.read("agents") as BoardTask[] | undefined) || [];
  const taskFailure = (error: unknown) => console.error("[voice-task]", error);
  const state = () => {
    if (!closed) {
      options.state(speaking ? "speaking" : queued ? "thinking" : "listening");
      void announce().catch(taskFailure);
    }
  };
  const player = nativeAudio
    ? undefined
    : createDuplexPlayer((playing) => {
        speaking = playing;
        state();
      });
  const interruptPlayer = () => {
    if (nativeAudio) {
      void engine.interruptAudio({ session }).catch(taskFailure);
    } else {
      player?.interrupt();
    }
  };
  const configuration = (): Event => ({
    type: "session.create",
    extension: {
      ...speechExtension(),
      ...(options.visualFrame
        ? { video: { frame_format: "JPEG", frame_rate: 2 } }
        : {}),
      // If a connection failed before returning its id, initialize only complete
      // locally retained QA pairs, as required by the dialog_context contract.
      ...(!dialogId && conversationHistory.length
        ? {
            dialog: {
              dialog_context: conversationMessages().flatMap(
                (message, index, messages) =>
                  message.role === "user" &&
                  messages[index + 1]?.role === "assistant"
                    ? [message, messages[index + 1]].map((item) => ({
                        role: item.role,
                        text: item.content,
                      }))
                    : [],
              ),
            },
          }
        : {}),
    },
    session: {
      ...(dialogId ? { id: dialogId } : {}),
      model: options.visualFrame ? "1.3.0.0" : "1.2.6.1",
      instructions: instructions(),
      audio: {
        input: { format: { type: "pcm", rate: 16000 } },
        output: {
          format: { type: "pcm_s16le", rate: 24000 },
          voice: "zh_female_vv_jupiter_bigtts",
        },
      },
      tools: [],
    },
  });
  // Native transport supplies HTTP/status text; retry transport failures only.
  const recoverable = (failure: unknown) => {
    const message =
      failure instanceof Error ? failure.message : String(failure);
    if (
      /InvalidSpeaker|volc_websearch_.*required|ExceededConcurrentDurationLimit/i.test(
        message,
      )
    ) {
      return false;
    }
    const http = /HTTP\s*(\d{3})/i.exec(message);
    return http
      ? Number(http[1]) >= 500 || [408, 429].includes(Number(http[1]))
      : recognitionPattern("duplexSpeech_0").test(message);
  };
  const fatal = (error: unknown) => {
    if (!closed && !closing) {
      options.error(error instanceof Error ? error.message : String(error));
      void finish(true).catch(() => {});
    }
  };
  const reconnect = () => {
    if (recovery) {
      return recovery;
    }
    recovering = true;
    responding = false;
    inputActive = false;
    input = "";
    reply = "";
    inputCommitted = false;
    contextRequest = undefined;
    if (!dialogId) {
      initialUserId = undefined;
    }
    interruptPlayer();

    options.interim(null);
    options.status(t("fcboard.aiMessages.voiceRecovering"));
    recovery = (async () => {
      let failure: unknown = new Error(
        t("fcboard.aiMessages.voiceRecoveryFailed"),
      );
      while (!closed && !closing && recoveryAttempts < 3) {
        const attempt = ++recoveryAttempts;
        await engine.stop({ session }).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        if (closed || closing) {
          return;
        }
        session = crypto.randomUUID();
        try {
          await engine.start({
            session,
            key,
            configuration: configuration(),
            capture: nativeAudio && nativeCaptureRequested,
            playback: nativeAudio,
          });
          if (closed || closing) {
            await engine.stop({ session });
            return;
          }
          options.status(t("fcboard.aiMessages.voiceRecovered"));
          return;
        } catch (error) {
          failure = error;
          if (!recoverable(error)) {
            throw error;
          }
        }
      }
      if (!closed && !closing) {
        throw failure;
      }
    })().finally(() => {
      recovering = false;
      recovery = undefined;
      state();
    });
    return recovery;
  };
  const send = async (event: Event, current = () => true) => {
    if (closed) {
      return;
    }
    if (recovery) {
      await recovery;
    }
    if (closed || !current()) {
      return;
    }
    try {
      await engine.send({ session, event });
    } catch (failure) {
      if ((!nativeReady && !capture) || closing || !recoverable(failure)) {
        throw failure;
      }
      await reconnect().catch((error) => {
        // A transport exhausted its retries; task-only error handlers must not
        // leave the UI accepting a dead microphone/socket as live.
        fatal(error);
        throw error;
      });
      if (!closed && !closing && current()) {
        await engine.send({ session, event });
      }
    }
  };
  const announce = async () => {
    if (
      closed ||
      closing ||
      recovering ||
      responding ||
      inputActive ||
      speaking ||
      audioTransfers ||
      !announcements.length
    ) {
      return;
    }
    let answer: string | undefined;
    while (announcements.length) {
      const next = announcements.shift()!;
      if (next.taskId) {
        const task = boardTasks().find((task) => task.id === next.taskId);
        if (!task || task.state === "cancelled") {
          continue;
        }
      }
      answer = next.text;
      break;
    }
    if (!answer) {
      return;
    }
    responding = true;
    replying = true;
    reply = "";
    remember("assistant", answer);

    // Official replacement events synthesize backend text on the same live connection.
    await send({ type: "speech_text_buffer.replacement.append", text: answer });
    await send({ type: "speech_text_buffer.replacement.commit" });
  };
  const report = (error: unknown) => {
    if (closed || closing || recovering) {
      return;
    }
    if ((nativeReady || capture) && recoverable(error)) {
      void reconnect().catch(fatal);
    } else {
      fatal(error);
    }
  };
  const cancelTasks = () => {
    announcements.length = 0;
    pending.forEach((request) => request.abort());
    pending.clear();
  };
  const interrupt = async () => {
    announcements.length = 0;
    interruptPlayer();
    await send({ type: "response.cancel" });
  };
  const sendVisualFrame = (afterTools = false): Promise<void> => {
    const capture = options.visualFrame;
    if (!capture || closed || closing || recovering || document.hidden) {
      return Promise.resolve();
    }
    if (sendingFrame) {
      return afterTools
        ? sendingFrame.then(() => sendVisualFrame(true))
        : sendingFrame;
    }
    const remaining = frameInterval - (performance.now() - lastFrameSent);
    if (!afterTools && remaining > 0) {
      return Promise.resolve();
    }
    const currentSession = session;
    const currentRevision = classroomCommands.revision;
    const current = () =>
      !closed &&
      !closing &&
      !recovering &&
      !document.hidden &&
      session === currentSession &&
      classroomCommands.revision === currentRevision;
    sendingFrame = (async () => {
      if (remaining > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, remaining));
      }
      if (!current()) {
        return;
      }
      const frame = await (afterTools
        ? capture(visualStamp, true)
        : capture(visualStamp));
      const jpeg = "data:image/jpeg;base64,";
      if (frame && current() && frame.image.startsWith(jpeg)) {
        await send(
          {
            type: "input_image_buffer.append",
            frame_id: crypto.randomUUID(),
            image: frame.image.slice(jpeg.length),
          },
          current,
        );
        lastFrameSent = performance.now();
        if (current()) {
          visualStamp = frame.stamp;
        }
      }
    })()
      .catch(taskFailure)
      .finally(() => {
        sendingFrame = undefined;
      });
    return sendingFrame;
  };
  const executeTurn = (utterance: string) => {
    if (closed || closing) {
      return;
    }
    const request = new AbortController();
    pending.add(request);
    queued++;
    state();
    execution = execution.then(async () => {
      try {
        request.signal.throwIfAborted();
        const history = conversationMessages();
        remember("user", utterance);
        const answer = await runVoiceAgent(
          utterance,
          history,
          request.signal,
          taskScope.signal,
        );
        request.signal.throwIfAborted();
        if (answer?.trim()) {
          announcements.push({ text: answer });
        }
      } catch (failure) {
        if (!request.signal.aborted && !closed && !closing) {
          options.caption(
            failure instanceof Error ? failure.message : String(failure),
          );
          taskFailure(failure);
        }
      } finally {
        pending.delete(request);
        queued--;
        state();
      }
    });
  };
  const text = (event: Event) =>
    [event.text, event.delta, event.transcript, event.content].find(
      (value): value is string => typeof value === "string",
    ) || "";
  const receive = (event: Event) => {
    if (closed) {
      return;
    }
    switch (event.type) {
      case "session.created": {
        visualStamp = undefined;
        const value = event.session as Event | undefined;
        if (typeof value?.id === "string" && value.id) {
          dialogId = value.id;
        }
        break;
      }
      case "conversation.item.input_audio_transcription.started": {
        replying = false;
        interruptPlayer();
        void send({ type: "response.cancel" }).catch(taskFailure);
        input = "";
        reply = "";
        inputCommitted = false;
        responding = false;
        inputActive = true;

        inputAt = (Date.now() - startedAt) / 1000;
        break;
      }
      case "conversation.item.input_audio_transcription.delta":
        // Seeduplex sends the revised utterance, including in its delta field.
        input = options.visualFrame ? input + text(event) : text(event);
        options.caption(input);
        options.interim({ time: inputAt, text: input });
        break;
      case "conversation.item.input_audio_transcription.completed":
        inputActive = false;
        recoveryAttempts = 0;
        input = text(event) || input;
        options.interim(null);
        if (!inputCommitted && input.trim()) {
          inputCommitted = true;
          options.line({ time: inputAt, text: input });
          if (!closing) {
            executeTurn(input);
          }
        }
        flush?.resolve();
        flush = undefined;
        if (!options.visualFrame) {
          options.state("thinking");
        }
        break;
      case "response.created":
        if (replying) {
          responding = true;
        }
        break;
      case "input_audio_buffer.committed":
        if (!input) {
          flush?.resolve();
          flush = undefined;
        }
        break;
      case "response.output_text.delta": {
        if (!replying) {
          break;
        }
        reply += text(event);
        options.caption(reply);
        break;
      }
      case "response.output_text.done":
        if (!replying) {
          break;
        }
        reply = text(event) || reply;
        options.caption(reply);
        break;
      case "response.output_audio.delta":
        if (nativeAudio || !replying) {
          break;
        }
        audioTransfers++;
        void player!
          .enqueue(String(event.audio || event.delta || ""))
          .catch(taskFailure)
          .finally(() => {
            audioTransfers--;
          });
        break;
      case "audio.playing":
        speaking = event.playing === true;
        state();
        break;
      case "response.canceled":
        responding = false;
        interruptPlayer();
        break;
      case "response.done":
        responding = false;
        replying = false;
        recoveryAttempts = 0;
        // Keep the initial goal and recent 12 QA. Retry a missed retrieval later.
        if (
          !closing &&
          ++turns % 8 === 0 &&
          (!contextRequest || Date.now() - contextRequestedAt > 30000)
        ) {
          contextRequest = crypto.randomUUID();
          contextRequestedAt = Date.now();
          void send({
            type: "conversation.item.retrieve",
            event_id: contextRequest,
          }).catch(report);
        }
        state();
        break;
      case "conversation.item.retrieved": {
        if (!contextRequest || !Array.isArray(event.items)) {
          break;
        }
        contextRequest = undefined;
        const messages = event.items.filter(
          (item): item is Event =>
            !!item &&
            typeof item === "object" &&
            (item.role === "user" || item.role === "assistant") &&
            typeof item.id === "string" &&
            !!item.id,
        );
        initialUserId ||= messages.find((item) => item.role === "user")?.id as
          | string
          | undefined;
        const old = messages
          .slice(0, Math.max(0, messages.length - 24))
          .filter(
            (item, index) =>
              item.role === "user" &&
              item.id !== initialUserId &&
              messages[index + 1]?.role === "assistant" &&
              index + 1 < messages.length - 24,
          )
          .map((item) => ({ id: item.id }));
        if (old.length) {
          void send({ type: "conversation.item.delete", items: old }).catch(
            report,
          );
        }
        void send({
          type: "session.update",
          session: {
            instructions: (configuration().session as Event).instructions,
            tools: [],
          },
          extension: speechExtension(),
        }).catch(report);
        break;
      }
      case "conversation.item.input_audio_transcription.failed":
        inputActive = false;
        responding = false;
        options.interim(null);
        options.status(
          String(event.message || t("fcboard.aiMessages.repeatSpeech")),
        );

        state();
        break;
      case "error":
        report(
          new Error(
            String(
              event.message ||
                (event.error as Event | undefined)?.message ||
                t("fcboard.aiMessages.voiceServiceError"),
            ),
          ),
        );
        break;
    }
  };
  const listener: Promise<PluginListenerHandle> = engine.addListener(
    "event",
    (value) => {
      if (value.session === session) {
        receive(value.event);
      }
    },
  );
  const unwatch = classroomCommands.onInvalidate((source) => {
    if (
      source &&
      Array.from(pending).some((request) =>
        classroomCommands.isOwnedBy(source, request.signal),
      ) &&
      classroomCommands.isExpectedTransition(source)
    ) {
      return;
    }
    cancelTasks();
  });
  const spoken = new Map<string, number>(
    boardTasks().map((task) => [task.id, task.speech?.sequence || 0]),
  );
  const reportedFailures = new Set(
    boardTasks()
      .filter((task) => task.state === "failed")
      .map((task) => task.id),
  );
  const unwatchAgents = classroomCommands.watch("agents", () => {
    for (const task of boardTasks()) {
      if (task.state === "failed" && !reportedFailures.has(task.id)) {
        reportedFailures.add(task.id);
        options.caption(task.error || t("fcboard.ai_request_failed"));
      }
      if (
        task.state !== "cancelled" &&
        task.speech &&
        task.speech.sequence > (spoken.get(task.id) || 0)
      ) {
        spoken.set(task.id, task.speech.sequence);
        announcements.push({ text: task.speech.text, taskId: task.id });
        void announce().catch(taskFailure);
      }
    }
  });
  const finish = (discard: boolean) =>
    (finishing ||= (async () => {
      closing = true;
      cancelTasks();
      taskScope.abort();
      if (!discard && !recovering) {
        await handle.flush().catch(() => {});
      }
      closed = true;
      clearInterval(visualTimer);

      flush?.resolve();
      flush = undefined;
      unwatch();
      unwatchAgents();
      releaseConversation();
      options.interim(null);
      options.signal?.removeEventListener("abort", abortOpening);
      try {
        await capture?.cancel();
      } finally {
        await Promise.allSettled([
          engine.stop({ session }),
          listener.then((subscription) => subscription.remove()),
          player?.close(),
        ]);
      }
    })());
  const handle: DuplexSpeechHandle = {
    startedAt,
    get stream() {
      return capture?.stream;
    },
    stop: () => finish(false),
    cancel: () => finish(true),
    interrupt,
    ...(nativeAudio
      ? {
          async prepareRecording() {
            if (closed || closing) {
              throw new DOMException("Voice closed", "AbortError");
            }
            nativeCaptureRequested = false;
            const previous = capture;
            capture = undefined;
            await previous?.cancel();
            await engine.captureMode({ session, mode: "muted" });
          },
          async useRecordingStream(stream: MediaStream) {
            if (closed || closing) {
              throw new DOMException("Voice closed", "AbortError");
            }
            await capture?.cancel();
            await engine.captureMode({ session, mode: "shared" });
            capture = await sharedCapture(stream, false);
          },
          async restoreCapture() {
            if (closed || closing) {
              return;
            }
            const previous = capture;
            capture = undefined;
            await previous?.cancel();
            nativeCaptureRequested = true;
            await engine.captureMode({ session, mode: "native" });
          },
        }
      : {}),
    async speak(text) {
      if (!closed && !closing && text.trim()) {
        announcements.push({ text: text.trim().slice(0, 6000) });
        await announce().catch(taskFailure);
      }
    },
    async flush() {
      if (closed || flush) {
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          flush = undefined;
          reject(new Error(t("fcboard.aiMessages.transcriptTimeout")));
        }, 5000);
        flush = {
          resolve: () => {
            clearTimeout(timeout);
            resolve();
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
        };
        void send({ type: "input_audio_buffer.commit" }).catch((error) => {
          flush?.reject(error);
          flush = undefined;
        });
      });
    },
  };
  const sharedCapture = async (
    stream: MediaStream | undefined,
    create: boolean,
  ) => {
    const input = await startPCMSpeech(
      {
        start: async () => {
          if (closed || closing) {
            throw new DOMException("Voice closed", "AbortError");
          }
          if (!create) {
            return { session };
          }
          await listener;
          return engine.start({
            session,
            key,
            configuration: configuration(),
            capture: false,
            playback: nativeAudio,
          });
        },
        push: async ({ pcm, sampleRate }) => {
          if (sampleRate !== 16000) {
            throw new Error("Seeduplex requires 16 kHz PCM");
          }
          if (!closed && !closing && !recovering) {
            try {
              await engine.pushAudio({ session, pcm, sampleRate });
            } catch (failure) {
              // Do not reject capture or retain seconds of stale audio while offline.
              // Recording owns the same stream and must remain live during recovery.
              report(failure);
            }
          }
          return { lines: [] };
        },
        stop: async () => ({ lines: [] }),
      },
      () => {},
      report,
      stream,
      true,
      undefined,
      undefined,
      { blockDuration: 0.1 },
    );
    await input.ready;
    return input;
  };
  const abortOpening = () => {
    void finish(true).catch(taskFailure);
  };
  options.signal?.addEventListener("abort", abortOpening, { once: true });
  try {
    options.signal?.throwIfAborted();
    if (nativeAudio && !options.stream) {
      await listener;
      await engine.start({
        session,
        key,
        configuration: configuration(),
        capture: true,
        playback: true,
      });
      nativeReady = true;
    } else {
      capture = await sharedCapture(options.stream, true);
    }
    await capture?.ready;
    if (closed) {
      await capture?.cancel();
      throw new DOMException("Speech session cancelled", "AbortError");
    }
    if (options.visualFrame) {
      await sendVisualFrame();
      if (!closed && !closing) {
        visualTimer = setInterval(() => void sendVisualFrame(), frameInterval);
      }
    }
    return handle;
  } catch (failure) {
    await finish(true);
    throw failure;
  }
};
