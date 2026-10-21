import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { t } from "@excalidraw/excalidraw/i18n";

import { Classroom } from "./native";

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

export const readAIResult = (data: string, responses: boolean): string => {
  let value;
  try {
    value = JSON.parse(data);
  } catch {
    throw new Error(t("fcboard.AI 接口未返回有效 JSON，请检查接口地址"));
  }
  if (value.error || value.status === "failed") {
    throw new Error(value.error?.message || t("fcboard.AI 请求失败"));
  }
  if (
    value.status === "incomplete" ||
    value.choices?.[0]?.finish_reason === "length"
  ) {
    throw new Error(t("fcboard.AI 回复超过长度限制，请缩小问题范围后重试"));
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
  if (!result?.trim()) {
    throw new Error(t("fcboard.AI 返回了空内容，请确认模型支持所请求的功能"));
  }
  return result;
};

/** SSE frames can span arbitrary network chunks (including CRLF and UTF-8). */
export class AIStream {
  private pending = "";
  private data: string[] = [];
  private text = "";
  private completed = false;
  private chatFinished = false;
  constructor(
    private responses: boolean,
    private onDelta: (text: string) => void,
  ) {}

  push(chunk: string) {
    this.pending += chunk;
    if (this.pending.length > 4_000_000) {
      throw new Error(t("fcboard.AI 回复过大，请缩小问题范围"));
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
      throw new Error(t("fcboard.AI 接口未返回有效 JSON，请检查接口地址"));
    }
    if (
      packet.error ||
      packet.type === "error" ||
      packet.type === "response.failed"
    ) {
      throw new Error(
        packet.error?.message ||
          packet.response?.error?.message ||
          packet.message ||
          t("fcboard.AI 请求失败"),
      );
    }
    if (
      packet.type === "response.incomplete" ||
      packet.choices?.[0]?.finish_reason === "length"
    ) {
      throw new Error(t("fcboard.AI 回复超过长度限制，请缩小问题范围后重试"));
    }
    if (packet.choices?.[0]?.finish_reason === "content_filter") {
      throw new Error(t("fcboard.AI 未能完成回答，请调整问题后重试"));
    }
    if (this.completed) {
      return;
    }
    if (!this.responses && packet.choices?.[0]?.finish_reason === "stop") {
      this.chatFinished = true;
    }
    const delta = this.responses
      ? packet.type === "response.output_text.delta"
        ? packet.delta
        : ""
      : textContent(packet.choices?.[0]?.delta?.content);
    if (typeof delta === "string" && delta) {
      this.text += delta;
      if (this.text.length > 4_000_000) {
        throw new Error(t("fcboard.AI 回复过大，请缩小问题范围"));
      }
      this.onDelta(delta);
    }
    if (packet.type === "response.completed") {
      // The terminal response is authoritative; never accept a broken partial JSON command.
      const final = readAIResult(JSON.stringify(packet.response), true);
      if (!this.text) {
        this.onDelta(final);
      }
      this.text = final;
      this.completed = true;
    }
  }

  finish() {
    if (this.pending) {
      if (this.pending.startsWith("data:")) {
        this.data.push(this.pending.slice(5).trimStart());
      }
      this.pending = "";
    }
    this.frame();
    if (!this.completed) {
      throw new Error(t("fcboard.AI 连接中断，未写入不完整回答，请重试"));
    }
    if (!this.text.trim()) {
      throw new Error(t("fcboard.AI 返回了空内容，请确认模型支持所请求的功能"));
    }
    return this.text;
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
  } catch {
    signal.throwIfAborted();
    throw new Error(
      t("fcboard.无法连接 AI 接口，请检查网络、接口地址及浏览器跨域配置"),
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
