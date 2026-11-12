import { selectMenu } from "./menu";

import type { Page } from "@playwright/test";

export const voiceEndpoint = "https://voice-test.example/v1/chat/completions";

/** Mock only ASR/TTS provider boundaries; run the actual conversational/task/board adapters. */
export const installVoice = async (page: Page) => {
  await page.addInitScript((endpoint) => {
    localStorage.setItem(
      "fcboard-settings",
      JSON.stringify({
        endpoint,
        apiKey: "test-only",
        model: "test",
        speech: "system",
        assistantVoice: "agent",
        autoMath: false,
      }),
    );
    class Recognition {
      onresult?: (event: unknown) => void;
      start() {
        Reflect.set(window, "fcTestSpeechNext", (text: string) =>
          this.onresult?.({
            resultIndex: 0,
            results: [{ isFinal: true, 0: { transcript: text } }],
          }),
        );
      }
      stop() {
        Reflect.deleteProperty(window, "fcTestSpeechNext");
      }
    }
    Object.assign(window, { SpeechRecognition: Recognition });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        cancel() {},
        getVoices: () => [],
        speak(utterance: SpeechSynthesisUtterance) {
          setTimeout(
            () => utterance.onend?.(new Event("end") as SpeechSynthesisEvent),
            20,
          );
        },
      },
    });
  }, voiceEndpoint);
};
export const startVoice = (page: Page) => selectMenu(page, "语音指令");
export const say = (page: Page, text: string) =>
  page.evaluate(
    (value) => Reflect.get(window, "fcTestSpeechNext")(value),
    text,
  );
