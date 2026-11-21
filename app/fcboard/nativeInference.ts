import { registerPlugin } from "@capacitor/core";

import type { InkInput } from "./digitalInk";

const engine = registerPlugin<{
  infer(options: {
    id: string;
    kind: "math" | "translation";
    strokes?: InkInput;
    text?: string;
    source?: string;
    target?: string;
  }): Promise<{ latex?: string; language?: string; translation?: string }>;
  cancel(options: { id: string }): Promise<void>;
}>("FcboardLocalInference");

/** Only coordinates/text cross the bridge. Model weights and tensors stay native. */
export const inferNatively = (
  task: Omit<Parameters<typeof engine.infer>[0], "id">,
  signal: AbortSignal,
) => {
  signal.throwIfAborted();
  const id = crypto.randomUUID();
  return new Promise<Awaited<ReturnType<typeof engine.infer>>>(
    (resolve, reject) => {
      const abort = () => {
        void engine.cancel({ id }).catch(() => {});
        reject(
          signal.reason ||
            new DOMException("Inference cancelled", "AbortError"),
        );
      };
      signal.addEventListener("abort", abort, { once: true });
      void engine
        .infer({ ...task, id })
        .then((result) => {
          signal.throwIfAborted();
          resolve(result);
        })
        .catch(reject)
        .finally(() => signal.removeEventListener("abort", abort));
    },
  );
};
