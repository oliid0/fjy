import { t } from "@fcboard/fcboard/i18n";

import { offlineInference } from "./offlineInference";

/** Bundled OPUS models support Chinese/English. Never silently use an online
 * endpoint or claim that translation-only models produced grammar analysis. */
export const translateLocally = async (
  text: string,
  targetLanguage: string,
  signal: AbortSignal,
) => {
  signal.throwIfAborted();
  if (!text.trim() || text.length > 4000) {
    throw new Error(t("fcboard.text_is_empty_or_too_long"));
  }
  const target = targetLanguage.toLowerCase().split("-")[0];
  const source = /[\u3400-\u9fff]/.test(text)
    ? "zh"
    : /^[\p{Script=Latin}\p{N}\p{P}\p{Z}\s\p{S}]+$/u.test(text)
    ? "en"
    : undefined;
  if (!source || (target !== "zh" && target !== "en")) {
    throw new Error(t("fcboard.local_translation_pair_unavailable"));
  }
  if (source === target) {
    return { language: source, translation: text };
  }
  // Keep every character while bounding encoder/decoder memory per inference.
  const chunks =
    text.match(/[^。！？.!?\n]{1,80}[。！？.!?\n]?|[。！？.!?\n]/gu) || [];
  if (chunks.join("") !== text) {
    throw new Error(t("fcboard.text_is_empty_or_too_long"));
  }
  const translated: string[] = [];
  for (const chunk of chunks) {
    signal.throwIfAborted();
    if (!chunk.trim()) {
      translated.push(chunk);
      continue;
    }
    const result = await offlineInference(
      { kind: "translation", text: chunk, source, target },
      signal,
    );
    if (
      !Array.isArray(result) ||
      result.length !== 1 ||
      typeof result[0]?.translation_text !== "string" ||
      !result[0].translation_text.trim() ||
      result[0].translation_text.length > 1800
    ) {
      throw new Error(
        t("fcboard.the_language_explanation_is_incomplete_please_retry"),
      );
    }
    translated.push(result[0].translation_text.trim());
  }
  signal.throwIfAborted();
  return {
    language: source,
    translation: translated.join(target === "en" ? " " : ""),
  };
};
