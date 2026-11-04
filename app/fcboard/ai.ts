import { Capacitor } from "@capacitor/core";
import { t } from "@fcboard/fcboard/i18n";
import { exportToBlob } from "@fcboard/fcboard";
import { getDataURL } from "@fcboard/fcboard/data/blob";
import { getSelectedElements } from "@fcboard/element";

import type { FcboardElement } from "@fcboard/element/types";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { AIStream, postAI, readAIResult } from "./aiTransport";
import { currentSettings, defaults, validateEndpoint } from "./settings";
import { handwritingText } from "./handwriting";

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
  options: {
    maxTokens?: number;
    onDelta?: (text: string) => void;
    onReset?: () => void;
    timeoutMs?: number;
    webSearch?: boolean;
  } = {},
): Promise<string> => {
  const visual = messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === "image_url"),
  );
  const model = (
    visual ? settings.ocrModel.trim() || settings.model : settings.model
  ).trim();
  if (!settings.apiKey || !model) {
    throw new Error(
      t(
        "fcboard.set_an_api_key_and_a_vision_model_or_endpoint_id_in_ai_settings",
      ),
    );
  }
  const url = validateEndpoint(settings.endpoint);
  const responses = new URL(url).pathname.endsWith("/responses");
  const ark = new URL(url).hostname === "ark.cn-beijing.volces.com";
  const streaming =
    !Capacitor.isNativePlatform() ||
    Capacitor.isPluginAvailable("FcboardClassroom");
  // Only the shipped text model opts into fast. Vision and custom models use
  // the provider's ordinary schema, without model-specific tuning parameters.
  const fast = ark && !visual && model === defaults.model && streaming;
  const body = {
    model,
    ...(responses
      ? {
          input: messages.map((message) => ({
            role: message.role,
            content:
              typeof message.content === "string"
                ? message.content
                : message.content.map((part) =>
                    part.type === "text"
                      ? { type: "input_text", text: part.text }
                      : { type: "input_image", image_url: part.image_url.url },
                  ),
          })),
        }
      : { messages }),
    stream: streaming,
    ...(options.webSearch
      ? responses
        ? { tools: [{ type: "web_search" }] }
        : { web_search_options: {} }
      : {}),
    ...(options.maxTokens
      ? { [responses ? "max_output_tokens" : "max_tokens"]: options.maxTokens }
      : {}),
  };
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) {
    cancel();
  }
  const timeoutMs = Math.max(1000, Math.min(90000, options.timeoutMs || 90000));
  const timer = setTimeout(
    () =>
      controller.abort(
        new Error(
          t(
            "fcboard.ai_request_timed_out_check_your_connection_or_try_again_later",
          ),
        ),
      ),
    timeoutMs,
  );
  let unsubscribe = () => {};
  try {
    controller.signal.throwIfAborted();
    const cancelled = new Promise<never>((_, reject) => {
      const abort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", abort, { once: true });
      unsubscribe = () => controller.signal.removeEventListener("abort", abort);
    });
    const request = async (accelerated: boolean): Promise<string> => {
      const attempt = new AbortController();
      const abortAttempt = () => attempt.abort(controller.signal.reason);
      controller.signal.addEventListener("abort", abortAttempt, { once: true });
      // Leave time for ordinary inference if fast stalls instead of consuming
      // the whole request deadline. Only cancellable transports opt into fast.
      let fastTimer: ReturnType<typeof setTimeout> | undefined;
      const renewFastDeadline = () => {
        clearTimeout(fastTimer);
        if (accelerated) {
          fastTimer = setTimeout(
            () => attempt.abort(new Error("Fast request timed out")),
            Math.min(30000, timeoutMs / 2),
          );
        }
      };
      renewFastDeadline();
      // Callers with no reset hook receive a fast preview only after completion.
      // This lets a failed partial fast stream be discarded without duplicate text.
      const deferPreview = accelerated && !!options.onDelta && !options.onReset;
      const output = new AIStream(responses, (delta) => {
        if (
          !controller.signal.aborted &&
          !attempt.signal.aborted &&
          !deferPreview
        ) {
          options.onDelta?.(delta);
        }
      });
      try {
        const response = await postAI(
          url,
          settings.apiKey,
          accelerated ? { ...body, service_tier: "fast" } : body,
          attempt.signal,
          (chunk) => {
            renewFastDeadline();
            output.push(chunk);
          },
        );
        controller.signal.throwIfAborted();
        attempt.signal.throwIfAborted();
        if (response.status < 200 || response.status >= 300) {
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
        const result = response.stream
          ? output.finish()
          : readAIResult(response.data, responses);
        if (deferPreview) {
          options.onDelta?.(result);
        }
        return result;
      } catch (failure) {
        controller.signal.throwIfAborted();
        // Retry once with the same endpoint/model/input and ordinary parameters.
        if (accelerated) {
          options.onReset?.();
          return request(false);
        }
        throw failure;
      } finally {
        clearTimeout(fastTimer);
        controller.signal.removeEventListener("abort", abortAttempt);
      }
    };
    return await Promise.race([request(fast), cancelled]);
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
