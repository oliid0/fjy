import { t, getLanguage } from "@excalidraw/excalidraw/i18n";

import { currentSettings, validateEndpoint } from "./settings";

let activeOwner: { pause: () => void } | undefined;

/** One audible owner. A paused lecture keeps its audio position during an interjection. */
export const createNarrator = () => {
  let request: AbortController | undefined;
  let player: HTMLAudioElement | undefined;
  let url: string | undefined;
  let utterance: SpeechSynthesisUtterance | undefined;
  let paused = false;
  let words = "";
  let offset = 0;
  let rate = 1;
  let boundary: ((offset: number) => void) | undefined;
  let complete: (() => void) | undefined;
  let finished = Promise.resolve();
  const finish = () => {
    complete?.();
    complete = undefined;
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
        finish();
      }
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(next);
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
      finished = new Promise<void>((resolve) => {
        complete = resolve;
      });
      const settings = currentSettings();
      const controller = new AbortController();
      request = controller;
      try {
        if (!settings.ttsEndpoint) {
          if (
            !window.speechSynthesis ||
            typeof SpeechSynthesisUtterance === "undefined"
          ) {
            throw new Error(
              t(
                "fcboard.此设备没有播报引擎，请在设置中连接语音播报；当前可使用字幕讲解",
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
            t("fcboard.语音播报请求失败 ({{status}})", {
              status: response.status,
            }),
          );
        }
        const blob = await response.blob();
        if (!blob.size || !blob.type.startsWith("audio/")) {
          throw new Error(t("fcboard.播报接口未返回有效音频"));
        }
        if (controller.signal.aborted) {
          return;
        }
        url = URL.createObjectURL(blob);
        player = new Audio(url);
        player.playbackRate = rate;
        player.onended = finish;
        player.onerror = finish;
        if (!paused) {
          await player.play();
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
