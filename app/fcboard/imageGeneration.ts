import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { t } from "@excalidraw/excalidraw/i18n";

import type {
  DataURL,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/element/types";

import { currentSettings, validateEndpoint } from "./settings";
import { insertElements, insertionPoint } from "./board";
import { classroomCommands } from "./commands";

export const insertGeneratedImage = async (
  api: ExcalidrawImperativeAPI,
  prompt: string,
  signal: AbortSignal,
) => {
  const settings = currentSettings();
  if (!settings.apiKey || !settings.imageModel.trim()) {
    throw new Error(
      t("fcboard.函数可直接绘制；生成插图请先在设置中填写图像生成模型 ID"),
    );
  }
  const endpoint = validateEndpoint(settings.endpoint);
  if (!/\/(chat\/completions|responses)\/?$/.test(endpoint)) {
    throw new Error(t("fcboard.图像生成需要兼容方舟 /api/v3 接口地址"));
  }
  const url = endpoint.replace(
    /\/(chat\/completions|responses)\/?$/,
    "/images/generations",
  );
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${settings.apiKey}`,
  };
  const body = {
    model: settings.imageModel.trim(),
    prompt,
    response_format: "b64_json",
    size: "2048x2048",
    watermark: false,
  };
  signal.throwIfAborted();
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
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    status = response.status;
    data = await response.json();
  }
  signal.throwIfAborted();
  if (typeof data === "string") {
    data = JSON.parse(data);
  }
  if (status < 200 || status >= 300) {
    throw new Error(
      t("fcboard.图像生成失败 ({{status}})：{{message}}", {
        status,
        message: data?.error?.message || t("fcboard.请检查图像模型与权限"),
      }),
    );
  }
  const encoded = data?.data?.[0]?.b64_json;
  if (
    typeof encoded !== "string" ||
    !encoded.length ||
    encoded.length > 30_000_000
  ) {
    throw new Error(t("fcboard.图像服务未返回有效图片"));
  }
  const mimeType = encoded.startsWith("/9j/")
    ? "image/jpeg"
    : encoded.startsWith("UklGR")
    ? "image/webp"
    : encoded.startsWith("iVBORw0KGgo")
    ? "image/png"
    : undefined;
  if (!mimeType) {
    throw new Error(t("fcboard.图像服务返回了不支持的图片格式"));
  }
  const dataURL = `data:${mimeType};base64,${encoded}` as DataURL;
  const image = new Image();
  image.src = dataURL;
  await image.decode();
  signal.throwIfAborted();
  if (classroomCommands.has("document.draw")) {
    await classroomCommands.execute({
      name: "document.draw",
      args: {
        lesson: "image",
        progress: 1,
        image: dataURL,
        shape: {
          id: crypto.randomUUID(),
          type: "image",
          x: 60,
          y: 60,
          width: 400,
          height: (400 * image.naturalHeight) / image.naturalWidth,
        },
      },
    });
    return;
  }
  const fileId = crypto.randomUUID() as FileId;
  api.addFiles([{ id: fileId, dataURL, mimeType, created: Date.now() }]);
  insertElements(
    api,
    [
      {
        type: "image",
        ...insertionPoint(api, {
          width: 400,
          height: (400 * image.naturalHeight) / image.naturalWidth,
        }),
        width: 400,
        height: (400 * image.naturalHeight) / image.naturalWidth,
        fileId,
      },
    ],
    [],
    true,
  );
};
