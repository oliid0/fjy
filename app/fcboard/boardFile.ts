import { Capacitor, registerPlugin } from "@capacitor/core";
import { fileOpen, fileSave } from "browser-fs-access";
import { getDataURL } from "@fcboard/fcboard/data/blob";
import { getLanguage } from "@fcboard/fcboard/i18n";

import { serializeBzd, parseBzd } from "./bzd";
import { classroomCommands } from "./commands";

import type { Board } from "./boards";
import type { BzdAssetLoader } from "./bzd";

const engine = registerPlugin<{
  begin(options: {
    size: number;
    kind?: "jpg" | "pdf";
    pages?: { page: number; size: number }[];
  }): Promise<{ id: string }>;
  append(options: { id: string; offset: number; data: string }): Promise<void>;
  save(options: {
    id: string;
    language: string;
  }): Promise<{ saved: boolean; uri?: string }>;
  readAsset(options: {
    path: string;
    transform?: Parameters<BzdAssetLoader>[1];
  }): ReturnType<BzdAssetLoader>;
  choose(options: {
    requestId: string;
    language: string;
    kind?: "image";
  }): Promise<{
    cancelled?: boolean;
    id?: string;
    name?: string;
    size?: number;
    mimeType?: string;
  }>;
  read(options: {
    id: string;
    offset: number;
  }): Promise<{ data: string; next: number }>;
  cancelBrowser(options: { id: string }): Promise<{ cancelled: boolean }>;
  close(options: { id: string }): Promise<void>;
}>("FcboardBoardFile");
const MAX_FILE = 64 * 1024 * 1024;
const isAbort = (error: unknown) =>
  error !== null &&
  typeof error === "object" &&
  "name" in error &&
  error.name === "AbortError";

