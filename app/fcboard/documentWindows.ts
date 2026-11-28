import { createStore, get, set } from "idb-keyval";
import { Emitter } from "@fcboard/common/emitter";
import { documentResourceId } from "@fcboard/fcboard/interactiveHtml";

import { classroomCommands } from "./commands";

import type { OfficeSheet } from "./officeSheets";
import type { DocumentInput } from "./documentInput";

const sources = createStore("fcboard-document-sources", "sources");
const drafts = createStore("fcboard-office-drafts", "drafts");
export const officeDraft = (fingerprint: string) =>
  get<{ word: Map<number, Blob>; sheets: Map<number, OfficeSheet> }>(
    fingerprint,
    drafts,
  );
export const persistOfficeDraft = (
  fingerprint: string,
  word: Map<number, Blob>,
  sheets: Map<number, OfficeSheet>,
) => set(fingerprint, { word, sheets }, drafts);
const focus = new Emitter();
let activeDocument: string | undefined;
const opening = new Map<
  string,
  { file: DocumentInput; settle: (error?: unknown) => void }
>();

export const documentSource = (key: string) =>
  Promise.resolve(opening.get(key)?.file ?? get<DocumentInput>(key, sources));
export const focusedDocument = () => activeDocument;
export const watchDocumentFocus = (listener: () => void) => focus.on(listener);
export const focusDocument = (id?: string) => {
  if (id !== activeDocument) {
    activeDocument = id;
    focus.trigger();
  }
};
export const documentWindowReady = (key: string, error?: string) =>
  opening.get(key)?.settle(error ? new Error(error) : undefined);

export const openDocumentWindow = async (
  file: DocumentInput,
  signal?: AbortSignal,
) => {
  signal?.throwIfAborted();
  const key = crypto.randomUUID();
  await set(key, file, sources);
  signal?.throwIfAborted();
  const ready = new Promise<void>((resolve, reject) => {
    opening.set(key, {
      file,
      settle: (error) => (error ? reject(error) : resolve()),
    });
  });
  void ready.catch(() => {});
  const abort = () => opening.get(key)?.settle(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const { ids } = (await classroomCommands.execute({
      name: "canvas.resource",
      args: {
        signal,
        resource: {
          id: documentResourceId,
          title: file.name.slice(0, 160),
          document: { key },
        },
      },
    })) as { ids: string[] };
    focusDocument(ids[0]);
    await ready;
    signal?.throwIfAborted();
    return { ids };
  } finally {
    opening.delete(key);
    signal?.removeEventListener("abort", abort);
  }
};
