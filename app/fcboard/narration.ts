import { t, getLanguage } from "@excalidraw/excalidraw/i18n";
import { Capacitor } from "@capacitor/core";

import { currentSettings, validateEndpoint } from "./settings";
import { OfflineTts, narrationChunks } from "./nativeNarration";

let activeOwner: { pause: () => void } | undefined;
let audible: { owner: object; text: string; until: number } | undefined;
const normalizedSpeech = (text: string) =>
  text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
/** Only suppress a complete, substantial transcript segment contained in actual playback. */
export const isNarrationEcho = (text: string) => {
  const value = normalizedSpeech(text);
  return (
    !!audible &&
    Date.now() <= audible.until &&
    value.length >= 8 &&
    audible.text.includes(value)
  );
};

/** One audible owner. A paused lecture keeps its audio position during an interjection. */
export const createNarrator = () => {
  let request: AbortController | undefined;
  let player: HTMLAudioElement | undefined;
  let url: string | undefined;
  let utterance: SpeechSynthesisUtterance | undefined;
  let nativeId: string | undefined;
  let paused = false;
  let words = "";
  let offset = 0;
  let rate = 1;
  let boundary: ((offset: number) => void) | undefined;
  let complete: (() => void) | undefined;
  let reject: ((error: Error) => void) | undefined;
  let finished = Promise.resolve();
  const markAudible = (playing: boolean) => {
    if (playing) {
      audible = { owner, text: normalizedSpeech(words), until: Infinity };
    } else if (audible?.owner === owner) {
      audible.until = Date.now() + 1200;
    }
  };
  const finish = () => {
    markAudible(false);
    complete?.();
    complete = undefined;
    reject = undefined;
  };
  const fail = (error: Error) => {
    reject?.(error);
    complete = undefined;
    reject = undefined;
    stop();
  };
  const owner = { pause: () => pause() };
  const stop = () => {
    request?.abort();
    request = undefined;
    if (player) {
      player.onended = null;
      player.onerror = null;
      player.pause();
    }
    player = undefined;
    if (nativeId) {
      void OfflineTts.cancel({ id: nativeId }).catch(() => {});
      nativeId = undefined;
    }
    if (utterance && activeOwner === owner) {
      window.speechSynthesis?.cancel();
    }
    utterance = undefined;
    if (url) {
      URL.revokeObjectURL(url);
      url = undefined;
    }
    if (activeOwner === owner) {
      activeOwner = undefined;
    }
    finish();
  };
  const pause = () => {
    markAudible(false);
    paused = true;
    player?.pause();
    if (utterance && activeOwner === owner) {
      window.speechSynthesis?.pause();
    }
  };
  const synthesize = () => {
    const start = offset;
    const next = new SpeechSynthesisUtterance(words.slice(start));
    utterance = next;
    next.lang = getLanguage().code;
    next.rate = rate;
    next.onboundary = (event) => {
      offset = start + event.charIndex;
      boundary?.(offset);
    };
    next.onend = () => {
      if (!paused && utterance === next) {
        offset = words.length;
        boundary?.(offset);
        finish();
      }
    };
    next.onerror = () => {
      if (!paused && utterance === next) {
        fail(new Error(t("fcboard.the_voice_service_returned_invalid_audio")));
      }
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(next);
    markAudible(true);
  };
  const resume = async () => {
    if (!paused) {
      return;
    }
    if (activeOwner && activeOwner !== owner) {
      activeOwner.pause();
    }
    activeOwner = owner;
    paused = false;
    if (player) {
      await player.play();
      markAudible(true);
    } else if (utterance) {
      synthesize();
    }
  };
  return {
    stop,
    pause,
    resume,
    get finished() {
      return finished;
    },
    async speak(
      text: string,
      options?: { rate?: number; onBoundary?: (offset: number) => void },
    ) {
      stop();
      if (activeOwner && activeOwner !== owner) {
        activeOwner.pause();
      }
      activeOwner = owner;
      paused = false;
      words = text;
      offset = 0;
      rate = Math.min(2, Math.max(0.5, options?.rate || 1));
      boundary = options?.onBoundary;
      finished = new Promise<void>((resolve, failure) => {
        complete = resolve;
        reject = failure;
      });
      // Playback can fail before the caller has returned from speak().
      void finished.catch(() => {});
      const settings = currentSettings();
      const controller = new AbortController();
      request = controller;
      try {
        if (!settings.ttsEndpoint && Capacitor.getPlatform() === "android") {
          const chunks = narrationChunks(text);
          if (!chunks.length) {
            finish();
            return;
          }
          const next = async (index: number) => {
            if (controller.signal.aborted) {
              return;
            }
            const id = crypto.randomUUID();
            nativeId = id;
            const result = await OfflineTts.synthesize({
              id,
              text: chunks[index],
            });
            if (controller.signal.aborted) {
              return;
            }
            player = new Audio(Capacitor.convertFileSrc(result.path));
            player.playbackRate = rate;
            player.onerror = () => {
              if (controller.signal.aborted || nativeId !== id) {
                return;
              }
              fail(
                new Error(
                  t("fcboard.the_voice_service_returned_invalid_audio"),
                ),
              );
            };
            player.onended = () => {
              if (controller.signal.aborted || nativeId !== id) {
                return;
              }
              player = undefined;
              nativeId = undefined;
              void OfflineTts.cancel({ id }).catch(() => {});
              offset += chunks[index].length;
              boundary?.(offset);
              if (index + 1 === chunks.length) {
                finish();
              } else {
                void next(index + 1).catch((error) => {
                  if (!controller.signal.aborted) {
                    fail(error);
                  }
                });
              }
            };
            if (!paused) {
              await player.play();
              if (!controller.signal.aborted) {
                markAudible(true);
              }
            }
          };
          await next(0);
          return;
        } else if (!settings.ttsEndpoint) {
          if (
            !window.speechSynthesis ||
            typeof SpeechSynthesisUtterance === "undefined"
          ) {
            throw new Error(
              t(
                "fcboard.no_speech_engine_is_available_connect_a_voice_service_in_settings_or_teach_with_captions",
              ),
            );
          }
          synthesize();
          return;
        }
        const response = await fetch(validateEndpoint(settings.ttsEndpoint), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(settings.ttsKey
              ? { Authorization: `Bearer ${settings.ttsKey}` }
              : {}),
          },
          body: JSON.stringify({ input: text, response_format: "wav" }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(
            t("fcboard.voice_playback_request_failed_status", {
              status: response.status,
            }),
          );
        }
        const blob = await response.blob();
        if (!blob.size || !blob.type.startsWith("audio/")) {
          throw new Error(
            t("fcboard.the_voice_service_returned_invalid_audio"),
          );
        }
        if (controller.signal.aborted) {
          return;
        }
        url = URL.createObjectURL(blob);
        player = new Audio(url);

        player.playbackRate = rate;
        player.onended = () => {
          if (controller.signal.aborted) {
            return;
          }
          offset = words.length;
          boundary?.(offset);
          finish();
        };
        player.onerror = () => {
          if (controller.signal.aborted) {
            return;
          }
          fail(
            new Error(t("fcboard.the_voice_service_returned_invalid_audio")),
          );
        };
        if (!paused) {
          await player.play();
          if (!controller.signal.aborted) {
            markAudible(true);
          }
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        stop();
        throw error;
      }
    },
  };
};
