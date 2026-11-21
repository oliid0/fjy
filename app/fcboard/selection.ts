import type { FcboardElement } from "@fcboard/element/types";
import type { RegionBounds } from "@fcboard/fcboard/lasso/region";

export const selectionSignature = (elements: readonly FcboardElement[]) =>
  elements
    .map((element) => `${element.id}:${element.version}`)
    .sort()
    .join(",");

/** Semantic crop follows the actual circle, independently of object operation handles. */
export const selectionPathBounds = (
  path: readonly (readonly [number, number, ...number[]])[] | undefined,
): RegionBounds | undefined => {
  if (!path?.length) {
    return;
  }
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const [x, y] of path) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  return right > left && bottom > top
    ? { left, top, right, bottom }
    : undefined;
};

/** layout_select_shape_submenu:50dp cells,6dp margins,12dp right/vertical padding. */
export const selectionToolbarPosition = (
  bounds: { left: number; right: number; top: number; bottom: number },
  viewport: { left: number; right: number; top: number; bottom: number },
  unit = 0.67,
  items = 4,
) => {
  const available = Math.max(1, viewport.right - viewport.left - 24 * unit);
  const columns = Math.max(
    1,
    Math.min(items, Math.floor((available / unit - 12) / 56)),
  );
  const width = Math.min(available, (columns * 56 + 12) * unit);
  const height = (Math.ceil(items / columns) * 50 + 12) * unit;
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
