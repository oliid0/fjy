import { Capacitor, registerPlugin } from "@capacitor/core";
import { SpeechRecognition } from "@capacitor-community/speech-recognition";
import { t } from "@fcboard/fcboard/i18n";

import type { SpeechRecognitionPlugin } from "@capacitor-community/speech-recognition";

// Older installed shells retain their existing provider; new APKs own the complete lifecycle.
const system = registerPlugin<
  Pick<
    SpeechRecognitionPlugin,
    "available" | "requestPermissions" | "start" | "stop"
  >
>("FcboardSystemSpeech");

export const startAndroidSpeech = async (
  onText: (text: string) => void,
  onError: (message: string) => void,
  continuous: boolean,
  language: string,
): Promise<() => void> => {
  if (
    language.toLowerCase().startsWith("zh") &&
    Capacitor.isPluginAvailable("FcboardLocalSpeech")
  ) {
    void import("./localSpeech")
      .then(({ prepareLocalSpeech }) => prepareLocalSpeech())
      .catch(() => {});
  }
  const provider = Capacitor.isPluginAvailable("FcboardSystemSpeech")
    ? system
    : SpeechRecognition;
  let stopped = false;
  let received = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let offline:
    | Awaited<ReturnType<typeof import("./localSpeech")["startLocalSpeech"]>>
    | undefined;
  let fallingBack = false;
  const deliver = (text: string) => {
    if (stopped || (!continuous && received) || !text.trim()) {
      return;
    }
    received = true;
    onText(text);
  };
  const fallback = async () => {
    if (stopped || fallingBack) {
      return;
    }
    fallingBack = true;
    // The bundled model is Chinese, not an unspecified replacement for other languages.
    if (!language.toLowerCase().startsWith("zh")) {
      throw new Error(
        t(
          "fcboard.system_speech_is_unavailable_for_this_language_configure_a_custom_speech_service",
        ),
      );
    }
    const { startLocalSpeech } = await import("./localSpeech");
    if (stopped) {
      return;
    }
    offline = await startLocalSpeech(
      (line) => {
        deliver(line.text);
        if (!continuous && received) {
          void offline?.stop().catch(() => {});
        }
      },
      (message) => {
        if (!stopped) {
          onError(message);
        }
      },
    );
    if (stopped) {
      await offline.cancel();
    } else if (!continuous && received) {
      await offline.stop();
    }
  };
  const report = (failure: unknown) => {
    if (!stopped) {
      onError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    clearTimeout(timer);
    void provider.stop().catch(() => {});
    void offline?.cancel().catch(() => {});
  };
  let available = false;
  try {
    available = (await provider.available()).available;
  } catch {
    /* Missing/broken provider. */
  }
  if (!available) {
    await fallback();
    return stop;
  }
  if ((await provider.requestPermissions()).speechRecognition !== "granted") {
    throw new Error(
      t("fcboard.allow_microphone_and_speech_recognition_access"),
    );
  }
  const listen = () => {
    if (stopped) {
      return;
    }
    void provider
      .start({ language, maxResults: 1, partialResults: false, popup: false })
      .then(async ({ matches }) => {
        if (stopped) {
          return;
        }
        const text = matches?.[0]?.trim();
        if (text) {
          deliver(text);
        } else if (!continuous) {
          if (language.toLowerCase().startsWith("zh")) {
            await provider.stop();
            await fallback();
          } else {
            onError(t("fcboard.no_speech_recognized_please_try_again"));
          }
        }
        if (continuous && !stopped) {
          timer = setTimeout(listen, 300);
        }
      })
      .catch(async (error: { code?: string }) => {
        if (stopped) {
          return;
        }
        if (error?.code === "cancelled") {
          stopped = true;
          onError(t("fcboard.speech_recognition_ended_start_listening_again"));
          return;
        }
        // A quiet interval is normal during continuous transcription, not a provider failure.
        if (error?.code === "speech-6" || error?.code === "speech-7") {
          if (continuous) {
            timer = setTimeout(listen, 300);
          } else if (language.toLowerCase().startsWith("zh")) {
            try {
              await provider.stop();
              await fallback();
            } catch (failure) {
              report(failure);
            }
          } else {
            onError(t("fcboard.no_speech_recognized_please_try_again"));
          }
          return;
        }
        if (error?.code === "permission" || error?.code === "speech-9") {
          onError(t("fcboard.allow_microphone_and_speech_recognition_access"));
          return;
        }
        try {
          if (provider === system) {
            await provider.stop();
          } else {
            void provider.stop().catch(() => {});
          }
          await fallback();
        } catch (failure) {
          report(failure);
        }
      });
  };
  listen();
  return stop;
};
