import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { t } from "@fcboard/fcboard/i18n";

import type { FileId } from "@fcboard/element/types";

import type { DataURL, FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { currentSettings, validateEndpoint } from "./settings";
import { contentViewport, insertElements, insertionPoint } from "./board";
import { classroomCommands } from "./commands";
import { selectionSignature } from "./selection";

import type { ContentRect } from "./placement";

export type GeneratedImage = {
  dataURL: DataURL;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
};
export type ImagePlacement = {
  bounds?: ContentRect;
  replaceIds?: string[];
  sourceSignature?: string;
  sourcePage?: number;
  referenceImage?: string;
  transparent?: boolean;
};

/** Produce a real preview without changing the board before the user chooses it. */
export const generateImage = async (
  prompt: string,
  signal: AbortSignal,
  placement: ImagePlacement = {},
): Promise<GeneratedImage> => {
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
    output_format: "png",
    ...(placement.referenceImage ? { image: placement.referenceImage } : {}),
    ...(placement.transparent ? { background: "transparent" } : {}),
    ...(/^doubao-seedream-5-0-pro-/.test(settings.imageModel)
      ? { optimize_prompt_options: { mode: "fast" } }
      : {}),
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
  signal.throwIfAborted();
  return {
    dataURL: generated.dataURL,
    mimeType: generated.mimeType,
    width: generated.image.naturalWidth,
    height: generated.image.naturalHeight,
  };
};

/** Existing callers still generate and insert atomically; candidate menus may
 * insert a previously generated preview without a second network request. */
export const insertGeneratedImage = async (
  api: FcboardImperativeAPI,
  prompt: string,
  signal: AbortSignal,
  placement: ImagePlacement = {},
) => {
  const revision = classroomCommands.revision;
  const onDocument = classroomCommands.has("document.draw");
  const image = await generateImage(prompt, signal, placement);
  if (
    classroomCommands.revision !== revision ||
    onDocument !== classroomCommands.has("document.draw")
  ) {
    throw new DOMException("Canvas changed", "AbortError");
  }
  return insertImageResult(api, image, signal, placement);
};

export const insertImageResult = async (
  api: FcboardImperativeAPI,
  image: GeneratedImage,
  signal: AbortSignal,
  placement: ImagePlacement = {},
) => {
  signal.throwIfAborted();
  const onDocument = classroomCommands.has("document.draw");
  const {
    dataURL,
    mimeType,
    width: naturalWidth,
    height: naturalHeight,
  } = image;
  if (
    !Number.isFinite(naturalWidth) ||
    !Number.isFinite(naturalHeight) ||
    naturalWidth <= 0 ||
    naturalHeight <= 0
  ) {
    throw new Error(t("fcboard.the_image_service_returned_no_valid_image"));
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
