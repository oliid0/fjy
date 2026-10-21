import type { ExcalidrawElement } from "@excalidraw/element/types";

export const selectionSignature = (elements: readonly ExcalidrawElement[]) =>
  elements
    .map((element) => `${element.id}:${element.version}`)
    .sort()
    .join(",");
