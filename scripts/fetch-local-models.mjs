// Fetch and verify pinned assets only; no compilation or model conversion.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";

const root = new URL("../public/local-models/", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("./local-models.json", import.meta.url), "utf8"),
);
const valid = (bytes, file) =>
  bytes.length === file.size &&
  (file.sha256
    ? createHash("sha256").update(bytes).digest("hex") === file.sha256
    : createHash("sha1")
        .update(`blob ${bytes.length}\0`)
        .update(bytes)
        .digest("hex") === file.gitBlobSha1);
await mkdir(root, { recursive: true });
for (const file of manifest.files) {
  const output = new URL(file.name, root);
  await mkdir(dirname(fileURLToPath(output)), { recursive: true });
  try {
    if (valid(await readFile(output), file)) {
      continue;
    }
  } catch {
    /* first preparation */
  }
  let failure;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(file.url, {
        signal: AbortSignal.timeout(180000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!valid(bytes, file)) {
        throw new Error("checksum mismatch");
      }
      const pending = `${fileURLToPath(output)}.pending`;
      await writeFile(pending, bytes);
      await rename(pending, output);
      failure = undefined;
      console.info(`Verified ${file.name} (${bytes.length} bytes)`);
      break;
    } catch (error) {
      failure = error;
    }
  }
  if (failure) {
    throw new Error(`Local asset preparation failed: ${file.name}`, {
      cause: failure,
    });
  }
}
const require = createRequire(import.meta.url);
const transformerRequire = createRequire(
  require.resolve("@huggingface/transformers"),
);
for (const [kind, resolve] of [
  ["math", require.resolve],
  ["translation", transformerRequire.resolve],
]) {
  const distribution = dirname(resolve("onnxruntime-web"));
  const sdk = JSON.parse(
    await readFile(join(distribution, "../package.json"), "utf8"),
  );
  if (sdk.version !== manifest.runtimes[kind]) {
    throw new Error(`ORT version mismatch: ${kind}`);
  }
  const directory = new URL(`runtime/${kind}/`, root);
  await mkdir(directory, { recursive: true });
  for (const name of [
    "ort-wasm-simd-threaded.jsep.mjs",
    "ort-wasm-simd-threaded.jsep.wasm",
  ]) {
    await writeFile(
      new URL(name, directory),
      await readFile(join(distribution, name)),
    );
  }
}
await writeFile(
  new URL("LICENSES.txt", root),
  "CoMER / ink-on and OPUS-MT ONNX models: Apache-2.0.\nSources and immutable revisions are recorded in scripts/local-models.json.\n" +
    (await readFile(
      new URL("../node_modules/ink-on/LICENSE", import.meta.url),
      "utf8",
    )),
);
