import { t } from "@fcboard/fcboard/i18n";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { blobToArrayBuffer } from "@fcboard/fcboard/data/blob";

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
  readonly ready?: Promise<void>;
  readonly stream?: MediaStream;
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
  push(options: { session: string; pcm: string; sampleRate: number }): Promise<{
    lines: TranscriptLine[];
    activity?: boolean;
    interim?: TranscriptLine | null;
  }>;
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
  onInterim?: (line: TranscriptLine | null) => void,
  capture?: { blockDuration: 0.02 | 0.1 | 0.5 },
): Promise<LocalSpeechHandle> => {
  if (!Capacitor.isNativePlatform()) {
    throw new Error(
      t(
        "fcboard.offline_chinese_recognition_requires_android_in_a_browser_choose_system_or_custom_speech_in",
      ),
    );
  }
  if (!window.AudioContext) {
    throw new Error(
      t(
        "fcboard.this_webview_cannot_capture_offline_speech_update_android_system_webview",
      ),
    );
  }
  // Resume in the initiating click, before model loading can consume activation.
  // Capture at the device's working rate; both capture backends resample cloud
  // frames to 16 kHz, as in the official duplex demo.
  const context = new AudioContext();
  const resumed = context.resume();
  void resumed.catch(() => {});
  let session: string;
  let media = stream;
  try {
    media ||= await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    if (!cloud) {
      await prepareLocalSpeech();
    }
    session = (await transport.start()).session;
  } catch (error) {
    if (!stream) {
      media?.getTracks().forEach((track) => track.stop());
    }
    await context.close().catch(() => {});
    throw error;
  }
  let source: MediaStreamAudioSourceNode | undefined;
  let node: AudioWorkletNode | ScriptProcessorNode | undefined;
  let flushCapture: (() => void) | undefined;
  let fallbackTimeout: ReturnType<typeof setTimeout> | undefined;
  let receivedAudio = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => {});
  let cancelled = false;
  let ended = false;
  let queued = 0;
  let pending = Promise.resolve();
  let flushDone: (() => void) | undefined;
  let finishPromise: Promise<void> | undefined;
  let cleanupPromise: Promise<void> | undefined;
  let captureTimeout: ReturnType<typeof setTimeout> | undefined;
  const deliver = (lines: TranscriptLine[]) => {
    if (!cancelled) {
      lines.forEach(onLine);
    }
  };
  const cleanup = () =>
    (cleanupPromise ||= (async () => {
      clearTimeout(captureTimeout);
      clearTimeout(fallbackTimeout);
      source?.disconnect();
      node?.disconnect();
      if (node && "port" in node) {
        node.port.onmessage = null;
        node.onprocessorerror = null;
      } else if (node) {
        node.onaudioprocess = null;
      }
      if (!stream) {
        media?.getTracks().forEach((track) => track.stop());
      }
      await context.close().catch(() => {});
    })());
  const finish = (discard: boolean): Promise<void> => {
    cancelled ||= discard;
    clearTimeout(captureTimeout);
    if (cancelled) {
      rejectReady(new DOMException("Audio capture cancelled", "AbortError"));
      ended = true;
      flushDone?.();
      // Native inference may still be pending; release microphone capture now.
      void cleanup().catch(() => {});
    }
    if (finishPromise) {
      return finishPromise;
    }
    finishPromise = (async () => {
      source?.disconnect();
      if (node && !cancelled) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 1000);
          flushDone = () => {
            clearTimeout(timeout);
            resolve();
          };
          flushCapture?.();
        });
      }
      ended = true;
      await pending;
      try {
        deliver(
          (
            await transport.stop({
              session,
              ...(cloud ? { discard: cancelled } : {}),
            })
          ).lines,
        );
      } finally {
        await cleanup();
      }
    })();
    return finishPromise;
  };
  const watchCapture = () => {
    clearTimeout(captureTimeout);
    captureTimeout = setTimeout(() => {
      const message = t(
        "fcboard.the_microphone_did_not_provide_audio_check_permissions_and_the_input_device_then_start_again",
      );
      rejectReady(new Error(message));
      onError(message);
      void finish(true).catch(() => {});
    }, 12000);
  };
  try {
    source = context.createMediaStreamSource(media);
    const receive = (data: {
      pcm?: Float32Array;
      sampleRate: number;
      flushed?: boolean;
    }) => {
      if (data.flushed) {
        flushDone?.();
        return;
      }
      if (ended || cancelled || !data.pcm?.length) {
        return;
      }
      receivedAudio = true;
      clearTimeout(fallbackTimeout);
      resolveReady();
      watchCapture();
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
            if (!cancelled && response.interim !== undefined) {
              onInterim?.(response.interim);
            }
            if (!cancelled && response.activity) {
              onActivity?.();
            }
          }
        })
        .catch((error) => {
          if (!cancelled) {
            onError(error instanceof Error ? error.message : String(error));
            void finish(true).catch(() => {});
          }
        })
        .finally(() => {
          queued--;
        });
    };
    const fallback = () => {
      if (ended || cancelled || (node && "onaudioprocess" in node)) {
        return;
      }
      source!.disconnect();
      node?.disconnect();
      if (node && "port" in node) {
        node.port.onmessage = null;
        node.onprocessorerror = null;
      }
      // The supplied official duplex demo uses ScriptProcessor capture. Keep it
      // as a working fallback when this WebView cannot run its AudioWorklet.
      const processor = context.createScriptProcessor(4096, 1, 1);
      node = processor;
      const rate = cloud ? 16000 : context.sampleRate;
      const size = Math.round(
        rate * (capture?.blockDuration ?? (cloud ? 0.1 : 0.5)),
      );
      let samples = new Float32Array(size);
      let offset = 0;
      let phase = 0;
      let sum = 0;
      let count = 0;
      const flush = () => {
        if (offset) {
          receive({ pcm: samples.slice(0, offset), sampleRate: rate });
        }
        offset = 0;
      };
      processor.onaudioprocess = ({ inputBuffer }) => {
        const input = inputBuffer.getChannelData(0);
        for (const value of input) {
          sum += value;
          count++;
          phase += rate;
          if (phase >= context.sampleRate) {
            const value = sum / count;
            while (phase >= context.sampleRate) {
              samples[offset++] = value;
              phase -= context.sampleRate;
              if (offset === size) {
                flush();
                samples = new Float32Array(size);
              }
            }
            sum = 0;
            count = 0;
          }
        }
      };
      flushCapture = () => {
        flush();
        flushDone?.();
      };
      source!.connect(processor);
      processor.connect(context.destination);
    };
    const useFallback = () => {
      try {
        fallback();
      } catch (error) {
        rejectReady(error instanceof Error ? error : new Error(String(error)));
        onError(error instanceof Error ? error.message : String(error));
        void finish(true).catch(() => {});
      }
    };
    try {
      if (!context.audioWorklet || !window.AudioWorkletNode) {
        throw new Error("AudioWorklet unavailable");
      }
      await context.audioWorklet.addModule(
        `${import.meta.env.BASE_URL}fc-pcm-worklet.js`,
      );
      const worklet = new AudioWorkletNode(context, "fcboard-pcm", {
        processorOptions: {
          blockDuration: capture?.blockDuration ?? (cloud ? 0.1 : 0.5),
          ...(cloud ? { targetSampleRate: 16000 } : {}),
        },
      });
      node = worklet;
      worklet.port.onmessage = ({ data }) => receive(data);
      worklet.onprocessorerror = useFallback;
      flushCapture = () => worklet.port.postMessage("flush");
      source.connect(worklet);
      worklet.connect(context.destination);
      fallbackTimeout = setTimeout(() => {
        if (!receivedAudio) {
          useFallback();
        }
      }, 1500);
    } catch {
      fallback();
    }
    watchCapture();
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
    return {
      ready,
      stop: () => finish(false),
      cancel: () => finish(true),
      get stream() {
        return media;
      },
    };
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
  onInterim?: (line: TranscriptLine | null) => void,
) =>
  startPCMSpeech(engine, onLine, onError, stream, false, onActivity, onInterim);

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
