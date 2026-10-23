import { Odr } from "@opendocument/odr-core";
import wasmUrl from "@opendocument/odr-core/odr-core.wasm?url";

import type { Document as OfficeDocument } from "@opendocument/odr-core";

let engine: Promise<Odr> | undefined;
let document: OfficeDocument | undefined;
self.onmessage = async (event: MessageEvent) => {
  const { id, type, bytes, name, page, password } = event.data;
  try {
    if (type === "open") {
      document?.close();
      engine ||= Odr.load({ locateFile: () => wasmUrl });
      document = (await engine).open(new Uint8Array(bytes), {
        name,
        allowExternalContent: false,
        editable: false,
        viewportWidth: 1000,
        keyboardNavigation: false,
        keyboardShortcuts: false,
      });
      if (document.isPasswordEncrypted()) {
        if (!password) {
          throw new Error("文件已加密，请使用未加密的课件");
        }
        document.decrypt(password);
      }
      self.postMessage({ id, value: document.listViews() });
    } else if (type === "render") {
      if (!document) {
        throw new Error("课件尚未打开");
      }
      self.postMessage({ id, value: document.render(page).html });
    } else if (type === "close") {
      document?.close();
      document = undefined;
      self.postMessage({ id, value: null });
    }
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
