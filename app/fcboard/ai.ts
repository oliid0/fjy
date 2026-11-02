import { Capacitor } from "@capacitor/core";
import { t } from "@fcboard/fcboard/i18n";
import { exportToBlob } from "@fcboard/fcboard";
import { getDataURL } from "@fcboard/fcboard/data/blob";
import { getSelectedElements } from "@fcboard/element";

import type { FcboardElement } from "@fcboard/element/types";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import {
  AIStream,
  AIProviderError,
  postAI,
  readAIResult,
  readAICompletion,
  readAISearchEvidence,
} from "./aiTransport";

import { currentSettings, defaults, validateEndpoint } from "./settings";
import { handwritingText } from "./handwriting";

import type { AISearchEvidence } from "./aiTransport";
import type { AICompletion } from "./aiTransport";

import type { Settings } from "./settings";

type Content =
  | string
  | (
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    )[];
export type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: Content;
  tool_call_id?: string;
  providerMessage?: Record<string, unknown>;
  responseOutput?: Record<string, unknown>[];
};
export type AIFunctionTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

// A short, stable system prefix allows provider-side KV reuse without reusing
// answers or mixing a previous selection into the current request.
const cacheRoutes = new Map<string, string>();
const ordinaryRoutes = new Map<string, number>();
const cacheRoute = (url: string, settings: Settings, messages: Message[]) => {
  const scope = JSON.stringify([
    url,
    settings.apiKey,
    settings.model,
    messages.filter((message) => message.role === "system"),
  ]);
  let id = cacheRoutes.get(scope);
  if (!id) {
    id = crypto.randomUUID();
    if (cacheRoutes.size >= 16) {
      cacheRoutes.delete(cacheRoutes.keys().next().value!);
    }
    cacheRoutes.set(scope, id);
  }
  return id;
};

