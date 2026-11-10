import type { OfflineTask } from "./offlineInference";

let math: import("ink-on/core").InferenceEngine | undefined;
let vocab: import("ink-on/core").Vocab | undefined;
let translator:
  | import("@huggingface/transformers").TranslationPipeline
  | undefined;

/** CPU/WASM only: no WebGPU, remote model endpoints, native ABI or thread pools. */
self.onmessage = async (
  event: MessageEvent<{ id: number; task: OfflineTask; base: string }>,
) => {
  const { id, task, base } = event.data;
  try {
    const origin = new URL(base);
    if (origin.origin !== self.location.origin) {
      throw new Error("Local model origin mismatch");
    }
    if (task.kind === "math") {
      const { InferenceEngine, loadVocab } = await import("ink-on/core");
      const ort = await import("onnxruntime-web");
      // ink-on's module sets hardwareConcurrency; explicitly override before init.
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = `${base}runtime/math/`;
      vocab ||= await loadVocab(`${base}comer/vocab.json`);
      math ||= new InferenceEngine({
        encoderUrl: `${base}comer/encoder_int8.onnx`,
        decoderUrl: `${base}comer/decoder_int8.onnx`,
        executionProvider: "wasm",
        beamWidth: 3,
        maxDecodeSteps: 96,
      });
      await math.init();
      const result = await math.recognize(task, vocab, "expression");
      self.postMessage({ id, ok: true, result: { latex: result.latex } });
    } else {
      const { env, pipeline } = await import("@huggingface/transformers");
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = base;
      env.useBrowserCache = false;
      env.backends.onnx.wasm!.numThreads = 1;
      env.backends.onnx.wasm!.proxy = false;
      env.backends.onnx.wasm!.wasmPaths = `${base}runtime/translation/`;
      translator ||= await pipeline<"translation">(
        "translation",
        `Xenova/opus-mt-${task.source}-${task.target}`,
        { device: "wasm", dtype: "q8", local_files_only: true },
      );
      // Upstream's callback type requires a full GenerationConfig, while
      // _call() merges these documented partial overrides into model defaults.
      const generation = {
        max_new_tokens: 256,
        num_beams: 1,
        do_sample: false,
      } as NonNullable<Parameters<NonNullable<typeof translator>>[1]>;
      const result = await translator(task.text, generation);
      self.postMessage({ id, ok: true, result });
    }
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
