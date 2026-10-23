import { t } from "@excalidraw/excalidraw/i18n";

import { currentSettings } from "./settings";

type Engine = Awaited<
  ReturnType<typeof import("@paddleocr/paddleocr-js")["PaddleOCR"]["create"]>
>;
let engine: Promise<Engine> | undefined;
let queue: Promise<unknown> = Promise.resolve();

const getEngine = () => {
  engine ||= import("@paddleocr/paddleocr-js")
    .then(({ PaddleOCR }) =>
      PaddleOCR.create({
        worker: {
          createWorker: () =>
            new Worker(
              new URL(
                `${import.meta.env.BASE_URL}ocr/worker.js`,
                location.href,
              ),
              { type: "module" },
            ),
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
      engine = undefined;
      throw error;
    });
  return engine;
};

/** Load local assets during idle time; never capture the canvas or run recognition. */
export const warmHandwriting = async () => {
  if (currentSettings().ocr === "cloud" || typeof Worker === "undefined") {
    return;
  }
  await getEngine();
};

export const recognizeLocalHandwriting = async (
  image: string,
  signal: AbortSignal,
  progress: (message: string) => void,
) => {
  progress(t("fcboard.正在准备本地手写识别…"));
  const task = queue
    .catch(() => {})
    .then(async () => {
      signal.throwIfAborted();
      const instance = await getEngine();
      signal.throwIfAborted();
      progress(t("fcboard.正在本地识别手写…"));
      const blob = await (await fetch(image, { signal })).blob();
      const [result] = await instance.predict(blob);
      signal.throwIfAborted();
      const items = result.items.filter(
        (item) => item.score >= 0.55 && item.text.trim(),
      );
      if (!items.length) {
        throw new Error(
          t(
            "fcboard.未能可靠识别选区。请缩小圈选范围，或在设置中选择云端手写识别。",
          ),
        );
      }
      return items.map((item) => item.text).join("\n");
    });
  queue = task;
  return task;
};
