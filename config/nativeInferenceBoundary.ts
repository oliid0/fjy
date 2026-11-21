import type { OutputChunk } from "rollup";

type NativeBundle = Record<
  string,
  Pick<OutputChunk, "type" | "fileName" | "modules"> | { type: "asset" }
>;

/** Android has no executable web inference code, including lazy chunks. */
export const assertNativeInferenceBoundary = (bundle: NativeBundle) => {
  const forbidden =
    /(?:[/\\](?:@paddleocr|@techstark|onnxruntime-web|@huggingface|ink-on)[/\\]|localInference\.worker|offlineInference\.ts|localOcr\.ts|localDictionary\.ts|mathInkPreprocessing\.ts)/;
  for (const [name, entry] of Object.entries(bundle)) {
    if (entry.type !== "chunk") {
      if (
        /\.onnx$|(?:ort-wasm|opencv|paddleocr|localInference|worker-entry).*\.(?:m?js|wasm)$/i.test(
          name,
        )
      ) {
        throw new Error(`Android contains a web inference asset: ${name}`);
      }
      continue;
    }
    for (const id of Object.keys(entry.modules)) {
      if (forbidden.test(id)) {
        throw new Error(
          `Android contains web inference: ${entry.fileName} -> ${id}`,
        );
      }
    }
  }
};
