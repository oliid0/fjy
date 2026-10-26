import { t } from "@excalidraw/excalidraw/i18n";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { blobToArrayBuffer } from "@excalidraw/excalidraw/data/blob";

import type { TranscriptLine } from "./speech";

const engine = registerPlugin<{
  prepare(): Promise<void>;
  start(): Promise<{ session: string }>;
  push(options: {
    session: string;
    pcm: string;
    sampleRate: number;
  }): Promise<{ lines: TranscriptLine[] }>;
  stop(options: {
    session: string;
    discard?: boolean;
  }): Promise<{ lines: TranscriptLine[] }>;
}>("FcboardLocalSpeech");

let preparation: Promise<void> | undefined;
export const prepareLocalSpeech = () => {
  preparation ||= engine.prepare().catch((error) => {
    preparation = undefined;
    throw error;
  });
  return preparation;
};

export type LocalSpeechHandle = {
  stop(): Promise<void>;
  cancel(): Promise<void>;
};

export const encodePCM = (samples: Float32Array) => {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(
      i * 2,
      Math.round(sample * (sample < 0 ? 32768 : 32767)),
      true,
    );
  }
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

export type PCMSpeechTransport = {
  start(): Promise<{ session: string }>;
  push(options: {
    session: string;
    pcm: string;
    sampleRate: number;
  }): Promise<{ lines: TranscriptLine[]; activity?: boolean }>;
  stop(options: {
    session: string;
    discard?: boolean;
  }): Promise<{ lines: TranscriptLine[] }>;
};

/** Shared capture keeps streaming ASR and recording on the same microphone. */
export const startPCMSpeech = async (
  transport: PCMSpeechTransport,
  onLine: (line: TranscriptLine) => void,
  onError: (message: string) => void,
  stream?: MediaStream,
  cloud = false,
  onActivity?: () => void,
): Promise<LocalSpeechHandle> => {
  if (!Capacitor.isNativePlatform()) {
    throw new Error(
      t(
        "fcboard.offline_chinese_recognition_requires_android_in_a_browser_choose_system_or_custom_speech_in",
      ),
    );
  }
  if (!window.AudioContext || !window.AudioWorkletNode) {
    throw new Error(
      t(
        "fcboard.this_webview_cannot_capture_offline_speech_update_android_system_webview",
      ),
    );
  }
  // Resume in the initiating click, before model loading can consume activation.
  const context = new AudioContext(cloud ? { sampleRate: 16000 } : undefined);
  const resumed = context.resume();
  void resumed.catch(() => {});
  let session: string;
  try {
    if (!cloud) {
      await prepareLocalSpeech();
    }
    session = (await transport.start()).session;
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
  let media = stream;
  let source: MediaStreamAudioSourceNode | undefined;
  let node: AudioWorkletNode | undefined;
  let cancelled = false;
  let ended = false;
  let queued = 0;
  let pending = Promise.resolve();
  let flushDone: (() => void) | undefined;
  let finishPromise: Promise<void> | undefined;
  let captureTimeout: ReturnType<typeof setTimeout> | undefined;
  const deliver = (lines: TranscriptLine[]) => {
    if (!cancelled) {
      lines.forEach(onLine);
    }
  };
  const cleanup = async () => {
    clearTimeout(captureTimeout);
    source?.disconnect();
    node?.disconnect();
    if (node) {
      node.port.onmessage = null;
    }
    if (!stream) {
      media?.getTracks().forEach((track) => track.stop());
    }
    await context.close().catch(() => {});
  };
  const finish = (discard: boolean): Promise<void> => {
    cancelled ||= discard;
    if (finishPromise) {
      return finishPromise;
    }
    finishPromise = (async () => {
      source?.disconnect();
      if (node && !discard) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 1000);
          flushDone = () => {
            clearTimeout(timeout);
            resolve();
          };
          node!.port.postMessage("flush");
        });
      }
      ended = true;
      await pending;
      try {
        deliver(
          (await transport.stop({ session, ...(cloud ? { discard } : {}) }))
            .lines,
        );
      } finally {
        await cleanup();
      }
    })();
    return finishPromise;
  };
  try {
    media ||= await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    await context.audioWorklet.addModule(
      `${import.meta.env.BASE_URL}fc-pcm-worklet.js`,
    );
    node = new AudioWorkletNode(context, "fcboard-pcm", {
      processorOptions: { blockDuration: cloud ? 0.1 : 0.5 },
    });
    source = context.createMediaStreamSource(media);
    node.port.onmessage = ({
      data,
    }: MessageEvent<{
      pcm?: Float32Array;
      sampleRate: number;
      flushed?: boolean;
    }>) => {
      if (data.flushed) {
        flushDone?.();
        return;
      }
      if (ended || cancelled || !data.pcm) {
        return;
      }
      clearTimeout(captureTimeout);
      if (++queued > 20) {
        onError(
          t(
            "fcboard.speech_recognition_stopped_because_processing_could_not_keep_up_recording_continues",
          ),
        );
        void finish(true).catch(() => {});
        return;
      }
      const pcm = encodePCM(data.pcm);
      pending = pending
        .then(async () => {
          if (!cancelled) {
            const response = await transport.push({
              session,
              pcm,
              sampleRate: data.sampleRate,
            });
            deliver(response.lines);
            if (!cancelled && response.activity) {
              onActivity?.();
            }
          }
        })
        .catch((error) => {
          onError(error instanceof Error ? error.message : String(error));
          void finish(true).catch(() => {});
        })
        .finally(() => {
          queued--;
        });
    };
    source.connect(node);
    node.connect(context.destination);
    captureTimeout = setTimeout(() => {
      onError(
        t(
          "fcboard.the_microphone_did_not_provide_audio_check_permissions_and_the_input_device_then_start_again",
        ),
      );
      void finish(true).catch(() => {});
    }, 12000);
    let resumeTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        resumed,
        new Promise<never>((_, reject) => {
          resumeTimeout = setTimeout(
            () =>
              reject(
                new Error(
                  t(
                    "fcboard.audio_capture_did_not_start_click_the_voice_button_to_try_again",
                  ),
                ),
              ),
            8000,
          );
        }),
      ]);
    } finally {
      clearTimeout(resumeTimeout);
    }
    return { stop: () => finish(false), cancel: () => finish(true) };
  } catch (error) {
    await transport.stop({ session }).catch(() => {});
    await cleanup();
    throw error;
  }
};

