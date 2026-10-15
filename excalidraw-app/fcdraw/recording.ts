import { createStore, get, set } from "idb-keyval";
import { blobToArrayBuffer } from "@excalidraw/excalidraw/data/blob";

import type { TranscriptLine } from "./speech";

export type RecordingMode = "audio" | "camera" | "screen" | "combined";
export type Recording = {
  id: string;
  created: number;
  duration: number;
  mode: RecordingMode;
  blob: Blob;
  transcript: TranscriptLine[];
  summary: string;
};
const store = createStore("fcdraw-recordings", "sessions");
type BinaryRecording = Omit<Recording, "blob"> & {
  data: ArrayBuffer;
  mime: string;
};
export const loadRecordings = async (): Promise<Recording[]> => {
  const items =
    (await get<(Recording | BinaryRecording)[]>("recordings", store)) || [];
  return items.map((item) => {
    if ("blob" in item) {
      return item;
    }
    const { data, mime, ...metadata } = item;
    return { ...metadata, blob: new Blob([data], { type: mime }) };
  });
};
export const saveRecordings = async (items: Recording[]) => {
  try {
    await set("recordings", items, store);
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "DataCloneError") {
      throw error;
    }
    // Some older WebViews cannot clone Blob values into IndexedDB. Keep a binary fallback.
    const binary = await Promise.all(
      items.map(async ({ blob, ...metadata }) => ({
        ...metadata,
        data: await blobToArrayBuffer(blob),
        mime: blob.type,
      })),
    );
    await set("recordings", binary, store);
  }
};

export class BoardRecorder {
  private streams: MediaStream[] = [];
  private videos: HTMLVideoElement[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private recorder?: MediaRecorder;
  private started = 0;
  private chunks: Blob[] = [];
  private stopPromise?: Promise<Blob>;

  async start(mode: RecordingMode, onStopped: () => void) {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      throw new Error(
        "当前设备不支持录制，请升级系统 WebView 并允许麦克风/摄像头权限",
      );
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video:
          mode === "camera" || mode === "combined"
            ? {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: "user",
              }
            : false,
      });
      this.streams.push(media);
      let output = media;
      if (mode === "screen" || mode === "combined") {
        const canvas = document.createElement("canvas");
        canvas.width = 1920;
        canvas.height = 1080;
        const context = canvas.getContext("2d");
        if (!context || !canvas.captureStream) {
          throw new Error("当前设备不支持白板画面录制");
        }
        let camera: HTMLVideoElement | undefined;
        if (mode === "combined") {
          camera = document.createElement("video");
          camera.muted = true;
          camera.playsInline = true;
          camera.srcObject = media;
          this.videos.push(camera);
          await camera.play();
        }
        // Capture the live whiteboard canvas on Android too (getDisplayMedia is not exposed by Android WebView).
        const paint = () => {
          context.fillStyle = "#fff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          const canvases = document.querySelectorAll<HTMLCanvasElement>(
            ".excalidraw .excalidraw__canvas",
          );
          canvases.forEach((source) => {
            if (source.width && source.height) {
              const ratio = Math.min(
                canvas.width / source.width,
                canvas.height / source.height,
              );
              const width = source.width * ratio;
              const height = source.height * ratio;
              context.drawImage(
                source,
                (canvas.width - width) / 2,
                (canvas.height - height) / 2,
                width,
                height,
              );
            }
          });
          if (camera && camera.readyState >= 2) {
            context.drawImage(
              camera,
              canvas.width - 350,
              canvas.height - 210,
              320,
              180,
            );
          }
        };
        paint();
        this.timer = setInterval(paint, 40);
        output = canvas.captureStream(25);
        media.getAudioTracks().forEach((track) => output.addTrack(track));
        this.streams.push(output);
      }
      const supported = (
        mode === "audio"
          ? ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"]
          : ["video/webm;codecs=vp8,opus", "video/mp4", "video/webm"]
      ).find((mime) => MediaRecorder.isTypeSupported(mime));
      this.recorder = new MediaRecorder(
        output,
        supported ? { mimeType: supported } : undefined,
      );
      this.chunks = [];
      this.recorder.ondataavailable = ({ data }) => {
        if (data.size) {
          this.chunks.push(data);
        }
      };
      this.stopPromise = new Promise<Blob>((resolve, reject) => {
        this.recorder!.onstop = () => {
          const blob = new Blob(this.chunks, { type: this.recorder!.mimeType });
          this.release();
          onStopped();
          blob.size ? resolve(blob) : reject(new Error("录制内容为空，请重试"));
        };
        this.recorder!.onerror = () => {
          this.release();
          onStopped();
          reject(new Error("设备录制失败，请检查存储与权限"));
        };
      });
      // Keep a handler attached while the user is still recording.
      void this.stopPromise.catch(() => {});
      this.started = Date.now();
      this.recorder.start(1000);
    } catch (error) {
      this.release();
      throw error;
    }
  }

  async stop() {
    if (!this.recorder || !this.stopPromise) {
      throw new Error("没有正在进行的录制");
    }
    const duration = (Date.now() - this.started) / 1000;
    if (this.recorder.state !== "inactive") {
      this.recorder.stop();
    }
    return { blob: await this.stopPromise, duration };
  }

  dispose() {
    if (this.recorder?.state === "recording") {
      this.recorder.stop();
    }
    this.release();
  }
  private release() {
    clearInterval(this.timer);
    this.streams.forEach((stream) =>
      stream.getTracks().forEach((track) => track.stop()),
    );
    this.videos.forEach((video) => {
      video.pause();
      video.srcObject = null;
    });
    this.streams = [];
    this.videos = [];
  }
}

export const timestamp = (time: number) =>
  `${String(Math.floor(time / 60)).padStart(2, "0")}:${String(
    Math.floor(time % 60),
  ).padStart(2, "0")}`;
