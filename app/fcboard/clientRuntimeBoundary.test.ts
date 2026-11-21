import { assertClientRuntimeBoundary } from "../../config/clientRuntimeBoundary";
import { assertNativeInferenceBoundary } from "../../config/nativeInferenceBoundary";

import type { OutputChunk } from "rollup";

const chunk = (
  name: string,
  imports: string[] = [],
  modules: string[] = [],
): Pick<
  OutputChunk,
  "type" | "name" | "fileName" | "isEntry" | "imports" | "modules"
> => ({
  type: "chunk",
  name,
  fileName: `${name}.js`,
  isEntry: name === "app",
  imports,
  modules: Object.fromEntries(
    modules.map((id) => [
      id,
      {
        code: null,
        originalLength: 1,
        renderedLength: 1,
        removedExports: [],
        renderedExports: [],
      },
    ]),
  ),
});

it.each(["@techstark/opencv-js", "@paddleocr/paddleocr-js", "onnxruntime-web"])(
  "rejects %s executing through a shared UI dependency",
  (packageName) => {
    expect(() =>
      assertClientRuntimeBoundary({
        "app.js": chunk("app", ["geometry.js"]),
        "geometry.js": chunk("geometry", ["ocr.js"]),
        "ocr.js": chunk("ocr", [], [`/node_modules/${packageName}/index.js`]),
      }),
    ).toThrow(/app\.js -> geometry\.js -> ocr\.js/);
  },
);

it("keeps inference available outside the initial static import closure", () => {
  expect(() =>
    assertClientRuntimeBoundary({
      "app.js": chunk("app", ["geometry.js"]),
      "geometry.js": chunk(
        "geometry",
        [],
        ["/node_modules/clipper-lib/index.js"],
      ),
      "ocr.js": chunk(
        "ocr",
        [],
        ["/node_modules/@techstark/opencv-js/index.js"],
      ),
      "model.wasm": { type: "asset" },
    }),
  ).not.toThrow();
});

it("handles shared import cycles without skipping a forbidden dependency", () => {
  expect(() =>
    assertClientRuntimeBoundary({
      "app.js": chunk("app", ["shared.js"]),
      "shared.js": chunk("shared", ["app.js", "ocr.js"]),
      "ocr.js": chunk("ocr", [], ["/node_modules/onnxruntime-web/index.js"]),
    }),
  ).toThrow(/Offline inference leaked/);
});

it("fails visibly when the app entry is missing", () => {
  expect(() => assertClientRuntimeBoundary({})).toThrow(/app entry is missing/);
});

it.each([
  "@paddleocr/paddleocr-js",
  "@huggingface/transformers",
  "onnxruntime-web",
  "ink-on/core",
])("Android rejects %s even in an unrelated lazy chunk", (name) => {
  expect(() =>
    assertNativeInferenceBoundary({
      "app.js": chunk("app"),
      "unused-lazy.js": chunk(
        "unused-lazy",
        [],
        [`/node_modules/${name}/index.js`],
      ),
    }),
  ).toThrow(/Android contains web inference/);
});
it("Android permits native bridges, geometry and plotting without any web model runtime", () => {
  expect(() =>
    assertNativeInferenceBoundary({
      "app.js": chunk(
        "app",
        [],
        [
          "/app/fcboard/nativeInference.ts",
          "/node_modules/clipper-lib/index.js",
          "/node_modules/vega/index.js",
        ],
      ),
    }),
  ).not.toThrow();
});

it.each([
  "assets/ort-wasm-simd-threaded.wasm",
  "assets/localInference.worker-123.js",
  "model.onnx",
])("rejects orphan web inference asset %s in Android", (name) => {
  expect(() =>
    assertNativeInferenceBoundary({ [name]: { type: "asset" } }),
  ).toThrow(/web inference asset/);
});
