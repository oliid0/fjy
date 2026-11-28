import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { t } from "@fcboard/fcboard/i18n";

import { ownedRequest } from "./ownedRequest";
import { currentSettings, SETTINGS_CHANGED } from "./settings";

export const AUDIO_GENERATION_ENDPOINT =
  "https://openspeech.bytedance.com/api/v3/tts/create";
export const isAudioGenerationEndpoint = (endpoint: string) => {
  try {
    return new URL(endpoint).pathname.endsWith("/api/v3/tts/create");
  } catch {
    return false;
  }
};
const maxAudioBytes = 8 * 1024 * 1024;
const supportedLanguages = new Set([
  "zh",
  "en",
  "ja",
  "ko",
  "es",
  "de",
  "fr",
  "pt",
  "th",
  "vi",
  "ms",
  "fil",
  "it",
  "ru",
  "nl",
  "pl",
  "tr",
]);

/** The PDF audio-generation protocol has its own Speech key and JSON/Base64
 * result. This is independent of the conversational voice/recognition queue. */
export const createStudyAudio = () => {
  const cache = new Map<string, Blob>();
  const pending = new Set<AbortController>();
  let credentials = "";
  let bytes = 0;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    pending.forEach((request) => request.abort());
    cache.clear();
    bytes = 0;
    credentials = "";
    clearTimeout(idle);
  };
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(clear, 60000);
  };
  return {
    clear,
    async generate(text: string, language: string, signal: AbortSignal) {
      signal.throwIfAborted();
      const settings = currentSettings();
      const endpoint = AUDIO_GENERATION_ENDPOINT;
      const key = settings.speechKey.trim();
      if (!key) {
        throw new Error(
          t("fcboard.enter_your_doubao_speech_api_key_in_voice_settings"),
        );
      }
      if (
        !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language) ||
        !supportedLanguages.has(language.split("-")[0].toLowerCase())
      ) {
        throw new Error(
          t("fcboard.pronunciation_language_not_supported", { language }),
        );
      }
      const prompt = `Read only the following text in ${language}, with natural, accurate pronunciation. Preserve the original words. Do not translate or add any other speech. Text: ${JSON.stringify(
        text,
      )}`;
      if (!text.trim() || prompt.length > 3000) {
        throw new Error(t("fcboard.invalid_ai_command_please_try_again"));
      }
      const identity = JSON.stringify([endpoint, key]);
      if (identity !== credentials) {
        clear();
        credentials = identity;
      }
      touch();
      const token = JSON.stringify([language, text]);
      const cached = cache.get(token);
      if (cached) {
        cache.delete(token);
        cache.set(token, cached);
        return cached;
      }
      const request = ownedRequest(
        signal,
        () => {
          const current = currentSettings();
          try {
            return current.speechKey.trim() === key;
          } catch {
            return false;
          }
        },
        (check) => {
          window.addEventListener(SETTINGS_CHANGED, check);
          return [() => window.removeEventListener(SETTINGS_CHANGED, check)];
        },
      );
      pending.add(request.controller);
      try {
        return await request.run(async () => {
          const body = {
            model: "seed-audio-1.0",
            text_prompt: prompt,
            audio_config: { format: "mp3", sample_rate: 24000 },
          };
          const headers = {
            "Content-Type": "application/json",
            "X-Api-Key": key,
            "X-Api-Request-Id": crypto.randomUUID(),
          };
          let status: number;
          let result: unknown;
          if (Capacitor.isNativePlatform()) {
            // Capacitor's installed native HTTP transport bypasses WebView CORS.
            // Its connection is bounded even if the plugin ignores caller abort.
            const response = await CapacitorHttp.post({
              url: endpoint,
              headers,
              data: body,
              responseType: "json",
              disableRedirects: true,
              connectTimeout: 15000,
              readTimeout: 30000,
            });
            status = response.status;
            result = response.data;
          } else {
            const response = await fetch(endpoint, {
              method: "POST",
              headers,
              body: JSON.stringify(body),
              signal: request.signal,
              redirect: "error",
            });
            status = response.status;
            const raw = await response.text();
            if (raw.length > 8_000_000) {
              throw new Error(
                t("fcboard.the_voice_service_returned_invalid_audio"),
              );
            }
            result = raw;
          }
          request.signal.throwIfAborted();
          if (status < 200 || status >= 300) {
            throw new Error(
              t("fcboard.voice_playback_request_failed_status", { status }),
            );
          }
          if (typeof result === "string") {
            try {
              result = JSON.parse(result);
            } catch {
              throw new Error(
                t("fcboard.the_voice_service_returned_invalid_audio"),
              );
            }
          }
          // The provider's documented success response omits code. Require the
          // actual audio artifact instead of inventing a success-code contract.
          const audio =
            result && typeof result === "object" && "audio" in result
              ? result.audio
              : undefined;
          if (
            typeof audio !== "string" ||
            !audio.length ||
            audio.length > 8_000_000 ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(audio)
          ) {
            throw new Error(
              t("fcboard.the_voice_service_returned_invalid_audio"),
            );
          }
          // Browser-native data URL decoding avoids a large atob/byte loop on
          // the input/rendering thread. No expiring provider URL is persisted.
          const decoded = await fetch(`data:audio/mpeg;base64,${audio}`, {
            signal: request.signal,
          });
          const blob = await decoded.blob();
          request.signal.throwIfAborted();
          if (
            !blob.size ||
            blob.size > maxAudioBytes ||
            !blob.type.startsWith("audio/")
          ) {
            throw new Error(
              t("fcboard.the_voice_service_returned_invalid_audio"),
            );
          }
          const previous = cache.get(token);
          if (previous) {
            bytes -= previous.size;
            cache.delete(token);
          }
          while (cache.size >= 4 || bytes + blob.size > maxAudioBytes) {
            const first = cache.entries().next().value;
            if (!first) {
              break;
            }
            bytes -= first[1].size;
            cache.delete(first[0]);
          }
          cache.set(token, blob);
          bytes += blob.size;
          touch();
          return blob;
        });
      } finally {
        pending.delete(request.controller);
      }
    },
  };
};
