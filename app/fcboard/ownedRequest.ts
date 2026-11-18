import { t } from "@fcboard/fcboard/i18n";

/** Each operation owns its source, deadline and backend signal.
 * An uncooperative backend may finish later, but cannot hold the caller open. */
export const ownedRequest = (
  parent: AbortSignal | undefined,
  current: () => boolean,
  watch: (check: () => void) => (() => void)[],
) => {
  const controller = new AbortController();
  let disposed = false;
  const abort = () => controller.abort(parent?.reason);
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) {
    abort();
  }
  const check = () => {
    if (!disposed && !current()) {
      controller.abort(
        new DOMException("Request source changed", "AbortError"),
      );
    }
  };
  const stops = watch(check);
  const timer = setTimeout(
    () =>
      controller.abort(
        new Error(
          t(
            "fcboard.ai_request_timed_out_check_your_connection_or_try_again_later",
          ),
        ),
      ),
    30000,
  );
  check();
  const dispose = () => {
    disposed = true;
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
    stops.forEach((stop) => stop());
  };
  return {
    controller,
    signal: controller.signal,
    run: async <T>(work: () => Promise<T>): Promise<T> => {
      let removeAbort = () => {};
      try {
        controller.signal.throwIfAborted();
        const cancelled = new Promise<never>((_resolve, reject) => {
          const rejectAbort = () => reject(controller.signal.reason);
          controller.signal.addEventListener("abort", rejectAbort, {
            once: true,
          });
          removeAbort = () =>
            controller.signal.removeEventListener("abort", rejectAbort);
        });
        return await Promise.race([work(), cancelled]);
      } finally {
        removeAbort();
        dispose();
      }
    },
  };
};
