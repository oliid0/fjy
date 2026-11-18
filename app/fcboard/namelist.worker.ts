import { parseNamelistFile } from "./namelistData";

self.onmessage = (
  event: MessageEvent<{ bytes: ArrayBuffer; name: string }>,
) => {
  try {
    self.postMessage({
      tables: parseNamelistFile(
        new Uint8Array(event.data.bytes),
        event.data.name,
      ),
    });
  } catch (failure) {
    self.postMessage({
      error: failure instanceof Error ? failure.message : "namelist_invalid",
    });
  }
};
