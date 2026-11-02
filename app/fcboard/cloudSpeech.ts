import { Capacitor, registerPlugin } from "@capacitor/core";
import { t } from "@fcboard/fcboard/i18n";

import { startPCMSpeech } from "./localSpeech";
import { currentSettings } from "./settings";

import type { PCMSpeechTransport } from "./localSpeech";
import type { TranscriptLine } from "./speech";
import type { PluginListenerHandle } from "@capacitor/core";

const engine = registerPlugin<{
  start(options: {
    key: string;
    resource: string;
    capture?: boolean;
  }): Promise<{ session: string }>;
  push: PCMSpeechTransport["push"];
  stop(options: {
    session: string;
    discard?: boolean;
  }): Promise<{ lines?: TranscriptLine[] }>;
  addListener(
    event: "transcript",
    callback: (event: {
      session: string;
      lines?: TranscriptLine[];
      interim?: TranscriptLine | null;
      activity?: boolean;
      error?: string;
    }) => void,
  ): Promise<PluginListenerHandle>;
}>("FcboardCloudSpeech");

const startNativeCloudSpeech = async (
  onLine: (line: TranscriptLine) => void,
  onError: (message: string) => void,
  onActivity?: () => void,
  onInterim?: (line: TranscriptLine | null) => void,
) => {
  const settings = currentSettings();
  let session: string | undefined;
  let finished = false;
  let ending: Promise<void> | undefined;
  const early: Parameters<Parameters<typeof engine.addListener>[1]>[0][] = [];
  const receive: Parameters<typeof engine.addListener>[1] = (event) => {
    if (!session && !finished) {
      if (early.length < 20) {
        early.push(event);
      }
      return;
    }
    if (finished || event.session !== session) {
      return;
    }
    if (event.error) {
      onError(event.error);
      return;
    }
    event.lines?.forEach(onLine);
    onInterim?.(event.interim || null);
    if (event.activity) {
      onActivity?.();
    }
  };
  const listener = await engine.addListener("transcript", receive);
  try {
    session = (
      await engine.start({
        key: settings.speechKey.trim(),
        resource: settings.speechResource,
        capture: true,
      })
    ).session;
    early.splice(0).forEach(receive);
  } catch (failure) {
    await listener.remove();
    throw failure;
  }
  const finish = (discard: boolean) =>
    (ending ||= (async () => {
      if (discard) {
        finished = true;
      }
      try {
        const result = await engine.stop({ session: session!, discard });
        if (!discard) {
          result.lines?.forEach(onLine);
        }
      } finally {
        finished = true;
        onInterim?.(null);
        await listener.remove();
      }
    })());
  return { stop: () => finish(false), cancel: () => finish(true) };
};

export const startCloudSpeech = (
  onLine: (line: TranscriptLine) => void,
  onError: (message: string) => void,
  stream?: MediaStream,
  onActivity?: () => void,
  onInterim?: (line: TranscriptLine | null) => void,
) => {
  if (!Capacitor.isNativePlatform()) {
    throw new Error(
      t("fcboard.use_the_android_app_for_direct_doubao_cloud_speech"),
    );
  }
  const settings = currentSettings();
  if (!settings.speechKey.trim()) {
    throw new Error(
      t("fcboard.enter_your_doubao_speech_api_key_in_voice_settings"),
    );
  }
  if (!stream) {
    return startNativeCloudSpeech(onLine, onError, onActivity, onInterim);
  }
  return startPCMSpeech(
    {
      start: () =>
        engine.start({
          key: settings.speechKey.trim(),
          resource: settings.speechResource,
        }),
      push: (options) => engine.push(options),
      stop: async (options) => ({
        lines: (await engine.stop(options)).lines || [],
      }),
    },
    onLine,
    onError,
    stream,
    true,
    onActivity,
    onInterim,
  );
};
