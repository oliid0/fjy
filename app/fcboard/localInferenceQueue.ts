let tail: Promise<void> = Promise.resolve();
let resident: { key: string; release: () => void } | undefined;

/** OCR, math and translation share the WebView's address space. Finish the
 * current caller before releasing its model and starting another WASM heap. */
export const queueLocalInference = (
  key: string,
  release: () => void,
  run: () => Promise<void>,
  current: () => boolean = () => true,
) => {
  tail = tail
    .catch(() => {})
    .then(async () => {
      if (!current()) {
        return;
      }
      if (resident?.key !== key) {
        resident?.release();
        resident = { key, release };
      }
      await run();
    });
  return tail;
};
