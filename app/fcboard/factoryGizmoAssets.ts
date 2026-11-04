import type { DataURL } from "@fcboard/fcboard/types";
import type { FileId } from "@fcboard/element/types";

import assets from "./factory-gizmo-icons/protractor.json";

/** Byte-for-byte APK drawables, keyed by their actual SHA-256 file IDs. */
export const factoryProtractorFiles = (color: string) =>
  [
    color.toLowerCase() === "#ffffff" ? assets.white : assets.gray,
    assets.ball,
  ].map((file) => ({
    id: file.id as FileId,
    dataURL: file.dataURL as DataURL,
    mimeType: "image/png" as const,
    created: 0,
  }));
