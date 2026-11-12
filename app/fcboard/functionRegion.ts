import type { Plot } from "./math";
import type { ContentRect } from "./placement";

/** Function pen expressions in one writing area share axes without a lasso. */
export const functionRegionMatch = (
  regions: readonly ContentRect[],
  next: ContentRect,
) =>
  regions.some((box) => {
    const height = Math.max(
      12,
      Math.min(box.bottom - box.top, next.bottom - next.top),
    );
    const dx = Math.max(0, box.left - next.right, next.left - box.right);
    const dy = Math.max(0, box.top - next.bottom, next.top - box.bottom);
    return dx <= Math.max(60, height * 3) && dy <= Math.max(48, height * 2);
  });

export const compareFunctionRegion = (existing: Plot, next: Plot) => {
  if (
    existing.surface ||
    next.surface ||
    existing.relation ||
    next.relation ||
    ["a", "b", "c"].some((key) => existing[key as "a"] !== next[key as "a"])
  ) {
    return;
  }
  const expressions = [
    ...new Set([
      existing.expression,
      ...(existing.compare || []),
      next.expression,
      ...(next.compare || []),
    ]),
  ];
  if (expressions.length > 4) {
    return;
  }
  return { ...existing, compare: expressions.slice(1) };
};
