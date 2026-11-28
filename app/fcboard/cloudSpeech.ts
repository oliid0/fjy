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
    separateSpeakers?: boolean;
  }): Promise<{ session: string }>;
  push: PCMSpeechTransport["push"];
  stop(options: {
    session: string;
    discard?: boolean;
  }): Promise<{ lines?: TranscriptLine[] } | undefined>;
}>("FcboardCloudSpeech");

export const startCloudSpeech = (
  onLine: (line: TranscriptLine) => void,
  onError: (message: string) => void,
  stream?: MediaStream,
  onActivity?: () => void,
  onInterim?: (line: TranscriptLine | null) => void,
  separateSpeakers = false,
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
  let session = "";
  return startPCMSpeech(
    {
      start: async () => {
        const result = await engine.start({
          key: settings.speechKey.trim(),
          resource: settings.speechResource,
          ...(separateSpeakers ? { separateSpeakers } : {}),
        });
        session = result.session;
        return result;
      },
      push: (options) => engine.push(options),
      stop: async (options) => ({
        lines: (await engine.stop(options))?.lines || [],
      }),
    },
    (line) =>
      onLine(
        line.speaker
          ? { ...line, speaker: `${session}:${line.speaker}` }
          : line,
      ),
    onError,
    stream,
    true,
    onActivity,
    onInterim,
  );
};
