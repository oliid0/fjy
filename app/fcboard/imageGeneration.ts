import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { t } from "@fcboard/fcboard/i18n";

import type { FileId } from "@fcboard/element/types";

import type { DataURL, FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { currentSettings, validateEndpoint } from "./settings";
import { contentViewport, insertElements, insertionPoint } from "./board";
import { classroomCommands } from "./commands";
import { selectionSignature } from "./selection";
import { transparentInkImage } from "./transparentInkImage";

import type { ContentRect } from "./placement";

export const insertGeneratedImage = async (
  api: FcboardImperativeAPI,
  prompt: string,
  signal: AbortSignal,
  placement: {
    bounds?: ContentRect;
    replaceIds?: string[];
    sourceSignature?: string;
    sourcePage?: number;
    referenceImage?: string;
    transparent?: boolean;
  } = {},
) => {
  const revision = classroomCommands.revision;
  const onDocument = classroomCommands.has("document.draw");
  const settings = currentSettings();
  if (!settings.apiKey || !settings.imageModel.trim()) {
    throw new Error(
      t(
        "fcboard.functions_can_be_plotted_directly_set_an_image_model_id_in_settings_to_generate_illustrations",
      ),
    );
  }
  const endpoint = validateEndpoint(settings.endpoint);
  if (!/\/(chat\/completions|responses)\/?$/.test(endpoint)) {
    throw new Error(
      t("fcboard.image_generation_requires_an_ark_compatible_api_v3_endpoint"),
    );
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
    size: /^doubao-seedream-5-0-(flash|pro)-/.test(settings.imageModel)
      ? "1.5K"
      : "2048x2048",
    ...(/^doubao-seedream-5-0-/.test(settings.imageModel)
      ? { output_format: "png" }
      : {}),
    ...(placement.referenceImage ? { image: placement.referenceImage } : {}),
    watermark: false,
  };
  const requestImage = async (dataBody: Record<string, unknown>) => {
    signal.throwIfAborted();
    let status: number;
    let data;
    if (Capacitor.isNativePlatform()) {
      const response = await CapacitorHttp.post({
        url,
        headers,
        data: dataBody,
        connectTimeout: 15000,
        readTimeout: 90000,
      });
      status = response.status;
      data = response.data;
    } else {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(dataBody),
        signal,
      });
      status = response.status;
      data = await response.json();
    }
    signal.throwIfAborted();
    if (typeof data === "string") {
      data = JSON.parse(data);
    }
    if (status < 200 || status >= 300 || data?.error) {
      throw new Error(
        t("fcboard.image_generation_failed_status_message", {
          status,
          message:
            data?.error?.message ||
            t("fcboard.check_the_image_model_and_permissions"),
        }),
      );
    }
    const items = data?.data as
      | {
          b64_json?: string;
          z_index?: number;
          bounding_box?: { absolute?: number[] };
          error?: { message?: string };
        }[]
      | undefined;
    const failure =
      Array.isArray(items) && items.find((item) => item.error)?.error;
    if (failure) {
      throw new Error(
        t("fcboard.image_generation_failed_status_message", {
          status,
          message:
            failure.message ||
            t("fcboard.check_the_image_model_and_permissions"),
        }),
      );
    }
    if (!Array.isArray(items) || !items.length) {
      throw new Error(t("fcboard.the_image_service_returned_no_valid_image"));
    }
    return items;
  };
  const decodeImage = async (encoded?: string) => {
    if (
      typeof encoded !== "string" ||
      !encoded.length ||
      encoded.length > 30_000_000
    ) {
      throw new Error(t("fcboard.the_image_service_returned_no_valid_image"));
    }
    const mimeType: "image/jpeg" | "image/webp" | "image/png" | undefined =
      encoded.startsWith("/9j/")
        ? "image/jpeg"
        : encoded.startsWith("UklGR")
        ? "image/webp"
        : encoded.startsWith("iVBORw0KGgo")
        ? "image/png"
        : undefined;
    if (!mimeType) {
      throw new Error(
        t("fcboard.the_image_service_returned_an_unsupported_format"),
      );
    }
    const dataURL = `data:${mimeType};base64,${encoded}` as DataURL;
    const image = new Image();
    image.src = dataURL;
    await image.decode();
    signal.throwIfAborted();
    return { image, dataURL, mimeType };
  };
  const generated = await decodeImage((await requestImage(body))[0].b64_json);
  let { dataURL, mimeType } = generated;
  let drawing;
  if (placement.transparent) {
    // New text/sketch generations first require decomposition. The transparent
    // background option alone only supports an already-transparent input.
    const items = await requestImage({
      ...body,
      image: dataURL,
      prompt: `仅拆出以下要求对应的完整主体，多个主体保持相对位置。人物或动物的头、身体、四肢及其服饰合为完整主体图层；主体自身的白色和细节保留。背景、纸张、地面、投影、边框、装饰归入底图，不要拆成前景图层。要求：${prompt}`,
      layer_decomposition: true,
      size: "1.5K",
      output_format: "png",
    });
    const layers = items.filter((item) => (item.z_index ?? 0) > 0);
    if (!layers.length || layers.length > 16) {
      throw new Error(t("fcboard.no_subject_layers_returned"));
    }
    drawing = transparentInkImage(
      await Promise.all(
        layers.map(async (item) => {
          const box = item.bounding_box?.absolute;
          if (!Array.isArray(box) || box.length !== 4) {
            throw new Error(t("fcboard.no_subject_layers_returned"));
          }
          const decoded = await decodeImage(item.b64_json);
          if (decoded.mimeType !== "image/png") {
            throw new Error(t("fcboard.subject_layer_requires_transparency"));
          }
          return {
            image: decoded.image,
            zIndex: item.z_index!,
            bounds: {
              left: box[0],
              top: box[1],
              right: box[2],
              bottom: box[3],
            },
          };
        }),
      ),
    );
  }
  if (drawing) {
    dataURL = drawing.dataURL;
    mimeType = "image/png";
  }
  const naturalWidth = drawing?.width || generated.image.naturalWidth;
  const naturalHeight = drawing?.height || generated.image.naturalHeight;
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
    | { viewport: ContentRect; scale?: number }
    | undefined;
  const viewport =
    onDocument && layout ? layout.viewport : contentViewport(api);
  const bounds = placement.bounds;
  const viewScale = onDocument
    ? layout?.scale || 1
    : api.getAppState().zoom.value;
  // A one-line written prompt must produce a usable picture, rather than being
  // constrained to the handwriting line's height. Sketch edits retain its frame.
  const fitSource = !!placement.referenceImage && !!bounds;
  const scale = Math.min(
    (fitSource ? Math.max(1, bounds!.right - bounds!.left) : 400 / viewScale) /
      naturalWidth,
    (fitSource ? Math.max(1, bounds!.bottom - bounds!.top) : 400 / viewScale) /
      naturalHeight,
    (viewport.right - viewport.left) / naturalWidth,
    (viewport.bottom - viewport.top) / naturalHeight,
  );
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
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
