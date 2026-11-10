import { t } from "@fcboard/fcboard/i18n";

import { currentSettings } from "./settings";
import { queueLocalInference } from "./localInferenceQueue";

type Engine = Awaited<
  ReturnType<typeof import("@paddleocr/paddleocr-js")["PaddleOCR"]["create"]>
>;
let engine: Promise<Engine> | undefined;
let worker: Worker | undefined;
let generation = 0;
let pending = 0;
let idle: ReturnType<typeof setTimeout> | undefined;
const reset = () => {
  clearTimeout(idle);
  generation++;
  worker?.terminate();
  worker = undefined;
  const previous = engine;
  engine = undefined;
  void previous?.then((instance) => instance.dispose()).catch(() => {});
};

const getEngine = () => {
  const version = generation;
  engine ||= import("@paddleocr/paddleocr-js")
    .then(({ PaddleOCR }) =>
      PaddleOCR.create({
        worker: {
          createWorker: () => {
            if (version !== generation) {
              throw new DOMException("Aborted", "AbortError");
            }
            worker = new Worker(
              new URL(
                `${import.meta.env.BASE_URL}ocr/worker.js`,
                location.href,
              ),
              { type: "module" },
            );
            return worker;
          },
        },
        textDetectionModelName: "PP-OCRv5_mobile_det",
        textRecognitionModelName: "PP-OCRv5_mobile_rec",
        textDetectionModelAsset: {
          url: `${import.meta.env.BASE_URL}ocr/models/PP-OCRv5_mobile_det.tar`,
        },
        textRecognitionModelAsset: {
          url: `${import.meta.env.BASE_URL}ocr/models/PP-OCRv5_mobile_rec.tar`,
        },
        ortOptions: {
          backend: "wasm",
          numThreads: 1,
          wasmPaths: new URL(
            `${import.meta.env.BASE_URL}ocr/ort/`,
            location.href,
          ).href,
        },
      }),
    )
    .catch((error) => {
      if (version === generation) {
        engine = undefined;
      }
      throw error;
    });
  return engine;
};

/** Explicit recognition UI may prepare bundled assets; never called at app startup. */
export const warmHandwriting = async () => {
  if (currentSettings().ocr === "cloud" || typeof Worker === "undefined") {
    return;
  }
  await queueLocalInference("ocr", reset, async () => {
    clearTimeout(idle);
    await getEngine();
    if (!pending) {
      idle = setTimeout(reset, 15000);
    }
  });
};

export const recognizeLocalHandwriting = async (
  image: string,
  signal: AbortSignal,
  progress: (message: string) => void,
) => {
  signal.throwIfAborted();
  if (pending >= 8) {
    throw new Error(t("fcboard.local_queue_full"));
  }
  pending++;
  let frame: string | undefined = image;
  let settled = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolve!: (value: string) => void;
  let reject!: (error: unknown) => void;
  const result = new Promise<string>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  const finish = (value?: string, failure?: unknown) => {
    if (settled) {
      return;
    }
    settled = true;
    frame = undefined;
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    if (failure !== undefined) {
      if (running) {
        reset();
      }
      reject(failure);
    } else {
      resolve(value!);
    }
  };
  const abort = () =>
    finish(
      undefined,
      signal.reason || new DOMException("Aborted", "AbortError"),
    );
  signal.addEventListener("abort", abort, { once: true });
  void queueLocalInference(
    "ocr",
    reset,
    async () => {
      if (settled || !frame) {
        return;
      }
      running = true;
      clearTimeout(idle);
      timer = setTimeout(
        () =>
          finish(undefined, new Error(t("fcboard.local_inference_timeout"))),
        30000,
      );
      void (async () => {
        progress(t("fcboard.preparing_local_handwriting_recognition"));
        const instance = await getEngine();
        if (settled) {
          return;
        }
        signal.throwIfAborted();
        progress(t("fcboard.recognizing_handwriting_locally"));
        const blob = await (await fetch(frame!, { signal })).blob();
        if (settled) {
          return;
        }
        const [result] = await instance.predict(blob);
        if (settled) {
          return;
        }
        signal.throwIfAborted();
        const items = result.items.filter(
          (item) => item.score >= 0.55 && item.text.trim(),
        );
        if (!items.length) {
          throw new Error(
            t(
              "fcboard.the_selection_could_not_be_read_reliably_select_a_smaller_area_or_choose_cloud_handwriting",
            ),
          );
        }
        finish(items.map((item) => item.text).join("\n"));
      })().catch((error) => finish(undefined, error));
      await result.catch(() => {});
      running = false;
    },
    () => !settled,
  ).catch((error) => finish(undefined, error));
  return result.finally(() => {
    pending--;
    if (!pending) {
      idle = setTimeout(reset, 15000);
    }
  });
};
