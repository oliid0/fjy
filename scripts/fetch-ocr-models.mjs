// Asset preparation only. Keep the worker's embedded ORT 1.24.3 and WASM in sync.
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../public/ocr/", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("./ocr-models.json", import.meta.url), "utf8"),
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
await mkdir(root, { recursive: true });
await writeFile(
  new URL("LICENSES.txt", root),
  await readFile(new URL("./ocr-LICENSES.txt", import.meta.url)),
);
let worker;
try {
  worker = await readFile(
    new URL(
      "../node_modules/@paddleocr/paddleocr-js/dist/assets/worker-entry-C9UNuyOJ.js",
      import.meta.url,
    ),
  );
} catch {
  worker = await readFile(
    new URL(
      "../app/node_modules/@paddleocr/paddleocr-js/dist/assets/worker-entry-C9UNuyOJ.js",
      import.meta.url,
    ),
  );
}
if (hash(worker) !== manifest.workerSha256)
  throw new Error("PaddleOCR worker version mismatch");
await writeFile(new URL("worker.js", root), worker);
for (const file of manifest.files) {
  const directory = new URL(
    file.name.endsWith(".tar") || !file.name.startsWith("ort-")
      ? "models/"
      : "ort/",
    root,
  );
  await mkdir(directory, { recursive: true });
  const output = new URL(
    file.name.startsWith("ort-") ? file.name : `${file.name}.tar`,
    directory,
  );
  try {
    const previous = await readFile(output);
    if (previous.length === file.size && hash(previous) === file.sha256)
      continue;
  } catch {
    /* First preparation. */
  }
  const response = await fetch(file.url, {
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok)
    throw new Error(
      `OCR asset download failed: ${file.name} (${response.status})`,
    );
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== file.size || hash(bytes) !== file.sha256)
    throw new Error(`OCR asset checksum mismatch: ${file.name}`);
  const pending = `${fileURLToPath(output)}.pending`;
  await writeFile(pending, bytes);
  await rename(pending, output);
  console.info(`Verified OCR asset ${file.name} (${bytes.length} bytes)`);
}