/** FileBrowserPopu on Android; received bytes still enter the same BZD parser. */
const pickFile = async (
  kind: "bzd" | "image",
  signal?: AbortSignal,
): Promise<File | undefined> => {
  signal?.throwIfAborted();
  if (!Capacitor.isNativePlatform()) {
    try {
      const file = await fileOpen({
        extensions:
          kind === "bzd"
            ? [".bzd", ".bz", ".bnf"]
            : [".jpg", ".jpeg", ".png", ".bmp", ".webp", ".gif"],
        mimeTypes:
          kind === "bzd"
            ? ["application/xml", "text/xml", "application/octet-stream"]
            : [
                "image/jpeg",
                "image/png",
                "image/bmp",
                "image/webp",
                "image/gif",
              ],
        description: kind === "bzd" ? "HWhiteBoard BZD" : "Image",
      });
      signal?.throwIfAborted();
      if (file.size > MAX_FILE) {
        throw new Error("BZD file is too large");
      }
      return file;
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      if (isAbort(error)) {
        return undefined;
      }
      throw error;
    }
  }
  const requestId = crypto.randomUUID();
  const cancel = () => {
    void engine.cancelBrowser({ id: requestId }).catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  let selected: Awaited<ReturnType<typeof engine.choose>>;
  try {
    selected = await engine.choose({
      requestId,
      language: getLanguage().code,
      ...(kind === "image" ? { kind } : {}),
    });
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
  if (selected.cancelled) {
    signal?.throwIfAborted();
    return undefined;
  }
  const id = selected.id;
  if (typeof id !== "string" || !id) {
    throw new Error("Invalid board file selection");
  }
  let result: File;
  try {
    signal?.throwIfAborted();
    if (
      typeof selected.name !== "string" ||
      typeof selected.size !== "number" ||
      !Number.isSafeInteger(selected.size) ||
      selected.size < 1 ||
      selected.size > MAX_FILE
    ) {
      throw new Error("BZD file is too large or unavailable");
    }
    const chunks: ArrayBuffer[] = [];
    for (let offset = 0; offset < selected.size; ) {
      signal?.throwIfAborted();
      const { data, next } = await engine.read({ id, offset });
      signal?.throwIfAborted();
      const bytes = Uint8Array.from(atob(data), (character) =>
        character.charCodeAt(0),
      );
      if (
        !bytes.length ||
        bytes.length > 262144 ||
        next !== offset + bytes.length ||
        next > selected.size
      ) {
        throw new Error("Incomplete board file read");
      }
      chunks.push(bytes.buffer as ArrayBuffer);
      offset = next;
    }
    if (
      kind === "image" &&
      ![
        "image/jpeg",
        "image/png",
        "image/bmp",
        "image/webp",
        "image/gif",
      ].includes(selected.mimeType || "")
    ) {
      throw new Error("Unsupported image file");
    }
    result = new File(chunks, selected.name, {
      type: kind === "bzd" ? "application/xml" : selected.mimeType,
    });
  } finally {
    await engine.close({ id }).catch(() => {});
  }
  signal?.throwIfAborted();
  return result;
};
export const pickBoardFile = (signal?: AbortSignal) => pickFile("bzd", signal);
export const pickImageFile = (signal?: AbortSignal) =>
  pickFile("image", signal);
/** The editor uses its existing multi-image browser picker on the web. */
export const nativeImagePicker = Capacitor.isNativePlatform()
  ? async () => {
      const controller = new AbortController();
      const stop = classroomCommands.onInvalidate(() => controller.abort());
      let image: File | undefined;
      try {
        image = await pickImageFile(controller.signal);
      } finally {
        stop();
      }
      if (!image) {
        throw new DOMException("Image selection canceled", "AbortError");
      }
      return [image];
    }
  : undefined;
export const openBoardFile = (text: string) =>
  parseBzd(
    text,
    Capacitor.isNativePlatform()
      ? (path, transform) => engine.readAsset({ path, transform })
      : undefined,
  );
export const saveBoardFile = async (
  boards: readonly Board[],
  name: string,
  signal?: AbortSignal,
) => {
  signal?.throwIfAborted();
  const xml = serializeBzd(boards);
  const blob = new Blob([xml], { type: "application/xml" });
  if (blob.size > MAX_FILE) {
    throw new Error("BZD file is too large");
  }
  if (!Capacitor.isNativePlatform()) {
    try {
      await fileSave(blob, {
        fileName: `${name}.bzd`,
        description: "HWhiteBoard BZD",
        extensions: [".bzd"],
        mimeTypes: ["application/xml"],
      });
      return true;
    } catch (error) {
      if (isAbort(error)) {
        return false;
      }
      throw error;
    }
  }
  return saveNativeFile(blob, undefined, signal);
};
const saveNativeFile = async (
  blob: Blob,
  metadata?: { kind: "jpg" | "pdf"; pages: { page: number; size: number }[] },
  signal?: AbortSignal,
) => {
  signal?.throwIfAborted();
  const { id } = await engine.begin({ size: blob.size, ...metadata });
  try {
    for (let offset = 0; offset < blob.size; offset += 262144) {
      signal?.throwIfAborted();
      const data = await getDataURL(blob.slice(offset, offset + 262144));
      signal?.throwIfAborted();
      await engine.append({
        id,
        offset,
        data: data.slice(data.indexOf(",") + 1),
      });
    }
    signal?.throwIfAborted();
    const cancel = () => {
      void engine.cancelBrowser({ id }).catch(() => {});
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const result = await engine.save({ id, language: getLanguage().code });
      signal?.throwIfAborted();
      return result.saved;
    } catch (error) {
      signal?.throwIfAborted();
      throw error;
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  } finally {
    await engine.close({ id }).catch(() => {});
  }
};

/** One original SAVE_JPG / SAVE_PDF dialog; JPG names keep original page numbers. */
export const savePageFiles = async (
  pages: { page: number; blob: Blob }[],
  name: string,
  format: "jpg" | "pdf",
  signal?: AbortSignal,
) => {
  signal?.throwIfAborted();
  let previous = 0;
  const metadata = pages.map(({ page, blob }) => {
    if (
      !Number.isInteger(page) ||
      page <= previous ||
      page > 100 ||
      blob.type !== "image/jpeg" ||
      blob.size < 1 ||
      blob.size > 16 * 1024 * 1024
    ) {
      throw new Error("Invalid exported page image");
    }
    previous = page;
    return { page, size: blob.size };
  });
  const blob = new Blob(pages.map((page) => page.blob));
  if (!pages.length || pages.length > 20 || blob.size > MAX_FILE) {
    throw new Error("Choose 1–20 pages, up to 64 MB");
  }
  if (Capacitor.isNativePlatform()) {
    return saveNativeFile(blob, { kind: format, pages: metadata }, signal);
  }
  if (format === "pdf") {
    throw new Error("PDF file saving requires the Android whiteboard");
  }
  try {
    for (const { page, blob } of pages) {
      signal?.throwIfAborted();
      await fileSave(blob, {
        fileName: `${name}_${String(page).padStart(2, "0")}.jpg`,
        extensions: [".jpg"],
        mimeTypes: ["image/jpeg"],
      });
    }
    return true;
  } catch (error) {
    if (isAbort(error)) {
      return false;
    }
    throw error;
  }
};
