import { CapacitorHttp } from "@capacitor/core";

import type { FcboardImperativeAPI, DataURL } from "@fcboard/fcboard/types";

import type { FileId } from "@fcboard/element/types";

import { classroomCommands } from "./commands";

import { insertionPoint, insertElements } from "./board";

/** Native long-press imports into the visible surface, through the existing object paths. */
export const insertWebSelection = async (
  api: FcboardImperativeAPI,
  selection: {
    kind: "text" | "image";
    value: string;
    sourceUrl?: string;
    userAgent?: string;
  },
  signal: AbortSignal,
) => {
  signal.throwIfAborted();
  const revision = classroomCommands.revision;
  if (selection.kind === "text") {
    if (!selection.value.trim() || selection.value.length > 10000) {
      throw new Error("Invalid selected webpage text");
    }
    return classroomCommands.execute({
      name: "canvas.text",
      args: {
        text: selection.value,
        sourceIds: [],
        presentation: "text",
        placement: "center",
        signal,
      },
    });
  }
  if (selection.value.length > 28_000_000) {
    throw new Error("Invalid selected webpage image");
  }
  const inline =
    /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      selection.value,
    );
  let contentType = inline?.[1];
  let dataURL = selection.value as DataURL;
  if (!inline) {
    const url = new URL(selection.value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new Error("Invalid selected webpage image");
    }
    const headers: Record<string, string> = {};
    if (selection.sourceUrl) {
      const source = new URL(selection.sourceUrl);
      if (
        ["http:", "https:"].includes(source.protocol) &&
        !source.username &&
        !source.password
      ) {
        headers.Referer =
          source.origin === url.origin ? source.href : `${source.origin}/`;
      }
    }
    if (
      selection.userAgent &&
      selection.userAgent.length < 2000 &&
      !/[\r\n]/.test(selection.userAgent)
    ) {
      headers["User-Agent"] = selection.userAgent;
    }
    const response = await CapacitorHttp.get({
      url: url.href,
      headers,
      responseType: "arraybuffer",
      connectTimeout: 15000,
      readTimeout: 30000,
    });
    signal.throwIfAborted();
    contentType = Object.entries(response.headers)
      .find(([key]) => key.toLowerCase() === "content-type")?.[1]
      ?.split(";")[0];
    if (
      response.status < 200 ||
      response.status >= 300 ||
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        contentType || "",
      ) ||
      typeof response.data !== "string" ||
      response.data.length > 28_000_000
    ) {
      throw new Error("Could not load the selected webpage image");
    }
    dataURL = `data:${contentType};base64,${response.data.replace(
      /\s/g,
      "",
    )}` as DataURL;
  }
  const image = new Image();
  image.src = dataURL;
  await image.decode();
  signal.throwIfAborted();
  if (!classroomCommands.isCurrent(revision, signal)) {
    throw new DOMException("Visible surface changed", "AbortError");
  }
  const documentLayout = classroomCommands.read("document.layout") as
    | {
        scale?: number;
        viewport: {
          left: number;
          top: number;
          right?: number;
          bottom?: number;
        };
      }
    | undefined;
  const viewportScale = documentLayout?.scale || api.getAppState().zoom.value;
  // HCanvas.initHBitmapObject fits the original bitmap within 940 physical
  // pixels without upscaling, then centers it in the visible board.
  const bitmapScale = Math.min(
    1,
    940 / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const units = 1 / ((window.devicePixelRatio || 1) * viewportScale);
  const width = image.naturalWidth * bitmapScale * units;
  const height = image.naturalHeight * bitmapScale * units;
  if (!Number.isFinite(width + height) || width <= 0 || height <= 0) {
    throw new Error("Selected webpage image is empty");
  }
  if (classroomCommands.has("document.draw")) {
    const layout = documentLayout;
    if (!layout) {
      throw new DOMException("Document is not ready", "AbortError");
    }
    const id = crypto.randomUUID();
    await classroomCommands.execute({
      name: "document.draw",
      args: {
        lesson: "web",
        progress: 1,
        image: dataURL,
        signal,
        shape: {
          id,
          type: "image",
          x:
            layout.viewport.right === undefined
              ? layout.viewport.left + 20
              : (layout.viewport.left + layout.viewport.right - width) / 2,
          y:
            layout.viewport.bottom === undefined
              ? layout.viewport.top + 20
              : (layout.viewport.top + layout.viewport.bottom - height) / 2,
          width,
          height,
        },
      },
    });
    if (classroomCommands.has("document.select")) {
      await classroomCommands.execute({
        name: "document.select",
        args: { ids: [id] },
      });
      await classroomCommands.execute({
        name: "document.tool",
        args: { tool: "selection" },
      });
    }
    return [id];
  }
  const fileId = crypto.randomUUID() as FileId;
  api.addFiles([
    {
      id: fileId,
      dataURL,
      mimeType: contentType as
        | "image/png"
        | "image/jpeg"
        | "image/webp"
        | "image/gif",
      created: Date.now(),
    },
  ]);
  const ids = insertElements(api, [
    {
      type: "image",
      fileId,
      ...insertionPoint(api, { width, height }),
      width,
      height,
    },
  ]);
  api.setActiveTool({ type: "lasso" });
  const selected = api
    .getSceneElements()
    .find((element) => element.id === ids[0])!;
  const padding = 20 / api.getAppState().zoom.value;
  api.updateScene({
    appState: {
      selectedElementIds: Object.fromEntries(ids.map((id) => [id, true])),
      selectedGroupIds: {},
      selectedLinearElement: null,
      whiteboardSelection: {
        elementIds: ids,
        bounds: {
          left: selected.x - padding,
          top: selected.y - padding,
          right: selected.x + selected.width + padding,
          bottom: selected.y + selected.height + padding,
        },
      },
    },
  });
  return ids;
};
