import type { InkInput } from "./digitalInk";

/** Failed ink on an earlier row must not poison the next independent function. */
export const latestFunctionInk = (input: InkInput) => {
  const bounds = input.map((points) =>
    points.reduce(
      (box, [x, y]) => ({
        left: Math.min(box.left, x),
        right: Math.max(box.right, x),
        top: Math.min(box.top, y),
        bottom: Math.max(box.bottom, y),
      }),
      { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity },
    ),
  );
  const latest = bounds.at(-1);
  if (!latest) {
    return new Set<number>();
  }
  let top = latest.top;
  let bottom = latest.bottom;
  let left = latest.left;
  let right = latest.right;
  const included = new Set<number>([bounds.length - 1]);
  // Connected vertical extents include superscripts and tall parentheses.
  for (let pass = 0; pass < bounds.length; pass++) {
    let changed = false;
    for (let index = 0; index < bounds.length; index++) {
      const box = bounds[index];
      if (included.has(index)) {
        continue;
      }
      const gap = Math.max(
        8,
        Math.max(bottom - top, box.bottom - box.top) * 0.35,
      );
      const horizontalGap = Math.max(60, gap * 6);
      if (
        box.top <= bottom + gap &&
        box.bottom >= top - gap &&
        box.left <= right + horizontalGap &&
        box.right >= left - horizontalGap
      ) {
        included.add(index);
        top = Math.min(top, box.top);
        bottom = Math.max(bottom, box.bottom);
        left = Math.min(left, box.left);
        right = Math.max(right, box.right);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  return included;
};
