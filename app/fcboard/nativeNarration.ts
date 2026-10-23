import { registerPlugin } from "@capacitor/core";

/** Audio is synthesized on the Android worker; the existing narrator owns playback. */
export const OfflineTts = registerPlugin<{
  synthesize(options: { id: string; text: string }): Promise<{ path: string }>;
  cancel(options: { id: string }): Promise<void>;
}>("FcboardOfflineTts");

/** Bound per-request inference/memory and retain every character for caption offsets. */
export const narrationChunks = (text: string) => {
  const result: string[] = [];
  let rest = text;
  while (rest.length) {
    const prefix = Array.from(rest).slice(0, 80).join("");
    const boundary = Array.from(
      prefix.matchAll(/[。！？.!?，,；;\n]\s*|\s+/gu),
    ).at(-1);
    const length =
      rest.length > prefix.length && boundary && boundary.index! > 20
        ? boundary.index! + boundary[0].length
        : prefix.length;
    result.push(rest.slice(0, length));
    rest = rest.slice(length);
  }
  return result;
};
