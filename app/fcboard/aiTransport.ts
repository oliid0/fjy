import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { t } from "@fcboard/fcboard/i18n";

import { Classroom } from "./native";

export type AISearchEvidence = {
  count: number;
  sources: { title: string; url: string }[];
};
/** Ark PDF: usage.tool_usage.web_search and provider URL annotations are evidence,
 * whereas a model's own JSON sources are not proof that search actually ran. */
export const readAISearchEvidence = (data: string): AISearchEvidence => {
  const value = JSON.parse(data);
  const sources = new Map<string, { title: string; url: string }>();
  const annotations = [
    ...(value.choices || []).flatMap(
      (choice: { message?: { annotations?: unknown[] } }) =>
        choice.message?.annotations || [],
    ),
    ...(value.output || []).flatMap(
      (item: { content?: { annotations?: unknown[] }[] }) =>
        (item.content || []).flatMap((part) => part.annotations || []),
    ),
  ];
  for (const annotation of annotations) {
    const entry = annotation as {
      type?: string;
      title?: string;
      url?: string;
      url_citation?: { title?: string; url?: string };
    };
    if (entry.type !== "url_citation") {
      continue;
    }
    const source = entry.url_citation || entry;
    if (typeof source.title !== "string" || typeof source.url !== "string") {
      continue;
    }
    try {
      if (new URL(source.url).protocol === "https:") {
        sources.set(source.url, { title: source.title, url: source.url });
      }
    } catch {
      /* Invalid provider citation. */
    }
  }
  const count =
    Number(value.usage?.tool_usage?.web_search) ||
    (value.output || []).filter(
      (item: { type: string; status: string }) =>
        item.type === "web_search_call" && item.status === "completed",
    ).length;
  return { count, sources: [...sources.values()] };
};

const textContent = (content: unknown): string => {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
};

export type AIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};
export type AICompletion = {
  text: string;
  toolCalls: AIToolCall[];
  assistant?: Record<string, unknown>;
  output?: Record<string, unknown>[];
};

/** Distinguish an explicit provider rejection from a broken stream or network failure. */
export class AIProviderError extends Error {
  constructor(message: string, readonly code = "") {
    super(message);
  }
}

export const readAICompletion = (
  data: string,
  responses: boolean,
): AICompletion => {
  let value;
  try {
    value = JSON.parse(data);
  } catch {
    throw new Error(
      t("fcboard.the_ai_endpoint_returned_invalid_json_check_its_address"),
    );
  }
  if (value.error || value.status === "failed") {
    throw new AIProviderError(
      value.error?.message || t("fcboard.ai_request_failed"),
      String(value.error?.code || ""),
    );
  }
  if (
    value.status === "incomplete" ||
    value.choices?.[0]?.finish_reason === "length"
  ) {
    throw new Error(
      t(
        "fcboard.the_ai_reply_reached_its_length_limit_narrow_your_question_and_try_again",
      ),
    );
  }
  if (value.choices?.[0]?.finish_reason === "content_filter") {
    throw new Error(
      t("fcboard.ai_could_not_finish_the_answer_rephrase_and_try_again"),
    );
  }
  const result = responses
    ? value.output
        ?.filter((item: { type: string }) => item.type === "message")
        .flatMap(
          (item: { content?: { type: string; text: string }[] }) =>
            item.content || [],
        )
        .filter((part: { type: string }) => part.type === "output_text")
        .map((part: { text: string }) => part.text)
        .join("\n")
    : textContent(value.choices?.[0]?.message?.content);
  const rawCalls = responses
    ? (value.output || [])
        .filter((item: { type: string }) => item.type === "function_call")
        .map((item: { call_id: string; name: string; arguments: string }) => ({
          id: item.call_id,
          type: "function",
          function: { name: item.name, arguments: item.arguments },
        }))
    : value.choices?.[0]?.message?.tool_calls || [];
  const ids = new Set<string>();
  if (!Array.isArray(rawCalls) || rawCalls.length > 20) {
    throw new Error("AI工具调用数量无效");
  }
  const toolCalls: AIToolCall[] = rawCalls.map((call) => {
    if (
      !call ||
      typeof call.id !== "string" ||
      !call.id ||
      ids.has(call.id) ||
      call.type !== "function" ||
      typeof call.function?.name !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(call.function.name) ||
      typeof call.function.arguments !== "string" ||
      call.function.arguments.length > 200000
    ) {
      throw new Error("AI工具调用格式不完整");
    }
    const args = JSON.parse(call.function.arguments);
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw new Error("AI工具参数必须为完整JSON对象");
    }
    ids.add(call.id);
    return call;
  });
  if (!result?.trim() && !toolCalls.length) {
    throw new Error(
      t(
        "fcboard.ai_returned_no_content_check_that_the_model_supports_this_task",
      ),
    );
  }
  return {
    text: result || "",
    toolCalls,
    ...(responses
      ? { output: value.output }
      : { assistant: value.choices?.[0]?.message }),
  };
};

