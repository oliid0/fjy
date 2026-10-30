import { Capacitor } from "@capacitor/core";
import { t } from "@fcboard/fcboard/i18n";
import { exportToBlob } from "@fcboard/fcboard";
import { getDataURL } from "@fcboard/fcboard/data/blob";
import { getSelectedElements } from "@fcboard/element";

import type { FcboardElement } from "@fcboard/element/types";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { AIStream, postAI, readAIResult } from "./aiTransport";
import { currentSettings, validateEndpoint } from "./settings";
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

// A short, stable system prefix allows provider-side KV reuse without reusing
// answers or mixing a previous selection into the current request.
const cacheRoutes = new Map<string, string>();
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
  } = {},
): Promise<string> => {
  if (!settings.apiKey || !settings.model.trim()) {
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
  const body = {
    model: settings.model.trim(),
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
    temperature: 0.2,
    ...(options.maxTokens
      ? { [responses ? "max_output_tokens" : "max_tokens"]: options.maxTokens }
      : {}),
    ...(ark
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
    const request = async () => {
      const output = new AIStream(responses, (delta) => {
        if (!controller.signal.aborted) {
          options.onDelta?.(delta);
        }
      });
      const response = await postAI(
        url,
        settings.apiKey,
        body,
        controller.signal,
        (chunk) => output.push(chunk),
      );
      controller.signal.throwIfAborted();
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
      return response.stream
        ? output.finish()
        : readAIResult(response.data, responses);
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