export const chat = async (
  messages: Message[],
  signal?: AbortSignal,
  settings: Settings = currentSettings(),
  options: {
    maxTokens?: number;
    onDelta?: (text: string) => void;
    timeoutMs?: number;
    webSearch?: boolean;
    onSearch?: (evidence: AISearchEvidence) => void;
    functionTools?: AIFunctionTool[];
    onCompletion?: (completion: AICompletion) => void;
  } = {},
): Promise<string> => {
  const vision = messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === "image_url"),
  );
  settings = {
    ...settings,
    model: (vision
      ? settings.ocrModel.trim() || settings.model
      : settings.model
    ).trim(),
  };
  if (!settings.apiKey || !settings.model.trim()) {
    throw new Error(
      t(
        "fcboard.set_an_api_key_and_a_vision_model_or_endpoint_id_in_ai_settings",
      ),
    );
  }
  const url = validateEndpoint(settings.endpoint);
  if (options.webSearch && options.functionTools?.length) {
    throw new Error("联网搜索和白板工具应分成独立请求");
  }
  const responses = new URL(url).pathname.endsWith("/responses");
  const ark = new URL(url).hostname === "ark.cn-beijing.volces.com";
  // Fast inference is configured only for the built-in text model. Vision and
  // user-selected models use the provider's standard request defaults.
  const fast =
    ark && !vision && !options.webSearch && settings.model === defaults.model;
  const route = JSON.stringify([url, settings.model, settings.apiKey]);
  const requestFast = fast && (ordinaryRoutes.get(route) || 0) <= Date.now();
  const streaming =
    !options.webSearch &&
    (!Capacitor.isNativePlatform() ||
      Capacitor.isPluginAvailable("FcboardClassroom"));
  const body = {
    model: settings.model.trim(),
    ...(responses
      ? {
          input: messages.flatMap(
            (message): Record<string, unknown>[] =>
              message.responseOutput ||
              (message.role === "tool"
                ? [
                    {
                      type: "function_call_output",
                      call_id: message.tool_call_id,
                      output: message.content,
                    },
                  ]
                : [
                    {
                      role: message.role,
                      content:
                        typeof message.content === "string"
                          ? message.content
                          : message.content.map((part) =>
                              part.type === "text"
                                ? { type: "input_text", text: part.text }
                                : {
                                    type: "input_image",
                                    image_url: part.image_url.url,
                                  },
                            ),
                    },
                  ]),
          ),
        }
      : {
          messages: messages.map(
            ({ providerMessage, responseOutput: _output, ...message }) =>
              providerMessage || message,
          ),
        }),
    stream: streaming,
    ...(options.webSearch
      ? responses
        ? { tools: [{ type: "web_search" }] }
        : { web_search_options: {} }
      : {}),
    ...(options.functionTools?.length
      ? {
          tools: options.functionTools.map((tool) =>
            responses
              ? { type: "function", ...tool }
              : { type: "function", function: tool },
          ),
        }
      : {}),
    ...(options.maxTokens
      ? { [responses ? "max_output_tokens" : "max_tokens"]: options.maxTokens }
      : {}),
    ...(requestFast
      ? {
          ...(responses
            ? { reasoning: { effort: "minimal" } }
            : { thinking: { type: "disabled" } }),
          service_tier: "fast",
          prompt_cache_key: cacheRoute(url, settings, messages),
        }
      : {}),
  };
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) {
    cancel();
  }
  const timer = setTimeout(
    () =>
      controller.abort(
        new Error(
          t(
            "fcboard.ai_request_timed_out_check_your_connection_or_try_again_later",
          ),
        ),
      ),
    Math.max(1000, Math.min(90000, options.timeoutMs || 90000)),
  );
  let unsubscribe = () => {};
  try {
    controller.signal.throwIfAborted();
    const cancelled = new Promise<never>((_, reject) => {
      const abort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", abort, { once: true });
      unsubscribe = () => controller.signal.removeEventListener("abort", abort);
    });
    const ordinaryBody: Record<string, unknown> = { ...body };
    delete ordinaryBody.service_tier;
    delete ordinaryBody.thinking;
    delete ordinaryBody.reasoning;
    delete ordinaryBody.prompt_cache_key;
    const rememberOrdinary = (status: number) => {
      if (ordinaryRoutes.size >= 16) {
        ordinaryRoutes.delete(ordinaryRoutes.keys().next().value!);
      }
      // Capability/permission failures persist for this session window; temporary
      // capacity failures have a short cooldown so a busy agent cannot retry fast on every turn.
      ordinaryRoutes.set(
        route,
        Date.now() +
          ([429, 500, 502, 503, 504].includes(status) ? 30000 : 600000),
      );
    };
    const request = async (
      payload: Record<string, unknown> = body,
      usingFast = requestFast,
    ): Promise<string> => {
      let emitted = false;
      const output = new AIStream(responses, (delta) => {
        if (!controller.signal.aborted) {
          emitted = true;
          options.onDelta?.(delta);
        }
      });
      const canFallback = (failure: unknown) =>
        usingFast &&
        !emitted &&
        failure instanceof AIProviderError &&
        !/auth|api.?key|unauthorized|invalidkey/i.test(
          `${failure.code} ${failure.message}`,
        );
      let response;
      try {
        response = await postAI(
          url,
          settings.apiKey,
          payload,
          controller.signal,
          (chunk) => output.push(chunk),
        );
      } catch (failure) {
        controller.signal.throwIfAborted();
        if (canFallback(failure)) {
          rememberOrdinary(400);
          return request(ordinaryBody, false);
        }
        throw failure;
      }
      controller.signal.throwIfAborted();
      if (response.status < 200 || response.status >= 300) {
        if (usingFast && response.status >= 400 && response.status !== 401) {
          rememberOrdinary(response.status);
          return request(ordinaryBody, false);
        }
        let detail = t("fcboard.check_the_endpoint_model_and_api_key");
        try {
          detail = JSON.parse(response.data).error?.message || detail;
        } catch {
          /* Non-JSON gateway. */
        }
        throw new Error(
          t("fcboard.ai_request_failed_status_detail", {
            status: response.status,
            detail,
          }),
        );
      }
      if (options.webSearch) {
        const evidence = readAISearchEvidence(response.data);
        if (!evidence.count || !evidence.sources.length) {
          throw new Error(
            "当前模型未返回实际联网搜索及引用来源，请选择支持联网搜索的模型后重试",
          );
        }
        options.onSearch?.(evidence);
      }
      try {
        if (options.functionTools?.length) {
          const completion = response.stream
            ? output.finishCompletion()
            : readAICompletion(response.data, responses);
          options.onCompletion?.(completion);
          return completion.text;
        }
        return response.stream
          ? output.finish()
          : readAIResult(response.data, responses);
      } catch (failure) {
        controller.signal.throwIfAborted();
        if (canFallback(failure)) {
          rememberOrdinary(400);
          return request(ordinaryBody, false);
        }
        throw failure;
      }
    };
    return await Promise.race([request(), cancelled]);
  } finally {
    clearTimeout(timer);
    unsubscribe();
    signal?.removeEventListener("abort", cancel);
  }
};

