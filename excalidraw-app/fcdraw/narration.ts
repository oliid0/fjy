import { currentSettings, validateEndpoint } from "./settings";

/** Explicit playback with one owner; starting again or closing the panel cancels it. */
export const createNarrator = () => {
  let request: AbortController | undefined;
  let player: HTMLAudioElement | undefined;
  let url: string | undefined;
  const stop = () => {
    request?.abort();
    request = undefined;
    if (player) {
      player.onended = null;
      player.onerror = null;
      player.pause();
    }
    player = undefined;
    if (url) {
      URL.revokeObjectURL(url);
      url = undefined;
    }
  };
  return {
    stop,
    async speak(text: string) {
      stop();
      const settings = currentSettings();
      if (!settings.ttsEndpoint) {
        throw new Error("请先设置 IndexTTS / 自定义播报接口");
      }
      const controller = new AbortController();
      request = controller;
      try {
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
          throw new Error(`语音播报请求失败 (${response.status})`);
        }
        const blob = await response.blob();
        if (!blob.size || !blob.type.startsWith("audio/")) {
          throw new Error("播报接口未返回有效音频");
        }
        if (controller.signal.aborted) {
          return;
        }
        url = URL.createObjectURL(blob);
        player = new Audio(url);
        player.onended = stop;
        player.onerror = stop;
        await player.play();
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
