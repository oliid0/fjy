/** Stable final transcript segments form ordered commands while capture stays open. */
export const createVoiceTurns = (
  execute: (text: string, signal: AbortSignal) => Promise<void>,
  onError: (failure: unknown) => void,
  delay = 3000,
) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fragments: string[] = [];
  let stopped = false;
  let queued = Promise.resolve();
  const requests = new Set<AbortController>();
  const reset = () => {
    clearTimeout(timer);
    fragments = [];
    requests.forEach((request) => request.abort());
    requests.clear();
    queued = Promise.resolve();
  };
  const flush = () => {
    clearTimeout(timer);
    const text = fragments.join(" ").trim();
    fragments = [];
    if (stopped || !text) {
      return;
    }
    const request = new AbortController();
    requests.add(request);
    queued = queued
      .then(async () => {
        if (!request.signal.aborted) {
          await execute(text, request.signal);
        }
      })
      .catch((failure) => {
        if (!request.signal.aborted) {
          onError(failure);
        }
      })
      .finally(() => requests.delete(request));
  };
  return {
    push(text: string) {
      if (stopped || !text.trim()) {
        return;
      }
      fragments.push(text.trim());
      clearTimeout(timer);
      timer = setTimeout(flush, delay);
    },
    reset,
    stop() {
      stopped = true;
      reset();
    },
  };
};
export type VoiceTurns = ReturnType<typeof createVoiceTurns>;
