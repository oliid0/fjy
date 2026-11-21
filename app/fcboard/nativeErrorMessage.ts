import { t } from "@fcboard/fcboard/i18n";
import nativeErrors from "@fcboard/fcboard/locales/data/nativeErrors.json";

import type { TranslationKeys } from "@fcboard/fcboard/i18n";

/** Translate native diagnostics only when displayed; keep source errors untouched. */
export const nativeErrorMessage = (message: string) => {
  const value = message.replace(/^Error: /, "");
  for (const entry of nativeErrors) {
    if (value.startsWith(entry.source)) {
      return (
        t(`fcboard.nativeErrors.${entry.key}` as TranslationKeys) +
        value.slice(entry.source.length)
      );
    }
  }
  return message;
};