export const selectedBoardElements = (api: FcboardImperativeAPI) =>
  getSelectedElements(api.getSceneElements(), api.getAppState(), {
    includeBoundTextElement: true,
    includeElementsInFrames: true,
  });

export const boardContext = async (
  api: FcboardImperativeAPI,
  wholeBoard = false,
  snapshot?: readonly FcboardElement[],
  region?: { left: number; top: number; right: number; bottom: number },
  captureImage = true,
) => {
  const all = api.getSceneElements();
  const selected = selectedBoardElements(api);
  const elements =
    snapshot || (!wholeBoard && selected.length ? selected : all);
  const text = [
    ...elements
      .filter((el) => el.type === "text")
      .map((el) => (el.type === "text" ? el.text : "")),
    ...handwritingText(elements),
  ].join("\n");
  if (!elements.length || !captureImage) {
    return { elements, text, image: undefined };
  }
  if (region) {
    const state = api.getAppState();
    const canvas = document.querySelector<HTMLCanvasElement>(
      `.fcboard[data-fcboard-id="${api.id}"] canvas.fcboard__canvas.static`,
    );
    if (canvas) {
      const scale = canvas.width / state.width;
      const left = Math.max(
        0,
        (region.left + state.scrollX) * state.zoom.value,
      );
      const top = Math.max(0, (region.top + state.scrollY) * state.zoom.value);
      const right = Math.min(
        state.width,
        (region.right + state.scrollX) * state.zoom.value,
      );
      const bottom = Math.min(
        state.height,
        (region.bottom + state.scrollY) * state.zoom.value,
      );
      if (right > left && bottom > top) {
        const output = document.createElement("canvas");
        const factor = Math.min(
          scale,
          1280 / Math.max(right - left, bottom - top),
        );
        output.width = Math.max(1, Math.ceil((right - left) * factor));
        output.height = Math.max(1, Math.ceil((bottom - top) * factor));
        const context = output.getContext("2d")!;
        const layers = document.querySelectorAll<HTMLCanvasElement>(
          `.fcboard[data-fcboard-id="${api.id}"] canvas.fcboard__canvas.static, .fcboard[data-fcboard-id="${api.id}"] canvas.fcboard__canvas.new-element`,
        );
        for (const layer of layers) {
          context.drawImage(
            layer,
            left * scale,
            top * scale,
            (right - left) * scale,
            (bottom - top) * scale,
            0,
            0,
            output.width,
            output.height,
          );
        }
        return { elements, text, image: output.toDataURL("image/png") };
      }
    }
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

export const cropImage = async (
  dataURL: string,
  region: { left: number; top: number; right: number; bottom: number },
  signal: AbortSignal,
) => {
  signal.throwIfAborted();
  const image = new Image();
  image.src = dataURL;
  await image.decode();
  signal.throwIfAborted();
  const left = Math.max(0, Math.min(1, region.left));
  const top = Math.max(0, Math.min(1, region.top));
  const right = Math.max(left, Math.min(1, region.right));
  const bottom = Math.max(top, Math.min(1, region.bottom));
  if (right <= left || bottom <= top) {
    throw new Error(
      t(
        "fcboard.selection_is_outside_the_visible_document_circle_the_area_again",
      ),
    );
  }
  const scale = Math.min(
    1,
    1280 /
      Math.max(
        (right - left) * image.naturalWidth,
        (bottom - top) * image.naturalHeight,
      ),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(
    1,
    Math.ceil((right - left) * image.naturalWidth * scale),
  );
  canvas.height = Math.max(
    1,
    Math.ceil((bottom - top) * image.naturalHeight * scale),
  );
  canvas
    .getContext("2d")!
    .drawImage(
      image,
      left * image.naturalWidth,
      top * image.naturalHeight,
      (right - left) * image.naturalWidth,
      (bottom - top) * image.naturalHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  return canvas.toDataURL("image/png");
};

export const parseJSON = (text: string): unknown =>
  JSON.parse(
    text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, ""),
  );
