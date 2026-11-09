import { preprocessStrokes } from "./mathInkPreprocessing";

import { offlineInference } from "./offlineInference";

import type { InkInput } from "./digitalInk";

/** CoMER sees the real stroke layout, including fractions and superscripts.
 * Normalize before rasterization so distant scene coordinates cannot allocate
 * a giant temporary canvas or make resampling loop over millions of pixels. */
export const recognizeLocalMath = async (
  ink: InkInput,
  signal: AbortSignal,
) => {
  signal.throwIfAborted();
  const points = ink.flat();
  if (
    !points.length ||
    points.length > 12000 ||
    points.some((point) => !point.every(Number.isFinite))
  ) {
    throw new Error("Invalid math ink");
  }
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const [x, y] of points) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  const scale = 480 / Math.max(1, right - left, bottom - top);
  signal.throwIfAborted();
  const input = preprocessStrokes(
    ink.map((stroke) => ({
      lineWidth: 3,
      points: stroke.map(([x, y]) => ({
        x: (x - left) * scale + 8,
        y: (y - top) * scale + 8,
      })),
    })),
  );
  const result = await offlineInference({ kind: "math", ...input }, signal);
  if (
    !result ||
    typeof result !== "object" ||
    !("latex" in result) ||
    typeof result.latex !== "string" ||
    !result.latex.trim() ||
    result.latex.length > 1000
  ) {
    throw new Error("Unreadable math ink");
  }
  // CoMER emits space-separated LaTeX tokens, including individual digits.
  // Compact only model tokens; ordinary OCR keeps its ambiguity checks.
  return result.latex
    .replace(/(\d)\s+(?=[\d.])/g, "$1")
    .replace(/(\.)\s+(?=\d)/g, "$1")
    .replace(/\s*([{}_^])\s*/g, "$1")
    .replace(/\\(frac|sqrt)\s+(?=[{[])/g, "\\$1")
    .replace(/\\(?:mathrm|operatorname)\{([a-z]+)\}/gi, "$1");
};
