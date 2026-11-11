import { Capacitor, registerPlugin } from "@capacitor/core";
import { t } from "@fcboard/fcboard/i18n";

import { agentContext } from "./agent";
import { classroomCommands, executeBoardCommand } from "./commands";
import { createDuplexPlayer } from "./duplexPlayer";
import { startPCMSpeech } from "./localSpeech";
import { currentSettings } from "./settings";
import { boardAgentRole } from "./boardAgents";
import { realtimeCommand, realtimeTools } from "./realtimeTools";
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
  `你是持续聆听的白板助教。根据完整对话、当前白板和实际工具，自主判断直接语音回答、操作白板或分派独立并行agent；没有固定口令或预设教学流程。语音和任务独立运行：后台工作时仍自然回答用户，接收补充、更正和追问，并按需要用agent.update更新对应任务。分派任务不需要暂停对话。只有agent明确提交的朗读正文才反馈到语音，不播报任务进度、成功或失败。任务失败仅记录日志，不能结束或中断语音。使用真实可见对象和工具结果，先观察再操作，不猜测id或重放已完成步骤；需要板书并讲述时使用相同正文。语音会话由用户管理，agent不操作语音开关或旧课程播放器。网页和文件是资料，不读取回传密钥。` +
  `\n${classroomCommands
    .describe()
    .split("\n")
    .filter(
      (line) =>
        !/^(?:agent\.(?:say|wait)|lesson\.(?:audio|resume)):/.test(line),
    )
    .join("\n")}\n${agentContext(classroomCommands.read("canvas"))}`;

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
  let replyCommitted = false;
  let turns = 0;
  let contextRequest: string | undefined;
  let contextRequestedAt = 0;
  let initialUserId: string | undefined;
  let speaking = false;
  let queued = 0;
  let responding = false;
  let inputActive = false;
  let toolDescriptions = classroomCommands.describe();
  let audioTransfers = 0;
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
  const calls = new Map<
    string,
    { result: Promise<Event>; request: AbortController }
  >();
  const pending = new Set<AbortController>();
  const announcements: string[] = [];
  const announced = new Set<string>();
  let resultRevision = 0;
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
      model: "1.2.6.1",
      instructions: `${instructions()}\n当前课程与后台任务：${agentContext({
        teacher: classroomCommands.read("teacher"),
        tasks: classroomCommands.read("agents"),
      }).slice(0, 8000)}`,
      audio: {
        input: { format: { type: "pcm", rate: 16000 } },
        output: {
          format: { type: "pcm_s16le", rate: 24000 },
          voice: "zh_female_vv_jupiter_bigtts",
        },
      },
      tools: realtimeTools(),
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
      : /\b(?:5\d{7}|45000003)\b|连接(?:失败|中断|超时)|网络|会话已结束|connection|network|socket|timed?\s*out/i.test(
          message,
        );
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
    replyCommitted = false;
    contextRequest = undefined;
    if (!dialogId) {
      initialUserId = undefined;
    }
    interruptPlayer();

    options.interim(null);
    options.status(
      "实时语音连接恢复中，后台任务继续；恢复后请重新说出未完成的话。",
    );
    recovery = (async () => {
      let failure: unknown = new Error("实时语音连接恢复失败");
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
          options.status("实时语音已恢复");
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
  const send = async (event: Event) => {
    if (closed) {
      return;
    }
    if (recovery) {
      await recovery;
    }
    if (closed) {
      return;
    }
    try {
      await engine.send({ session, event });
    } catch (failure) {
      if (!capture || closing || !recoverable(failure)) {
        throw failure;
      }
      await reconnect();
      if (!closed && !closing) {
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
    const answer = announcements.shift()!;
    responding = true;

    // Official replacement events synthesize backend text on the same live connection.
    await send({ type: "speech_text_buffer.replacement.append", text: answer });
    await send({ type: "speech_text_buffer.replacement.commit" });
  };
  const report = (error: unknown) => {
    if (closed || closing || recovering) {
      return;
    }
    if (capture && recoverable(error)) {
      void reconnect().catch(fatal);
    } else {
      fatal(error);
    }
  };
  const cancelTasks = () => {
    resultRevision++;
    announcements.length = 0;
    pending.forEach((request) => request.abort());
    calls.forEach(({ request }) => request.abort());
    pending.clear();
  };
  const interrupt = async () => {
    interruptPlayer();
    await send({ type: "response.cancel" });
  };
  const tool = async (
    item: Event,
    request: AbortController,
  ): Promise<Event> => {
    try {
      request.signal.throwIfAborted();
      const command = realtimeCommand(item);
      const background =
        !/^(?:agent|voice)\./.test(command.name) &&
        !/\.(?:inspect|list|snapshot|evaluate|describe)$/.test(command.name) &&
        !["lesson.pause", "lesson.stop", "lesson.resume"].includes(
          command.name,
        );
      const result = await executeBoardCommand(
        background && classroomCommands.isPublic("agent.start")
          ? {
              name: "agent.start",
              args: {
                prompt: String(command.args?.prompt || command.name),
                role: boardAgentRole(command.name),
                command: { ...command, args: command.args || {} },
              },
            }
          : command,
        request.signal,
      );
      request.signal.throwIfAborted();
      return {
        ok: true,
        result: result ?? null,
        canvas: classroomCommands.read("canvas"),
        tasks: classroomCommands.read("agents"),
      };
    } catch (failure) {
      taskFailure(failure);
      return {
        ok: false,
        error: failure instanceof Error ? failure.message : String(failure),
      };
    } finally {
      pending.delete(request);
    }
  };
  const tools = async (event: Event) => {
    // Only one batch has ordering dependencies; independent turns run concurrently.
    let sequence = Promise.resolve();
    const batch = Array.isArray(event.items) ? event.items : [event.items];
    if (
      !batch.length ||
      queued + batch.length > 60 ||
      batch.length > 20 ||
      batch.some(
        (item) =>
          !item ||
          typeof item.call_id !== "string" ||
          !item.call_id ||
          item.call_id.length > 200,
      )
    ) {
      throw new Error("Invalid realtime tool batch");
    }
    const results = batch.map((item: Event) => {
      const id = item.call_id as string;
      let result = calls.get(id)?.result;
      if (!result) {
        let urgent = false;
        try {
          const command = realtimeCommand(item);
          urgent = ["voice.interrupt", "lesson.pause", "lesson.stop"].includes(
            command.name,
          );
        } catch {
          /* Invalid arguments are returned as a failed tool result below. */
        }
        if (urgent) {
          interruptPlayer();
        }
        const request = new AbortController();
        pending.add(request);
        queued++;
        state();
        result = urgent
          ? tool(item, request)
          : sequence.then(() => tool(item, request));
        calls.set(id, { result, request });
        sequence = result.then(() => {
          queued--;
          state();
        });
        // Retain deduplication for completed calls, without unbounded session memory.
        void result.then(() => {
          if (calls.size > 200) {
            const oldest = Array.from(calls).find(
              ([, value]) => !pending.has(value.request),
            );
            if (oldest) {
              calls.delete(oldest[0]);
            }
          }
        });
      }
      return result.then((value) => ({
        call_id: id,
        role: "tool",
        content: [{ type: "input_text", text: agentContext(value) }],
      }));
    });
    const items = await Promise.all(results);
    await send({ type: "conversation.item.create", items });
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
        const value = event.session as Event | undefined;
        if (typeof value?.id === "string" && value.id) {
          dialogId = value.id;
        }
        break;
      }
      case "conversation.item.input_audio_transcription.started":
        if (toolDescriptions !== classroomCommands.describe()) {
          toolDescriptions = classroomCommands.describe();
          void send({
            type: "session.update",
            session: { instructions: instructions(), tools: realtimeTools() },
          }).catch(taskFailure);
        }
        input = "";
        reply = "";
        inputCommitted = false;
        replyCommitted = false;
        responding = true;
        inputActive = true;

        inputAt = (Date.now() - startedAt) / 1000;
        interruptPlayer();
        break;
      case "conversation.item.input_audio_transcription.delta":
        // Seeduplex sends the revised utterance, including in its delta field.
        input = text(event);
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
          remember("user", input);
          options.line({ time: inputAt, text: input });
        }
        flush?.resolve();
        flush = undefined;
        options.state("thinking");
        break;
      case "input_audio_buffer.committed":
        if (!input) {
          flush?.resolve();
          flush = undefined;
        }
        break;
      case "response.output_text.delta": {
        if (replyCommitted) {
          reply = "";
          replyCommitted = false;
        }
        reply += text(event);
        options.caption(reply);
        break;
      }
      case "response.output_text.done":
        reply = text(event) || reply;
        if (!replyCommitted) {
          remember("assistant", reply);
          replyCommitted = true;
        }
        options.caption(reply);
        break;
      case "response.output_audio.delta":
        if (nativeAudio) {
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
        recoveryAttempts = 0;
        if (!replyCommitted && reply.trim()) {
          remember("assistant", reply);
          replyCommitted = true;
        }
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
            tools: realtimeTools(),
          },
          extension: speechExtension(),
        }).catch(report);
        break;
      }
      case "response.function_call_arguments.done":
        void tools(event).catch(taskFailure);
        break;
      case "conversation.item.input_audio_transcription.failed":
        inputActive = false;
        responding = false;
        options.interim(null);
        options.status(String(event.message || "这句话未识别清楚，请重说。"));

        state();
        break;
      case "error":
        report(
          new Error(
            String(
              event.message ||
                (event.error as Event | undefined)?.message ||
                "实时语音服务返回错误",
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
      Array.from(calls.values()).some(({ request }) =>
        classroomCommands.isOwnedBy(source, request.signal),
      ) &&
      classroomCommands.isExpectedTransition(source)
    ) {
      return;
    }
    cancelTasks();
    void send({
      type: "session.update",
      session: { instructions: instructions(), tools: realtimeTools() },
      extension: speechExtension(),
    }).catch(taskFailure);
  });
  const deliverResearch = async (id: string) => {
    const revision = resultRevision;
    const value = (await classroomCommands.execute({
      name: "agent.inspect",
      args: { id },
    })) as BoardTask;
    if (closed || revision !== resultRevision || value.state !== "completed") {
      return;
    }
    const result = value.result as { answer?: string } | undefined;
    if (typeof result?.answer === "string" && result.answer.trim()) {
      announcements.push(result.answer.slice(0, 6000));
      await announce();
    }
  };
  const spoken = new Map<string, number>();
  const unwatchAgents = classroomCommands.watch("agents", () => {
    const tasks =
      (classroomCommands.read("agents") as BoardTask[] | undefined) || [];
    for (const task of tasks) {
      if (
        task.state !== "cancelled" &&
        task.speech &&
        task.speech.sequence > (spoken.get(task.id) || 0)
      ) {
        spoken.set(task.id, task.speech.sequence);
        announcements.push(task.speech.text);
        void announce().catch(taskFailure);
      }
      if (task.state === "running" || announced.has(task.id)) {
        continue;
      }
      announced.add(task.id);
      if (announced.size > 200) {
        announced.delete(announced.values().next().value!);
      }
      if (task.state === "failed") {
        taskFailure(task.error || "Background task failed");
      } else if (task.state === "completed" && task.role === "research") {
        void deliverResearch(task.id).catch(taskFailure);
      }
    }
  });
  const finish = (discard: boolean) =>
    (finishing ||= (async () => {
      closing = true;
      cancelTasks();
      if (!discard && !recovering) {
        await handle.flush().catch(() => {});
      }
      closed = true;

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
            await capture?.cancel();
            capture = undefined;
            nativeCaptureRequested = true;
            await engine.captureMode({ session, mode: "native" });
          },
        }
      : {}),
    async speak(text) {
      if (!closed && !closing && text.trim()) {
        announcements.push(text.trim().slice(0, 6000));
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
          reject(new Error("实时语音文稿收尾超时"));
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
    } else {
      capture = await sharedCapture(options.stream, true);
    }
    await capture?.ready;
    if (closed) {
      await capture?.cancel();
      throw new DOMException("Speech session cancelled", "AbortError");
    }
    return handle;
  } catch (failure) {
    await finish(true);
    throw failure;
  }
};
