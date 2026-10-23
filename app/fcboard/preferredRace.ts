/** Start independent backends together. Prefer the primary for a brief head start,
 * then use the first validated result; cancel the loser and ignore late callbacks. */
export const preferredRace = <T>(
  primary: (signal: AbortSignal) => Promise<T>,
  fallback: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  headStart = 250,
): Promise<T> => {
  signal.throwIfAborted();
  const cloud = new AbortController();
  const local = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let done = false;
    let primaryFailed = false;
    let fallbackFailed = false;
    let fallbackValue: { value: T } | undefined;
    let allowed = false;
    const finish = (result: { value: T } | { error: unknown }) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      cloud.abort();
      local.abort();
      if ("value" in result) {
        resolve(result.value);
      } else {
        reject(result.error);
      }
    };
    const abort = () => finish({ error: signal.reason });
    const timer = setTimeout(() => {
      allowed = true;
      if (fallbackValue) {
        finish(fallbackValue);
      }
    }, headStart);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve()
      .then(() => primary(cloud.signal))
      .then(
        (value) => finish({ value }),
        (error) => {
          primaryFailed = true;
          if (fallbackValue) {
            finish(fallbackValue);
          } else if (fallbackFailed) {
            finish({ error });
          }
        },
      );
    Promise.resolve()
      .then(() => fallback(local.signal))
      .then(
        (value) => {
          fallbackValue = { value };
          if (allowed || primaryFailed) {
            finish(fallbackValue);
          }
        },
        (error) => {
          fallbackFailed = true;
          if (primaryFailed) {
            finish({ error });
          }
        },
      );
  });
};
