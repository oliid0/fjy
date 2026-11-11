import { t } from "@fcboard/fcboard/i18n";

import { hasNativeTranslation, translateNatively } from "./nativeTranslation";
import { inferNatively } from "./nativeInference";

/** Android uses the isolated native engine; only browsers load WASM. */
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
    : /^\p{ASCII}+$/u.test(text)
    ? "en"
    : undefined;
  if (!source || (target !== "zh" && target !== "en")) {
    if (hasNativeTranslation()) {
      return translateNatively(text, targetLanguage, signal);
    }
    throw new Error(t("fcboard.local_translation_pair_unavailable"));
  }
  if (source === target) {
    return { language: source, translation: text };
  }
  // A compile-time branch around imports keeps browser workers out of APKs.
  if (import.meta.env.VITE_NATIVE_INFERENCE !== "true") {
    if (!hasNativeTranslation()) {
      if (source === "en" && target === "zh") {
        const { lookupLocalWord } = await import("./localDictionary");
        const translation = await lookupLocalWord(text, signal);
        if (translation) {
          return { language: source, translation };
        }
      }
      const { offlineInference } = await import("./offlineInference");
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
    }
  }
  const result = await inferNatively(
    { kind: "translation", text, source, target },
    signal,
  );
  if (
    result.language !== source ||
    typeof result.translation !== "string" ||
    !result.translation.trim() ||
    result.translation.length > 10000
  ) {
    throw new Error(
      t("fcboard.the_language_explanation_is_incomplete_please_retry"),
    );
  }
  return { language: source, translation: result.translation };
};
