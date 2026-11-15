import { getLanguage } from "@fcboard/fcboard/i18n";

import type { Message } from "./ai";

export type AIResponseLanguage = "interface" | "input";

/** Content features follow UI language; live dialogue follows received speech. */
export const aiLanguagePolicy = (mode: AIResponseLanguage = "interface") => {
  const language = getLanguage();
  const output =
    mode === "input"
      ? "For this conversation, respond in the language of the actual spoken/written request and ongoing conversation, never translating it merely because the interface uses another language."
      : `The active interface language is ${language.code}. Use this language for answers, explanations, summaries, lesson content, quiz questions, generated resource labels and board writing, even when the input/source uses another language.`;
  return `Understand requests, speech and handwriting in any language, including mixed-language input. ${output} Explicit user instructions and translation target languages take priority. Preserve original wording/language when transcribing, quoting or returning exact source fields. Keep mathematical notation, machine command names, JSON keys, IDs and required output schemas unchanged. Do not invent unreadable content. Interface localization never restricts which input languages you understand.`;
};

/** Retain the original system contract and caller history without mutating either. */
export const withAILanguagePolicy = (
  messages: Message[],
  mode?: AIResponseLanguage,
): Message[] => {
  const policy = aiLanguagePolicy(mode);
  const first = messages[0];
  return first?.role === "system" && typeof first.content === "string"
    ? [
        { ...first, content: `${first.content}\n\n${policy}` },
        ...messages.slice(1),
      ]
    : [{ role: "system", content: policy }, ...messages];
};
