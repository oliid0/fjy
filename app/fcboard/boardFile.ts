import { Capacitor, registerPlugin } from "@capacitor/core";
import { fileOpen, fileSave } from "browser-fs-access";
import { getDataURL } from "@fcboard/fcboard/data/blob";

import { serializeBzd, parseBzd } from "./bzd";
import { classroomCommands } from "./commands";
import { exportMediaFiles } from "./mediaPlaylist";

import type { Board } from "./boards";
import type { BzdAssetLoader } from "./bzd";

const engine = registerPlugin<{
  begin(options: {
    size: number;
    kind?: "jpg" | "pdf" | "document-pdf" | "docx" | "xlsx";
    pages?: { page: number; size: number }[];
  }): Promise<{ id: string }>;
  append(options: { id: string; offset: number; data: string }): Promise<void>;
  save(options: {
    id: string;
    name: string;
  }): Promise<{ saved: boolean; uri?: string }>;
  readAsset(options: {
    path: string;
    transform?: Parameters<BzdAssetLoader>[1];
  }): ReturnType<BzdAssetLoader>;
  choose(options: { requestId: string }): Promise<{
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

/** Image-only selection for the editor's image and background controls. */
export const pickImageFile = async (
  signal?: AbortSignal,
): Promise<File | undefined> => {
  signal?.throwIfAborted();
  if (!Capacitor.isNativePlatform()) {
    try {
      const file = await fileOpen({
        extensions: [".jpg", ".jpeg", ".png", ".bmp", ".webp", ".gif"],
        mimeTypes: [
          "image/jpeg",
          "image/png",
          "image/bmp",
          "image/webp",
          "image/gif",
        ],
        description: "Image",
      });
      signal?.throwIfAborted();
      if (file.size > MAX_FILE) {
        throw new Error("Image file is too large");
      }
      return file;
    } catch (error) {
      signal?.throwIfAborted();
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
    throw new Error("Invalid image file selection");
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
      throw new Error("Image file is too large or unavailable");
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
      type: selected.mimeType,
    });
  } finally {
    await engine.close({ id }).catch(() => {});
  }
  signal?.throwIfAborted();
  return result;
};
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
export const boardFileContent = async (
  boards: readonly Board[],
  signal?: AbortSignal,
  activeId?: string,
) => {
  const keys = boards.flatMap((board) =>
    board.elements.flatMap((element) =>
      !element.isDeleted &&
      element.customData?.fcInteractiveResource?.media?.key
        ? [element.customData.fcInteractiveResource.media.key]
        : [],
    ),
  );
  const media = await exportMediaFiles(keys, signal);
  signal?.throwIfAborted();
  const xml = serializeBzd(boards, { media, activeId });
  if (new Blob([xml]).size > MAX_FILE) {
    throw new Error("BZD file is too large");
  }
  return xml;
};
export const saveBoardFile = async (
  boards: readonly Board[],
  name: string,
  signal?: AbortSignal,
  activeId?: string,
) => {
  signal?.throwIfAborted();
  const content = boardFileContent(boards, signal, activeId).then(
    (xml) => new Blob([xml], { type: "application/xml" }),
  );
  if (!Capacitor.isNativePlatform()) {
    return saveBrowserFile(content, name, "bzd", "application/octet-stream");
  }
  return saveNativeFile(await content, name, undefined, signal);
};

const saveBrowserFile = async (
  content: Blob | Promise<Blob>,
  name: string,
  extension: string,
  mime: string,
) => {
  // The system picker may be dismissed before deferred content finishes.
  if (content instanceof Promise) {
    void content.catch(() => {});
  }
  try {
    await fileSave(content, {
      fileName: `${name}.${extension}`,
      extensions: [`.${extension}`],
      mimeTypes: [mime],
    });
    return true;
  } catch (error) {
    if (isAbort(error)) {
      return false;
    }
    throw error;
  }
};
const saveNativeFile = async (
  blob: Blob,
  name: string,
  metadata?:
    | { kind: "jpg" | "pdf"; pages: { page: number; size: number }[] }
    | { kind: "document-pdf" | "docx" | "xlsx" },
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
      const result = await engine.save({
        id,
        name,
      });
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

export const saveDocumentPdf = async (
  content: Promise<Blob>,
  name: string,
  signal?: AbortSignal,
) => {
  if (Capacitor.isNativePlatform()) {
    return saveNativeFile(
      await content,
      name,
      { kind: "document-pdf" },
      signal,
    );
  }
  return saveBrowserFile(content, name, "pdf", "application/pdf");
};

export const saveOfficeDocument = async (
  content: Promise<Blob>,
  name: string,
  extension: "docx" | "xlsx",
  signal?: AbortSignal,
) => {
  if (Capacitor.isNativePlatform()) {
    return saveNativeFile(await content, name, { kind: extension }, signal);
  }
  const mime =
    extension === "docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return saveBrowserFile(content, name, extension, mime);
};

type PageImage = { page: number; blob: Blob | (() => Promise<Blob>) };

/** Save selected pages through the system picker; images keep their page numbers. */
export const savePageFiles = async (
  pages: PageImage[],
  name: string,
  format: "jpg" | "pdf",
  signal?: AbortSignal,
) => {
  signal?.throwIfAborted();
  if (!pages.length || pages.length > 100) {
    throw new Error("Choose 1–100 pages, up to 64 MB");
  }
  let previous = 0;
  for (const { page } of pages) {
    if (!Number.isInteger(page) || page <= previous || page > 100) {
      throw new Error("Invalid exported page number");
    }
    previous = page;
  }
  let total = 0;
  const readImage = async (image: PageImage) => {
    signal?.throwIfAborted();
    const blob =
      typeof image.blob === "function" ? await image.blob() : image.blob;
    signal?.throwIfAborted();
    if (
      blob.type !== "image/jpeg" ||
      blob.size < 1 ||
      blob.size > 16 * 1024 * 1024
    ) {
      throw new Error("Invalid exported page image");
    }
    total += blob.size;
    if (total > MAX_FILE) {
      throw new Error("Choose 1–100 pages, up to 64 MB");
    }
    return blob;
  };
  const readAll = async () => {
    const blobs: Blob[] = [];
    for (const page of pages) {
      blobs.push(await readImage(page));
    }
    return blobs;
  };
  if (Capacitor.isNativePlatform()) {
    const blobs = await readAll();
    return saveNativeFile(
      new Blob(blobs),
      name,
      {
        kind: format,
        pages: pages.map(({ page }, index) => ({
          page,
          size: blobs[index].size,
        })),
      },
      signal,
    );
  }
  if (format === "pdf") {
    const pdf = readAll().then(async (blobs) => {
      const { rasterPagesPdf } = await import("./pagePdf");
      return rasterPagesPdf(blobs, signal);
    });
    return saveBrowserFile(pdf, name, "pdf", "application/pdf");
  }
  const imageName = (page: number) =>
    `${name}_${String(page).padStart(2, "0")}`;
  const directoryPicker = (
    window as Window & {
      showDirectoryPicker?: (options: {
        mode: "readwrite";
        id: string;
      }) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;
  if (directoryPicker && pages.length > 1) {
    let directory: FileSystemDirectoryHandle;
    try {
      directory = await directoryPicker.call(window, {
        mode: "readwrite",
        id: "fcboard-pages",
      });
    } catch (error) {
      if (isAbort(error)) {
        return false;
      }
      throw error;
    }
    const blobs = await readAll();
    const written: string[] = [];
    try {
      for (const [index, { page }] of pages.entries()) {
        signal?.throwIfAborted();
        const basename = imageName(page);
        let filename = `${basename}.jpg`;
        for (let suffix = 1; ; suffix++) {
          try {
            await directory.getFileHandle(filename);
            filename = `${basename}_${suffix}.jpg`;
          } catch (error) {
            if (
              error instanceof DOMException &&
              error.name === "NotFoundError"
            ) {
              break;
            }
            if (
              error instanceof DOMException &&
              error.name === "TypeMismatchError"
            ) {
              filename = `${basename}_${suffix}.jpg`;
              continue;
            }
            throw error;
          }
        }
        const handle = await directory.getFileHandle(filename, {
          create: true,
        });
        written.push(filename);
        const output = await handle.createWritable();
        try {
          await output.write(blobs[index]);
          signal?.throwIfAborted();
          await output.close();
        } catch (error) {
          await output.abort().catch(() => {});
          throw error;
        }
      }
      return true;
    } catch (error) {
      await Promise.allSettled(
        written.map((filename) => directory.removeEntry(filename)),
      );
      throw error;
    }
  }
  for (const image of pages) {
    const content = readImage(image);
    if (
      !(await saveBrowserFile(
        typeof image.blob === "function" ? content : await content,
        imageName(image.page),
        "jpg",
        "image/jpeg",
      ))
    ) {
      return false;
    }
  }
  return true;
};
