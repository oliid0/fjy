// Asset preparation only: verify pinned bytes, then place models outside WebView.
import { createHash } from "node:crypto";
import { readFile, mkdir, copyFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const source = new URL("../public/local-models/", import.meta.url);
const target = new URL(
  "../android/app/src/main/assets/inference/",
  import.meta.url,
);
const manifest = JSON.parse(
  await readFile(new URL("./local-models.json", import.meta.url), "utf8"),
);
for (const file of manifest.files) {
  const input = new URL(file.name, source);
  const bytes = await readFile(input);
  const actual = file.sha256
    ? createHash("sha256").update(bytes).digest("hex")
    : createHash("sha1")
        .update(`blob ${bytes.length}\0`)
        .update(bytes)
        .digest("hex");
  if (
    bytes.length !== file.size ||
    actual !== (file.sha256 || file.gitBlobSha1)
  ) {
    throw new Error(`Native inference asset checksum mismatch: ${file.name}`);
  }
  const output = new URL(file.name, target);
  await mkdir(dirname(fileURLToPath(output)), { recursive: true });
  await copyFile(input, output);
}
await copyFile(
  new URL("LICENSES.txt", source),
  new URL("LICENSES.txt", target),
);
await writeFile(new URL("manifest.json", target), JSON.stringify(manifest));
console.info("Verified native OPUS/CoMER assets; no PaddleOCR or WASM copied");
