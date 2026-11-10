import { t } from "@fcboard/fcboard/i18n";

import { queueLocalInference } from "./localInferenceQueue";

export type OfflineTask =
  | {
      kind: "math";
      tensor: Float32Array;
      mask: Uint8Array;
      height: number;
      width: number;
      maskHeight: number;
      maskWidth: number;
    }
  | {
      kind: "translation";
      text: string;
      source: "en" | "zh";
      target: "en" | "zh";
    };
let worker: Worker | undefined;
let model = "";
let sequence = 0;
let queued = 0;
let idle: ReturnType<typeof setTimeout> | undefined;
const release = () => {
  clearTimeout(idle);
  worker?.terminate();
  worker = undefined;
  model = "";
};

/** Only one heavy local worker runs at once. A queued/aborted task never cancels
 * another caller. Switching models releases the previous WASM heap first. */
export const offlineInference = (
  input: OfflineTask,
  signal: AbortSignal,
): Promise<unknown> => {
  signal.throwIfAborted();
  if (queued >= 8) {
    return Promise.reject(new Error(t("fcboard.local_queue_full")));
  }
  if (typeof Worker === "undefined") {
    return Promise.reject(new Error(t("fcboard.local_runtime_unavailable")));
  }
  queued++;
  let payload: OfflineTask | undefined = input;
  const id = ++sequence;
  let done = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const result = new Promise<unknown>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  const settle = (value?: unknown, error?: unknown) => {
    if (done) {
      return;
    }
    done = true;
    payload = undefined;
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    if (error !== undefined) {
      if (running) {
        release();
      }
      reject(error);
    } else {
      resolve(value);
    }
  };
  const abort = () =>
    settle(
      undefined,
      signal.reason || new DOMException("Aborted", "AbortError"),
    );
  signal.addEventListener("abort", abort, { once: true });
  const key =
    input.kind === "translation"
      ? `${input.kind}:${input.source}:${input.target}`
      : input.kind;
  void queueLocalInference(
    key,
    release,
    async () => {
      if (done || !payload) {
        return;
      }
      const task = payload;
      running = true;
      clearTimeout(idle);
      try {
        if (model !== key) {
          release();
        }
        worker ||= new Worker(
          new URL("./localInference.worker.ts", import.meta.url),
          { type: "module" },
        );
        model = key;
        worker.onmessage = (
          event: MessageEvent<{
            id: number;
            ok: boolean;
            result?: unknown;
            error?: string;
          }>,
        ) => {
          if (event.data.id !== id) {
            return;
          }
          settle(
            event.data.result,
            event.data.ok
              ? undefined
              : new Error(
                  event.data.error || t("fcboard.local_runtime_unavailable"),
                ),
          );
        };
        worker.onmessageerror = () =>
          settle(undefined, new Error(t("fcboard.local_runtime_unavailable")));
        worker.onerror = () =>
          settle(undefined, new Error(t("fcboard.local_runtime_unavailable")));
        timer = setTimeout(
          () =>
            settle(undefined, new Error(t("fcboard.local_inference_timeout"))),
          45000,
        );
        const base = new URL(
          `${import.meta.env.BASE_URL}local-models/`,
          location.href,
        ).href;
        worker.postMessage(
          { id, task, base },
          task.kind === "math"
            ? [
                task.tensor.buffer as ArrayBuffer,
                task.mask.buffer as ArrayBuffer,
              ]
            : [],
        );
      } catch (error) {
        settle(undefined, error);
      }
      await result.catch(() => {});
      running = false;
      idle = setTimeout(release, 120000);
    },
    () => !done,
  ).catch((error) => settle(undefined, error));
  return result.finally(() => {
    queued--;
  });
};
