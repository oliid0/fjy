import type { ExcalidrawElement } from "@excalidraw/element/types";

export const selectionSignature = (elements: readonly ExcalidrawElement[]) =>
  elements
    .map((element) => `${element.id}:${element.version}`)
    .sort()
    .join(",");

/** SelectCacheLayer: 44px cells, 42px panel, 28px gap; flip above before clamping. */
export const selectionToolbarPosition = (
  bounds: { left: number; right: number; top: number; bottom: number },
  viewport: { left: number; right: number; top: number; bottom: number },
  unit = 1,
  items = 4,
) => {
  const width = (items * 44 + 8) * unit;
  const height = 42 * unit;
  const gap = 28 * unit;
  const margin = 12 * unit;
  const below = bounds.bottom + gap;
  const top =
    below + height <= viewport.bottom - margin
      ? below
      : bounds.top - height - gap;
  return {
    left: Math.max(
      viewport.left + margin,
      Math.min(
        viewport.right - width - margin,
        (bounds.left + bounds.right - width) / 2,
      ),
    ),
    top: Math.max(
      viewport.top + margin,
      Math.min(viewport.bottom - height - margin, top),
    ),
  };
};
