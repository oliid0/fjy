import { Capacitor, registerPlugin } from "@capacitor/core";
import { t } from "@fcboard/fcboard/i18n";

import { startPCMSpeech } from "./localSpeech";
import { currentSettings } from "./settings";

import type { PCMSpeechTransport } from "./localSpeech";
import type { TranscriptLine } from "./speech";

const engine = registerPlugin<{
  start(options: {
    key: string;
    resource: string;
  }): Promise<{ session: string }>;
  push: PCMSpeechTransport["push"];
  stop(options: {
    session: string;
    discard?: boolean;
  }): Promise<{ lines?: TranscriptLine[] }>;
}>("FcboardCloudSpeech");

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
