import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { exportToBlob } from "@excalidraw/excalidraw";
import { getDataURL } from "@excalidraw/excalidraw/data/blob";
import { getSelectedElements } from "@excalidraw/element";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { currentSettings, validateEndpoint } from "./settings";

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
): Promise<string> => {
  const settings = currentSettings();
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
  let data;
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.post({
      url,
      headers,
      data: body,
      connectTimeout: 15000,
      readTimeout: 90000,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `AI 请求失败 (${response.status})：${
          response.data?.error?.message || "请检查接口、模型与密钥"
        }`,
      );
    }
    data = response.data;
  } else {
    const timeout = AbortSignal.timeout(90000);
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: signal || timeout,
    });
    data = await response.json();
    if (!response.ok) {
      throw new Error(
        `AI 请求失败 (${response.status})：${
          data?.error?.message || "请检查接口、模型与密钥"
        }`,
      );
    }
  }
  if (signal?.aborted) {
    throw new DOMException("已取消", "AbortError");
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("AI 返回了空内容，请确认模型支持所请求的功能");
  }
  return content;
};

export const selectedBoardElements = (api: ExcalidrawImperativeAPI) =>
  getSelectedElements(api.getSceneElements(), api.getAppState(), {
    includeBoundTextElement: true,
    includeElementsInFrames: true,
  });

export const boardContext = async (
  api: ExcalidrawImperativeAPI,
  wholeBoard = false,
) => {
  const all = api.getSceneElements();
  const selected = selectedBoardElements(api);
  const elements = !wholeBoard && selected.length ? selected : all;
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
