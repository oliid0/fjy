import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { exportToBlob } from "@excalidraw/excalidraw";
import { getDataURL } from "@excalidraw/excalidraw/data/blob";
import { getSelectedElements } from "@excalidraw/element";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { currentSettings, validateEndpoint } from "./settings";

import type { Settings } from "./settings";

type Content =
  | string
  | (
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    )[];
export type Message = {
  role: "system" | "user" | "assistant";
  content: Content;
};

export const chat = async (
  messages: Message[],
  signal?: AbortSignal,
  settings: Settings = currentSettings(),
): Promise<string> => {
  if (!settings.apiKey || !settings.model.trim()) {
    throw new Error(
      "请先在 AI 设置中填写 API 密钥和支持视觉的模型 ID / 接入点 ID",
    );
  }
  const url = validateEndpoint(settings.endpoint);
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${settings.apiKey}`,
  };
  const body = {
    model: settings.model.trim(),
    messages,
    stream: false,
    temperature: 0.2,
  };
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) {
    cancel();
  }
  const timer = setTimeout(
    () => controller.abort(new Error("AI 请求超时，请检查网络或稍后重试")),
    90000,
  );
  let unsubscribe = () => {};
  try {
    if (controller.signal.aborted) {
      throw controller.signal.reason;
    }
    const cancelled = new Promise<never>((_, reject) => {
      const abort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", abort, { once: true });
      unsubscribe = () => controller.signal.removeEventListener("abort", abort);
    });
    const request = async () => {
      let status: number;
      let data;
      if (Capacitor.isNativePlatform()) {
        const response = await CapacitorHttp.post({
          url,
          headers,
          data: body,
          connectTimeout: 15000,
          readTimeout: 90000,
        });
        status = response.status;
        data = response.data;
      } else {
        let response;
        try {
          response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } catch (error) {
          if (controller.signal.aborted) {
            throw controller.signal.reason;
          }
          throw new Error(
            "无法连接 AI 接口，请检查网络、接口地址及浏览器跨域配置",
          );
        }
        status = response.status;
        data = await response.text();
      }
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          throw new Error(
            `AI 接口未返回 JSON (${status})，请填写完整的 chat/completions 地址`,
          );
        }
      }
      if (status < 200 || status >= 300) {
        throw new Error(
          `AI 请求失败 (${status})：${
            data?.error?.message || "请检查接口、模型与密钥"
          }`,
        );
      }
      const result = data?.choices?.[0]?.message?.content;
      const content = Array.isArray(result)
        ? result
            .filter(
              (part) => part?.type === "text" && typeof part.text === "string",
            )
            .map((part) => part.text)
            .join("\n")
        : result;
      if (typeof content !== "string" || !content.trim()) {
        throw new Error("AI 返回了空内容，请确认模型支持所请求的功能");
      }
      return content;
    };
    return await Promise.race([request(), cancelled]);
  } finally {
    clearTimeout(timer);
    unsubscribe();
    signal?.removeEventListener("abort", cancel);
  }
};

export const selectedBoardElements = (api: ExcalidrawImperativeAPI) =>
  getSelectedElements(api.getSceneElements(), api.getAppState(), {
    includeBoundTextElement: true,
    includeElementsInFrames: true,
  });

export const boardContext = async (
  api: ExcalidrawImperativeAPI,
  wholeBoard = false,
  snapshot?: readonly ExcalidrawElement[],
) => {
  const all = api.getSceneElements();
  const selected = selectedBoardElements(api);
  const elements =
    snapshot || (!wholeBoard && selected.length ? selected : all);
  const text = elements
    .filter((el) => el.type === "text")
    .map((el) => (el.type === "text" ? el.text : ""))
    .join("\n");
  if (!elements.length) {
    return { elements, text, image: undefined };
  }
  const blob = await exportToBlob({
    elements,
    files: api.getFiles(),
    appState: {
      ...api.getAppState(),
      exportBackground: true,
      exportWithDarkMode: false,
    },
    mimeType: "image/png",
    maxWidthOrHeight: 1600,
  });
  return { elements, text, image: await getDataURL(blob) };
};

export const visualMessage = (text: string, image?: string): Message => ({
  role: "user",
  content: image
    ? [
        { type: "text", text },
        { type: "image_url", image_url: { url: image } },
      ]
    : text,
});

export const parseJSON = (text: string): unknown =>
  JSON.parse(
    text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, ""),
  );
