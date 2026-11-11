let dictionary: Promise<Record<string, string> | undefined> | undefined;

/** Browser data lookup only. Android routes to the isolated native dictionary. */
export const lookupLocalWord = async (text: string, signal: AbortSignal) => {
  signal.throwIfAborted();
  const key = text.trim().toLowerCase();
  if (/^[\p{P}\p{N}\s]+$/u.test(key)) {
    return text;
  }
  if (!/^[a-z][a-z '-]{0,99}$/.test(key)) {
    return;
  }
  dictionary ||= (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(
        new URL(
          `${import.meta.env.BASE_URL}dictionary/en-zh.json`,
          location.href,
        ),
        { signal: controller.signal },
      );
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      if (
        data?.version !== 1 ||
        !data.entries ||
        typeof data.entries !== "object" ||
        Array.isArray(data.entries)
      ) {
        return;
      }
      return data.entries as Record<string, string>;
    } catch {
      return;
    } finally {
      clearTimeout(timer);
    }
  })();
  const entries = await new Promise<Record<string, string> | undefined>(
    (resolve, reject) => {
      const abort = () =>
        reject(
          signal.reason ||
            new DOMException("Dictionary lookup cancelled", "AbortError"),
        );
      signal.addEventListener("abort", abort, { once: true });
      void dictionary!
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", abort));
    },
  );
  signal.throwIfAborted();
  if (
    entries &&
    Object.prototype.hasOwnProperty.call(entries, key) &&
    typeof entries[key] === "string" &&
    entries[key].length <= 40
  ) {
    return entries[key];
  }
};
