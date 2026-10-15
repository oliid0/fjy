// Download pinned, verified model assets for the APK; no compilation happens here.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const crc32c = (bytes) => {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      value = (value >>> 1) ^ (value & 1 ? 0x82f63b78 : 0);
    }
  }
  const result = Buffer.alloc(4);
  result.writeUInt32BE((value ^ 0xffffffff) >>> 0);
  return result.toString("base64");
};

export const verifyModel = (bytes, file) =>
  bytes.length === file.size && crc32c(bytes) === file.crc32c;

export const fetchSpeechModels = async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const manifest = JSON.parse(
    await readFile(new URL("./speech-models.json", import.meta.url), "utf8"),
  );
  const target = path.join(root, "android/app/src/main/assets/speech/zh");
  await mkdir(target, { recursive: true });
  for (const file of manifest.files) {
    const output = path.join(target, file.name);
    try {
      if (verifyModel(await readFile(output), file)) {
        continue;
      }
    } catch {
      /* Not downloaded yet. */
    }
    const response = await fetch(new URL(file.name, manifest.baseUrl), {
      signal: AbortSignal.timeout(180000),
    });
    if (!response.ok) {
      throw new Error(
        `Model download failed: ${file.name} (${response.status})`,
      );
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!verifyModel(bytes, file)) {
      throw new Error(`Model checksum mismatch: ${file.name}`);
    }
    await writeFile(`${output}.pending`, bytes);
    await rename(`${output}.pending`, output);
    console.info(`Verified ${file.name} (${bytes.length} bytes)`);
  }
};

if (
  import.meta.url.startsWith("file:") &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await fetchSpeechModels();
}
