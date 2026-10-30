import { t } from "@fcboard/fcboard/i18n";
import { createStore, get, set } from "idb-keyval";
import { blobToArrayBuffer } from "@fcboard/fcboard/data/blob";
import { Capacitor } from "@capacitor/core";

import { Classroom as NativeClassroom } from "./native";

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
const store = createStore("fcboard-recordings", "sessions");
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
  private pausedAt?: number;
  private pausedMs = 0;
  private chunks: Blob[] = [];
  private stopPromise?: Promise<Blob>;
  private captureGeneration = 0;

  get audioStream() {
    return this.streams[0];
  }

  async start(mode: RecordingMode, onStopped: () => void) {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      throw new Error(
        t(
          "fcboard.recording_is_unavailable_update_system_webview_and_allow_microphone_camera_access",
        ),
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
        const viewport = document
          .querySelector(".fcboard")
          ?.getBoundingClientRect();
        const viewportWidth = Math.max(
          1,
          viewport?.width || innerWidth || 1280,
        );
        const viewportHeight = Math.max(
          1,
          viewport?.height || innerHeight || 720,
        );
        const captureScale = Math.min(
          1,
          1280 / Math.max(viewportWidth, viewportHeight),
        );
        canvas.width = Math.max(1, Math.round(viewportWidth * captureScale));
        canvas.height = Math.max(1, Math.round(viewportHeight * captureScale));
        const context = canvas.getContext("2d");
        if (!context || !canvas.captureStream) {
          throw new Error(
            t("fcboard.board_screen_recording_is_unavailable_on_this_device"),
          );
        }
        let camera: HTMLVideoElement | undefined;
        let screen: HTMLVideoElement | undefined;
        if (
          !Capacitor.isNativePlatform() &&
          navigator.mediaDevices.getDisplayMedia
        ) {
          const display = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false,
          });
          this.streams.push(display);
          screen = document.createElement("video");
          screen.muted = true;
          screen.playsInline = true;
          screen.srcObject = display;
          this.videos.push(screen);
          await screen.play();
          display.getVideoTracks()[0].onended = () => {
            if (this.recorder && this.recorder.state !== "inactive") {
              this.recorder.stop();
            }
          };
        }
        let appFrame: HTMLImageElement | undefined;
        let capturing = false;
        let capturedAt = 0;
        const generation = ++this.captureGeneration;
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
          if (this.recorder?.state === "paused") {
            return;
          }
          context.fillStyle = "#fff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          const canvases = document.querySelectorAll<HTMLCanvasElement>(
            ".fcboard .fcboard__canvas",
          );
          const documentOpen = !!document.querySelector(".fc-presentation");
          const needsFrame =
            documentOpen || !!document.querySelector(".fcboard iframe");
          if (
            Capacitor.isNativePlatform() &&
            needsFrame &&
            !capturing &&
            Date.now() - capturedAt > 150
          ) {
            capturing = true;
            capturedAt = Date.now();
            void NativeClassroom.captureFrame()
              .then(async ({ image }) => {
                const next = new Image();
                next.src = image;
                await next.decode();
                if (generation === this.captureGeneration) {
                  appFrame = next;
                }
              })
              .catch(() => {})
              .finally(() => {
                capturing = false;
              });
          }
          const sources =
            screen && screen.readyState >= 2
              ? [screen]
              : needsFrame && appFrame
              ? [appFrame]
              : Array.from(canvases);
          sources.forEach((source) => {
            const sourceWidth =
              source instanceof HTMLVideoElement
                ? source.videoWidth
                : source.width;
            const sourceHeight =
              source instanceof HTMLVideoElement
                ? source.videoHeight
                : source.height;
            if (sourceWidth && sourceHeight) {
              const ratio = Math.min(
                canvas.width / sourceWidth,
                canvas.height / sourceHeight,
              );
              const width = sourceWidth * ratio;
              const height = sourceHeight * ratio;
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
              canvas.width - Math.min(320, canvas.width * 0.35) - 16,
              canvas.height -
                (Math.min(320, canvas.width * 0.35) * 9) / 16 -
                16,
              Math.min(320, canvas.width * 0.35),
              (Math.min(320, canvas.width * 0.35) * 9) / 16,
            );
          }
        };
        paint();
        this.timer = setInterval(paint, 66);
        output = canvas.captureStream(15);
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
          blob.size
            ? resolve(blob)
            : reject(
                new Error(t("fcboard.the_recording_is_empty_please_try_again")),
              );
        };
        this.recorder!.onerror = () => {
          this.release();
          onStopped();
          reject(
            new Error(
              t("fcboard.recording_failed_check_storage_and_permissions"),
            ),
          );
        };
      });
      // Keep a handler attached while the user is still recording.
      void this.stopPromise.catch(() => {});
      this.started = Date.now();
      this.pausedAt = undefined;
      this.pausedMs = 0;
      this.recorder.start(1000);
    } catch (error) {
      this.release();
      throw error;
    }
  }

  async stop() {
    if (!this.recorder || !this.stopPromise) {
      throw new Error(t("fcboard.no_active_recording"));
    }
    const duration =
      ((this.pausedAt ?? Date.now()) - this.started - this.pausedMs) / 1000;
    if (this.recorder.state !== "inactive") {
      this.recorder.stop();
    }
    return { blob: await this.stopPromise, duration };
  }

  dispose() {
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.stop();
    }
    this.release();
  }
  pause() {
    if (!this.recorder || this.recorder.state !== "recording") {
      throw new Error(t("fcboard.no_active_recording"));
    }
    this.recorder.pause();
    this.pausedAt = Date.now();
  }
  resume() {
    if (!this.recorder || this.recorder.state !== "paused") {
      throw new Error(t("fcboard.no_active_recording"));
    }
    this.recorder.resume();
    this.pausedMs += Date.now() - this.pausedAt!;
    this.pausedAt = undefined;
  }
  private release() {
    this.captureGeneration++;
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
