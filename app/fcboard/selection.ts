import type { FcboardElement } from "@fcboard/element/types";

export const selectionSignature = (elements: readonly FcboardElement[]) =>
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
  const available = Math.max(1, viewport.right - viewport.left - 24 * unit);
  const columns = Math.max(
    1,
    Math.min(items, Math.floor((available / unit - 8) / 44)),
  );
  const width = Math.min(available, (columns * 44 + 8) * unit);
  const height = Math.ceil(items / columns) * 42 * unit;
  const gap = 28 * unit;
  const margin = 12 * unit;
  const below = bounds.bottom + gap;
  const top =
    below + height <= viewport.bottom - margin
      ? below
      : bounds.top - height - gap;
  return {
    width,
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
