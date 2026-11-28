import { selectMenu } from "./menu";

import type { Message } from "../app/fcboard/ai";
import type { Page } from "@playwright/test";

export const voiceEndpoint = "https://voice-test.example/v1/chat/completions";

export const messageText = (content: Message["content"]) =>
  typeof content === "string"
    ? content
    : content
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n");

/** A fresh visual observation follows the actual tool-results message. */
export const toolOutput = (messages: Message[]) => {
  const output = [...messages]
    .reverse()
    .find(
      (message) =>
        message.role === "user" &&
        messageText(message.content).startsWith("The following is tool output"),
    );
  if (output) {
    const text = messageText(output.content);
    return JSON.parse(text.slice(text.indexOf("\n") + 1));
  }
};

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
    const spoken: string[] = [];
    Reflect.set(window, "fcTestSpeechOutput", spoken);
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        cancel() {},
        getVoices: () => [],
        speak(utterance: SpeechSynthesisUtterance) {
          spoken.push(utterance.text);
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
