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
  stop(options: { session: string }): Promise<{ lines: TranscriptLine[] }>;
}>("FcboardLocalSpeech");

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

/** A caller may pass its recording stream, so Android never opens two microphones. */
export const startLocalSpeech = async (
  onLine: (line: TranscriptLine) => void,
  onError: (message: string) => void,
  stream?: MediaStream,
): Promise<LocalSpeechHandle> => {
  if (!Capacitor.isNativePlatform()) {
    throw new Error(
      "内置离线中文识别请使用安卓版；浏览器可在设置选择系统或自定义语音",
    );
  }
  if (!window.AudioContext || !window.AudioWorkletNode) {
    throw new Error("当前 WebView 不支持离线语音采集，请更新安卓系统 WebView");
  }
  await engine.prepare();
  const { session } = await engine.start();
  let media = stream;
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let node: AudioWorkletNode | undefined;
  let cancelled = false;
  let ended = false;
  let queued = 0;
  let pending = Promise.resolve();
  let flushDone: (() => void) | undefined;
  let finishPromise: Promise<void> | undefined;
  const deliver = (lines: TranscriptLine[]) => {
    if (!cancelled) {
      lines.forEach(onLine);
    }
  };
  const cleanup = async () => {
    source?.disconnect();
    node?.disconnect();
    if (node) {
      node.port.onmessage = null;
    }
    if (!stream) {
      media?.getTracks().forEach((track) => track.stop());
    }
    await context?.close().catch(() => {});
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
        deliver((await engine.stop({ session })).lines);
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
    context = new AudioContext();
    await context.audioWorklet.addModule(
      `${import.meta.env.BASE_URL}fc-pcm-worklet.js`,
    );
    node = new AudioWorkletNode(context, "fcboard-pcm");
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
      if (++queued > 20) {
        onError("设备语音处理速度不足，已停止识别；录制不受影响");
        void finish(true).catch(() => {});
        return;
      }
      const pcm = encodePCM(data.pcm);
      pending = pending
        .then(async () => {
          if (!cancelled) {
            deliver(
              (await engine.push({ session, pcm, sampleRate: data.sampleRate }))
                .lines,
            );
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
    await context.resume();
    return { stop: () => finish(false), cancel: () => finish(true) };
  } catch (error) {
    await engine.stop({ session }).catch(() => {});
    await cleanup();
    throw error;
  }
};

export const transcribeLocalRecording = async (
  blob: Blob,
): Promise<TranscriptLine[]> => {
  if (!Capacitor.isNativePlatform()) {
    throw new Error("内置离线转写请使用安卓版");
  }
  const audio = new AudioContext();
  let session: string | undefined;
  try {
    const buffer = await audio.decodeAudioData(await blobToArrayBuffer(blob));
    if (buffer.duration > 1800) {
      throw new Error(
        "超过 30 分钟的资料请使用录制时的实时文稿或自定义转写接口",
      );
    }
    await engine.prepare();
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
        "此设备无法解析该录制的音轨，请使用实时文稿或自定义转写接口",
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
