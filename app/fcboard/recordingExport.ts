import { registerPlugin } from "@capacitor/core";
import { getDataURL } from "@excalidraw/excalidraw/data/blob";

import { timestamp } from "./recording";

import type { Recording } from "./recording";

const engine = registerPlugin<{
  begin(options: {
    size: number;
    mime: string;
    transcript: string;
    summary: string;
  }): Promise<{ id: string }>;
  append(options: { id: string; offset: number; data: string }): Promise<void>;
  complete(options: { id: string }): Promise<void>;
  save(options: { id: string }): Promise<{ saved: boolean }>;
  share(options: { id: string }): Promise<{ urls: string[] }>;
  close(options: { id: string }): Promise<void>;
}>("FcboardRecordingExport");

export const recordingFiles = (recording: Recording) => {
  const name = `Fcboard-${recording.id}`;
  const transcript = recording.transcript
    .map((line) => `[${timestamp(line.time)}] ${line.text}`)
    .join("\n");
  return [
    new File(
      [recording.blob],
      `${name}.${recording.blob.type.includes("mp4") ? "mp4" : "webm"}`,
      { type: recording.blob.type },
    ),
    new File([transcript], `${name}-transcript.txt`, {
      type: "text/plain;charset=utf-8",
    }),
    new File([recording.summary], `${name}-summary.md`, {
      type: "text/markdown;charset=utf-8",
    }),
  ];
};

export const prepareRecordingPackage = async (
  recording: Recording,
  signal: AbortSignal,
) => {
  signal.throwIfAborted();
  const { id } = await engine.begin({
    size: recording.blob.size,
    mime: recording.blob.type,
    transcript: recording.transcript
      .map((line) => `[${timestamp(line.time)}] ${line.text}`)
      .join("\n"),
    summary: recording.summary,
  });
  try {
    for (let offset = 0; offset < recording.blob.size; offset += 262144) {
      signal.throwIfAborted();
      const data = await getDataURL(
        recording.blob.slice(offset, offset + 262144),
      );
      signal.throwIfAborted();
      await engine.append({
        id,
        offset,
        data: data.slice(data.indexOf(",") + 1),
      });
    }
    signal.throwIfAborted();
    await engine.complete({ id });
    signal.throwIfAborted();
    return {
      save: () => engine.save({ id }),
      share: () => engine.share({ id }),
      close: () => engine.close({ id }),
    };
  } catch (error) {
    await engine.close({ id }).catch(() => {});
    throw error;
  }
};

/** A single directory choice writes all three files; other browsers retain real download links. */
export const saveRecordingFiles = async (recording: Recording) => {
  const picker = (
    window as Window & {
      showDirectoryPicker?: (options: {
        mode: "readwrite";
        id: string;
      }) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;
  const files = recordingFiles(recording);
  if (picker) {
    const directory = await picker.call(window, {
      mode: "readwrite",
      id: "fcboard-recordings",
    });
    for (const file of files) {
      const handle = await directory.getFileHandle(file.name, { create: true });
      const output = await handle.createWritable();
      try {
        await output.write(file);
        await output.close();
      } catch (error) {
        await output.abort().catch(() => {});
        throw error;
      }
    }
  } else {
    for (const file of files) {
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
};
