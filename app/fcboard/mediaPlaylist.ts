import { createStore, get, set } from "idb-keyval";
import { Capacitor } from "@capacitor/core";
import { getDataURL } from "@fcboard/fcboard/data/blob";

import { Media } from "./builtinNative";
import { mediaFileType } from "./fileTypes";

const playlists = createStore("fcboard-media", "playlists");
export const saveMediaFiles = (key: string, files: File[]) =>
  set(key, files, playlists);
export const readMediaFiles = (key: string) => get<File[]>(key, playlists);

export type PortableMedia = Record<
  string,
  { name: string; type: string; dataURL: string }[]
>;
const limit = 64 * 1024 * 1024;
/** Include actual media bytes, rather than exporting device-local playlist keys. */
export const exportMediaFiles = async (
  keys: Iterable<string>,
  signal?: AbortSignal,
): Promise<PortableMedia> => {
  const result: PortableMedia = {};
  let size = 0;
  for (const key of new Set(keys)) {
    signal?.throwIfAborted();
    let files = await readMediaFiles(key);
    if (!files?.length && Capacitor.isNativePlatform()) {
      const entries = await Media.files({ key });
      files = [];
      for (const entry of entries.files) {
        const response = await fetch(Capacitor.convertFileSrc(entry.uri), {
          signal,
        });
        if (!response.ok) {
          throw new Error(`Media unavailable: ${entry.name}`);
        }
        const blob = await response.blob();
        files.push(new File([blob], entry.name, { type: entry.mime }));
      }
    }
    if (!files?.length) {
      throw new Error("Media content is missing; the board was not saved");
    }
    result[key] = [];
    for (const file of files) {
      signal?.throwIfAborted();
      size += file.size;
      if (size > limit) {
        throw new Error("Board media exceeds 64 MB");
      }
      const type = mediaFileType(file);
      if (!type) {
        throw new Error(`Unsupported media: ${file.name}`);
      }
      result[key].push({
        name: file.name,
        type,
        dataURL: await getDataURL(new File([file], file.name, { type })),
      });
    }
  }
  return result;
};
/** Imported playlists get new keys so opening a file cannot replace another board's media. */
export const importMediaFiles = async (
  media: PortableMedia,
  remap: Map<string, string>,
) => {
  let size = 0;
  for (const [key, entries] of Object.entries(media)) {
    if (remap.has(key)) {
      continue;
    }
    if (!Array.isArray(entries) || !entries.length || entries.length > 50) {
      throw new Error("Invalid BZD media playlist");
    }
    const files: File[] = [];
    for (const entry of entries) {
      if (
        typeof entry.name !== "string" ||
        typeof entry.type !== "string" ||
        !/^(audio|video)\//.test(entry.type) ||
        typeof entry.dataURL !== "string" ||
        !/^data:(audio|video)\/[^;,]+;base64,/.test(entry.dataURL)
      ) {
        throw new Error("Invalid BZD media content");
      }
      const data = entry.dataURL.slice(entry.dataURL.indexOf(",") + 1);
      size += Math.ceil((data.length * 3) / 4);
      if (size > limit) {
        throw new Error("BZD media exceeds 64 MB");
      }
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      files.push(new File([bytes], entry.name, { type: entry.type }));
    }
    const next = crypto.randomUUID();
    await saveMediaFiles(next, files);
    if (Capacitor.isNativePlatform()) {
      await ensureNativeMedia(next);
    }
    remap.set(key, next);
  }
};
const installed = new Map<string, Promise<void>>();
export const ensureNativeMedia = async (key: string) => {
  let task = installed.get(key);
  if (!task) {
    task = (async () => {
      const files = await readMediaFiles(key);
      if (!files?.length) {
        return;
      }
      const { id } = await Media.storeBegin({
        key,
        files: files.map((file) => ({
          name: file.name,
          mime: file.type,
          size: file.size,
        })),
      });
      try {
        for (const [index, file] of files.entries()) {
          for (let offset = 0; offset < file.size; offset += 262144) {
            const data = await getDataURL(file.slice(offset, offset + 262144));
            await Media.storeAppend({
              id,
              index,
              offset,
              data: data.slice(data.indexOf(",") + 1),
            });
          }
        }
        await Media.storeFinish({ id });
      } finally {
        await Media.storeClose({ id });
      }
    })();
    installed.set(key, task);
    task.catch(() => installed.delete(key));
  }
  return task;
};

// Only the newly inserted object starts playback. Copies and restored pages open paused.
export const pendingMediaPlayback = new Set<string>();
