import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// SHA256 is the digest published on Genymobile's v3.3.1 GitHub release asset.
const digest =
  "a0f70b20aa4998fbf658c94118cd6c8dab6abbb0647a3bdab344d70bc1ebcbb8";
const target = "android/app/build/generated/scrcpy/scrcpy/server-3.3.1.jar";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
let bytes;
try {
  bytes = await readFile(target);
} catch {
  /* First package. */
}
if (!bytes || hash(bytes) !== digest) {
  const response = await fetch(
    "https://github.com/Genymobile/scrcpy/releases/download/v3.3.1/scrcpy-server-v3.3.1",
  );
  if (!response.ok) {
    throw new Error(`Scrcpy download failed: ${response.status}`);
  }
  bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== digest) {
    throw new Error("Scrcpy server SHA256 mismatch");
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}
process.stdout.write(`Verified Scrcpy 3.3.1 server: ${bytes.length} bytes\n`);
