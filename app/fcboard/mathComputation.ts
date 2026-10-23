import { t } from "@excalidraw/excalidraw/i18n";

import { calculateLocal, prepareCalculation } from "./mathCalculation";

/** A symbolic solver can loop on valid syntax. Cancellation/timeout terminates its worker. */
export const calculateAsync = async (
  input: string,
  signal?: AbortSignal,
): Promise<string> => {
  signal?.throwIfAborted();
  const { expression, symbolic } = prepareCalculation(input);
  if (!symbolic && !expression.includes("=")) {
    return calculateLocal(expression);
  }
  if (typeof Worker === "undefined") {
    throw new Error(t("fcboard.该算式没有可用结果"));
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./math.worker.ts", import.meta.url), {
      type: "module",
    });
    let finished = false;
    const finish = (answer?: string, failure?: unknown) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      if (failure) {
        reject(failure);
      } else if (answer) {
        resolve(answer);
      } else {
        reject(new Error(t("fcboard.该算式没有可用结果")));
      }
    };
    const abort = () =>
      finish(
        undefined,
        signal?.reason || new DOMException("Aborted", "AbortError"),
      );
    const timer = setTimeout(() => finish(), 6000);
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (
      event: MessageEvent<{ answer?: unknown; error?: unknown }>,
    ) => {
      if (signal?.aborted) {
        abort();
        return;
      }
      finish(
        typeof event.data.answer === "string" && !event.data.error
          ? event.data.answer
          : undefined,
      );
    };
    worker.onerror = () => finish();
    worker.postMessage({ expression });
  });
};