export const readAIResult = (data: string, responses: boolean): string => {
  const value = readAICompletion(data, responses);
  if (!value.text.trim()) {
    throw new Error(
      t(
        "fcboard.ai_returned_no_content_check_that_the_model_supports_this_task",
      ),
    );
  }
  return value.text;
};

/** SSE frames can span arbitrary network chunks (including CRLF and UTF-8). */
export class AIStream {
  private pending = "";
  private data: string[] = [];
  private text = "";
  private completed = false;
  private chatFinished = false;
  private completion?: AICompletion;
  private toolCalls = new Map<number, AIToolCall>();
  private assistant: Record<string, unknown> = { role: "assistant" };
  constructor(
    private responses: boolean,
    private onDelta: (text: string) => void,
  ) {}

  push(chunk: string) {
    this.pending += chunk;
    if (this.pending.length > 4_000_000) {
      throw new Error(
        t("fcboard.the_ai_reply_is_too_large_narrow_your_question"),
      );
    }
    let match;
    while ((match = /\r\n|\r(?!$)|\n/.exec(this.pending))) {
      const line = this.pending.slice(0, match.index);
      this.pending = this.pending.slice(match.index + match[0].length);
      if (line === "") {
        this.frame();
      } else if (line.startsWith("data:")) {
        this.data.push(line.slice(5).replace(/^ /, ""));
      }
    }
  }

  private frame() {
    if (!this.data.length) {
      return;
    }
    const data = this.data.join("\n");
    this.data = [];
    if (data === "[DONE]") {
      this.completed ||= this.chatFinished;
      return;
    }
    let packet;
    try {
      packet = JSON.parse(data);
    } catch {
      throw new Error(
        t("fcboard.the_ai_endpoint_returned_invalid_json_check_its_address"),
      );
    }
    if (
      packet.error ||
      packet.type === "error" ||
      packet.type === "response.failed"
    ) {
      throw new AIProviderError(
        packet.error?.message ||
          packet.response?.error?.message ||
          packet.message ||
          t("fcboard.ai_request_failed"),
        String(packet.error?.code || packet.response?.error?.code || ""),
      );
    }
    if (
      packet.type === "response.incomplete" ||
      packet.choices?.[0]?.finish_reason === "length"
    ) {
      throw new Error(
        t(
          "fcboard.the_ai_reply_reached_its_length_limit_narrow_your_question_and_try_again",
        ),
      );
    }
    if (packet.choices?.[0]?.finish_reason === "content_filter") {
      throw new Error(
        t("fcboard.ai_could_not_finish_the_answer_rephrase_and_try_again"),
      );
    }
    if (this.completed) {
      return;
    }
    if (
      !this.responses &&
      ["stop", "tool_calls"].includes(packet.choices?.[0]?.finish_reason)
    ) {
      this.chatFinished = true;
    }
    if (!this.responses) {
      const fields = packet.choices?.[0]?.delta || {};
      for (const field of ["reasoning_content", "encrypted_content"]) {
        if (typeof fields[field] === "string") {
          this.assistant[field] =
            String(this.assistant[field] || "") + fields[field];
        }
      }
      for (const fragment of fields.tool_calls || []) {
        if (
          !Number.isInteger(fragment.index) ||
          fragment.index < 0 ||
          fragment.index >= 20
        ) {
          throw new Error("AI工具流索引无效");
        }
        const call = this.toolCalls.get(fragment.index) || {
          id: "",
          type: "function" as const,
          function: { name: "", arguments: "" },
        };
        if (typeof fragment.id === "string") {
          call.id = fragment.id;
        }
        if (typeof fragment.function?.name === "string") {
          call.function.name += fragment.function.name;
        }
        if (typeof fragment.function?.arguments === "string") {
          call.function.arguments += fragment.function.arguments;
        }
        if (call.function.arguments.length > 200000) {
          throw new Error("AI工具参数过长");
        }
        this.toolCalls.set(fragment.index, call);
      }
    }
    const delta = this.responses
      ? packet.type === "response.output_text.delta"
        ? packet.delta
        : ""
      : textContent(packet.choices?.[0]?.delta?.content);
    if (typeof delta === "string" && delta) {
      this.text += delta;
      if (this.text.length > 4_000_000) {
        throw new Error(
          t("fcboard.the_ai_reply_is_too_large_narrow_your_question"),
        );
      }
      this.onDelta(delta);
    }
    if (packet.type === "response.completed") {
      // The terminal response is authoritative; never accept a broken partial JSON command.
      const final = readAICompletion(JSON.stringify(packet.response), true);
      if (!this.text && final.text) {
        this.onDelta(final.text);
      }
      this.text = final.text;
      this.completion = final;
      this.completed = true;
    }
  }