export const startLocalSpeech = (
  onLine: (line: TranscriptLine) => void,
  onError: (message: string) => void,
  stream?: MediaStream,
  onActivity?: () => void,
) => startPCMSpeech(engine, onLine, onError, stream, false, onActivity);

export const transcribeLocalRecording = async (
  blob: Blob,
): Promise<TranscriptLine[]> => {
  if (!Capacitor.isNativePlatform()) {
    throw new Error(
      t("fcboard.offline_transcription_requires_the_android_app"),
    );
  }
  const audio = new AudioContext();
  let session: string | undefined;
  try {
    const buffer = await audio.decodeAudioData(await blobToArrayBuffer(blob));
    if (buffer.duration > 1800) {
      throw new Error(
        t(
          "fcboard.for_recordings_over_30_minutes_use_the_live_transcript_or_a_custom_transcription_service",
        ),
      );
    }
    await prepareLocalSpeech();
    session = (await engine.start()).session;
    const lines: TranscriptLine[] = [];
    const channels = Array.from(
      { length: buffer.numberOfChannels },
      (_, index) => buffer.getChannelData(index),
    );
    const block = Math.round(buffer.sampleRate / 2);
    for (let offset = 0; offset < buffer.length; offset += block) {
      const samples = new Float32Array(Math.min(block, buffer.length - offset));
      for (let i = 0; i < samples.length; i++) {
        samples[i] =
          channels.reduce((total, channel) => total + channel[offset + i], 0) /
          channels.length;
      }
      lines.push(
        ...(
          await engine.push({
            session,
            pcm: encodePCM(samples),
            sampleRate: buffer.sampleRate,
          })
        ).lines,
      );
    }
    lines.push(...(await engine.stop({ session })).lines);
    session = undefined;
    return lines;
  } catch (error) {
    if (error instanceof DOMException) {
      throw new Error(
        t(
          "fcboard.this_device_cannot_decode_the_recording_s_audio_use_the_live_transcript_or_a_custom",
        ),
      );
    }
    throw error;
  } finally {
    if (session) {
      await engine.stop({ session }).catch(() => {});
    }
    await audio.close().catch(() => {});
  }
};
