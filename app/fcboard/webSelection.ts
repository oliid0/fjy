import { CapacitorHttp } from "@capacitor/core";

import type { FcboardImperativeAPI, DataURL } from "@fcboard/fcboard/types";

import type { FileId } from "@fcboard/element/types";

import { classroomCommands } from "./commands";

import { insertionPoint, insertElements } from "./board";

/** Native long-press imports into the visible surface, through the existing object paths. */
export const insertWebSelection = async (
  api: FcboardImperativeAPI,
  selection: { kind: "text" | "image"; value: string },
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
  const url = new URL(selection.value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error("Invalid selected webpage image");
  }
  const response = await CapacitorHttp.get({
    url: url.href,
    responseType: "arraybuffer",
    connectTimeout: 15000,
    readTimeout: 30000,
  });
  signal.throwIfAborted();
  const contentType = Object.entries(response.headers)
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
  const dataURL = `data:${contentType};base64,${response.data.replace(
    /\s/g,
    "",
  )}` as DataURL;
  const image = new Image();
  image.src = dataURL;
  await image.decode();
  signal.throwIfAborted();
  if (!classroomCommands.isCurrent(revision, signal)) {
    throw new DOMException("Visible surface changed", "AbortError");
  }
  const scale = Math.min(
    1,
    400 / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  if (!Number.isFinite(width + height) || width <= 0 || height <= 0) {
    throw new Error("Selected webpage image is empty");
  }
  if (classroomCommands.has("document.draw")) {
    const layout = classroomCommands.read("document.layout") as
      | { viewport: { left: number; top: number } }
      | undefined;
    if (!layout) {
      throw new DOMException("Document is not ready", "AbortError");
    }
    return classroomCommands.execute({
      name: "document.draw",
      args: {
        lesson: "web",
        progress: 1,
        image: dataURL,
        signal,
        shape: {
          id: crypto.randomUUID(),
          type: "image",
          x: layout.viewport.left + 20,
          y: layout.viewport.top + 20,
          width,
          height,
        },
      },
    });
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
  return insertElements(api, [
    {
      type: "image",
      fileId,
      ...insertionPoint(api, { width, height }),
      width,
      height,
    },
  ]);
};
