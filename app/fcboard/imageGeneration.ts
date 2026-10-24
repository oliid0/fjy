import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { t } from "@excalidraw/excalidraw/i18n";

import type {
  DataURL,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/element/types";

import { currentSettings, validateEndpoint } from "./settings";
import { contentViewport, insertElements, insertionPoint } from "./board";
import { classroomCommands } from "./commands";
import { selectionSignature } from "./selection";

import type { ContentRect } from "./placement";

export const insertGeneratedImage = async (
  api: ExcalidrawImperativeAPI,
  prompt: string,
  signal: AbortSignal,
  placement: {
    bounds?: ContentRect;
    replaceIds?: string[];
    sourceSignature?: string;
    sourcePage?: number;
  } = {},
) => {
  const revision = classroomCommands.revision;
  const onDocument = classroomCommands.has("document.draw");
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
  if (
    classroomCommands.revision !== revision ||
    onDocument !== classroomCommands.has("document.draw")
  ) {
    throw new DOMException("Canvas changed", "AbortError");
  }
  if (
    !onDocument &&
    placement.sourceSignature &&
    selectionSignature(
      api
        .getSceneElements()
        .filter((element) => placement.replaceIds?.includes(element.id)),
    ) !== placement.sourceSignature
  ) {
    throw new DOMException("Source changed", "AbortError");
  }
  const layout = classroomCommands.read("document.layout") as
    | { viewport: ContentRect }
    | undefined;
  const viewport =
    onDocument && layout ? layout.viewport : contentViewport(api);
  const bounds = placement.bounds;
  const scale = Math.min(
    (bounds ? Math.max(1, bounds.right - bounds.left) : 400) /
      image.naturalWidth,
    (bounds ? Math.max(1, bounds.bottom - bounds.top) : 400) /
      image.naturalHeight,
    (viewport.right - viewport.left) / image.naturalWidth,
    (viewport.bottom - viewport.top) / image.naturalHeight,
  );
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const position = bounds
    ? {
        x: Math.max(
          viewport.left,
          Math.min(
            viewport.right - width,
            (bounds.left + bounds.right - width) / 2,
          ),
        ),
        y: Math.max(
          viewport.top,
          Math.min(
            viewport.bottom - height,
            (bounds.top + bounds.bottom - height) / 2,
          ),
        ),
      }
    : onDocument
    ? { x: viewport.left, y: viewport.top }
    : insertionPoint(api, { width, height });
  if (onDocument) {
    await classroomCommands.execute({
      name: "document.draw",
      args: {
        lesson: "image",
        progress: 1,
        image: dataURL,
        replaceIds: placement.replaceIds,
        sourceSignature: placement.sourceSignature,
        sourcePage: placement.sourcePage,
        signal,
        shape: {
          id: crypto.randomUUID(),
          type: "image",
          ...position,
          width,
          height,
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
        ...position,
        width,
        height,
        fileId,
      },
    ],
    placement.replaceIds || [],
    !bounds,
  );
};