  finishCompletion(): AICompletion {
    if (this.pending) {
      if (this.pending.startsWith("data:")) {
        this.data.push(this.pending.slice(5).trimStart());
      }
      this.pending = "";
    }
    this.frame();
    if (!this.completed) {
      throw new Error(
        t(
          "fcboard.ai_connection_interrupted_the_incomplete_answer_was_not_inserted_please_try_again",
        ),
      );
    }
    return (
      this.completion ||
      readAICompletion(
        JSON.stringify({
          choices: [
            {
              message: {
                ...this.assistant,
                content: this.text,
                tool_calls: [...this.toolCalls.entries()]
                  .sort(([a], [b]) => a - b)
                  .map(([, call]) => call),
              },
            },
          ],
        }),
        false,
      )
    );
  }

  finish() {
    const value = this.finishCompletion();
    if (!value.text.trim()) {
      throw new Error(
        t(
          "fcboard.ai_returned_no_content_check_that_the_model_supports_this_task",
        ),
      );
    }
    return value.text;
  }
}

export const postAI = async (
  url: string,
  key: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  onChunk: (text: string) => void,
): Promise<{ status: number; data: string; stream: boolean }> => {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
  if (Capacitor.isNativePlatform()) {
    if (!Capacitor.isPluginAvailable("FcboardClassroom")) {
      const result = await CapacitorHttp.post({
        url,
        headers,
        data: body,
        connectTimeout: 15000,
        readTimeout: 90000,
      });
      return {
        status: result.status,
        data:
          typeof result.data === "string"
            ? result.data
            : JSON.stringify(result.data),
        stream: false,
      };
    }
    const id = crypto.randomUUID();
    let failure: unknown;
    const listener = await Classroom.addListener("aiStream", (event) => {
      if (event.id !== id || signal.aborted || failure) {
        return;
      }
      try {
        onChunk(event.chunk);
      } catch (error) {
        failure = error;
        void Classroom.cancelAIStream({ id }).catch(() => {});
      }
    });
    let detached: Promise<void> | undefined;
    const detach = () => (detached ||= listener.remove().catch(() => {}));
    const cancel = () => {
      void Classroom.cancelAIStream({ id }).catch(() => {});
      void detach();
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      signal.throwIfAborted();
      const result = await Classroom.postAIStream({
        id,
        url,
        headers,
        body: JSON.stringify(body),
      });
      signal.throwIfAborted();
      if (failure) {
        throw failure;
      }
      return result;
    } catch (error) {
      if (failure) {
        throw failure;
      }
      throw error;
    } finally {
      signal.removeEventListener("abort", cancel);
      await detach();
    }
  }
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    signal.throwIfAborted();
    throw new Error(
      t(
        "fcboard.cannot_connect_to_ai_check_your_network_endpoint_and_browser_cors_settings",
      ),
      { cause },
    );
  }
  const stream =
    response.status >= 200 &&
    response.status < 300 &&
    !!response.body &&
    response.headers?.get("content-type")?.includes("text/event-stream");
  if (!stream) {
    return {
      status: response.status,
      data: await response.text(),
      stream: false,
    };
  }
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      onChunk(decoder.decode(value, { stream: true }));
    }
    onChunk(decoder.decode());
    return { status: response.status, data: "", stream: true };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
};
