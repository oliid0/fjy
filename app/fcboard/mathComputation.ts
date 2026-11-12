import { t } from "@fcboard/fcboard/i18n";

import { calculateLocal, prepareCalculation } from "./mathCalculation";

/** A symbolic solver can loop on valid syntax. Cancellation/timeout terminates its worker. */
export const calculateAsync = async (
  input: string,
  signal?: AbortSignal,
): Promise<string> => {
  signal?.throwIfAborted();
  const latex = /\\[A-Za-z]+/.test(input)
    ? input
        .trim()
        .replace(/^\$\$?|\$\$?$/g, "")
        .replace(/\s*[=＝]\s*$/, "")
    : undefined;
  const parsed = latex === undefined ? prepareCalculation(input) : undefined;
  if (
    parsed &&
    !parsed.symbolic &&
    /^[\d\s.eE+\-*/%()]+$/.test(parsed.expression)
  ) {
    return calculateLocal(parsed.expression);
  }
  if (typeof Worker === "undefined") {
    throw new Error(t("fcboard.this_expression_has_no_available_result"));
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
        reject(new Error(t("fcboard.this_expression_has_no_available_result")));
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
    worker.onerror = (event) => {
      event.preventDefault();
      finish();
    };
    worker.onmessageerror = () => finish();
    try {
      worker.postMessage(
        latex === undefined ? { expression: parsed!.expression } : { latex },
      );
    } catch (failure) {
      finish(undefined, failure);
    }
  });
};
