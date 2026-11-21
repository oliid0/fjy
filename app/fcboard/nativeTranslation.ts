import { Capacitor, registerPlugin } from "@capacitor/core";

export const translationEngine = registerPlugin<{
  translate(options: {
    id: string;
    text: string;
    source: string;
    target: string;
  }): Promise<{ language: string; translation: string }>;
  cancel(options: { id: string }): Promise<void>;
}>("FcboardTranslation");

export const hasNativeTranslation = () => Capacitor.getPlatform() === "android";

/** Abort returns immediately; the native queue discards stale work safely. */
export const translateNatively = (
  text: string,
  target: string,
  signal: AbortSignal,
  source = "auto",
) => {
  signal.throwIfAborted();
  const id = crypto.randomUUID();
  return new Promise<{ language: string; translation: string }>(
    (resolve, reject) => {
      const abort = () => {
        void translationEngine.cancel({ id }).catch(() => {});
        reject(
          signal.reason ||
            new DOMException("Translation cancelled", "AbortError"),
        );
      };
      signal.addEventListener("abort", abort, { once: true });
      void translationEngine
        .translate({ id, text, source, target })
        .then((result) => {
          signal.throwIfAborted();
          if (
            !result ||
            !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(result.language) ||
            typeof result.translation !== "string" ||
            !result.translation.trim() ||
            result.translation.length > 10000
          ) {
            throw new Error("Invalid local translation result");
          }
          resolve(result);
        })
        .catch(reject)
        .finally(() => signal.removeEventListener("abort", abort));
    },
  );
};
