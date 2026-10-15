import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile(
    new URL("./courseware-fixtures.json", import.meta.url),
    "utf8",
  ),
);
const directory = new URL(
  "../node_modules/.fcdraw-research/courseware/",
  import.meta.url,
);
await mkdir(directory, { recursive: true });
for (const file of manifest) {
  const output = new URL(file.name, directory);
  const valid = (bytes) =>
    createHash("sha256").update(bytes).digest("hex") === file.sha256;
  try {
    if (valid(await readFile(output))) continue;
  } catch {
    /* Fetch below. */
  }
  const response = await fetch(file.url, {
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok)
    throw new Error(
      `Fixture download failed: ${file.name} (${response.status})`,
    );
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!valid(bytes)) throw new Error(`Fixture checksum mismatch: ${file.name}`);
  await writeFile(output, bytes);
  console.info(`Verified ${file.name}`);
}
