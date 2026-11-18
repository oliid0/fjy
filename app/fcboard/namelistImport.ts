import { t } from "@fcboard/fcboard/i18n";

import { namelistFileLimit } from "./namelist";

import type { NamelistTable } from "./namelistData";

/** Same terminable per-request worker lifecycle used by symbolic calculation. */
export const importNamelist = async (
  file: File,
  signal: AbortSignal,
): Promise<NamelistTable[]> => {
  signal.throwIfAborted();
  if (!file.size || file.size > namelistFileLimit) {
    throw new Error(t("fcboard.namelistImport.invalid"));
  }
  const bytes = await file.arrayBuffer();
  signal.throwIfAborted();
  if (typeof Worker === "undefined") {
    throw new Error(t("fcboard.namelistImport.invalid"));
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./namelist.worker.ts", import.meta.url),
      { type: "module" },
    );
    let finished = false;
    const finish = (tables?: NamelistTable[], failure?: unknown) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.terminate();
      if (failure) {
        reject(failure);
      } else if (tables?.length) {
        resolve(tables);
      } else {
        reject(new Error(t("fcboard.namelistImport.invalid")));
      }
    };
    const abort = () =>
      finish(
        undefined,
        signal.reason || new DOMException("Aborted", "AbortError"),
      );
    const timer = setTimeout(() => finish(), 10000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (
      event: MessageEvent<{ tables?: NamelistTable[]; error?: string }>,
    ) => {
      if (signal.aborted) {
        abort();
        return;
      }
      if (event.data.error) {
        finish(
          undefined,
          new Error(
            t(
              event.data.error === "namelist_format"
                ? "fcboard.namelistImport.format"
                : "fcboard.namelistImport.invalid",
            ),
          ),
        );
      } else {
        finish(event.data.tables);
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish();
    };
    worker.onmessageerror = () => finish();
    try {
      worker.postMessage({ bytes, name: file.name }, [bytes]);
    } catch (failure) {
      finish(undefined, failure);
    }
  });
};
