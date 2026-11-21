import { columnInkRows } from "./calculationInk";

import type { InkInput } from "./digitalInk";

/** The same rule that completes recognition also anchors its result. */
export const columnCalculation = (input: InkInput, text: string) => {
  const division = /^\s*\d+(?:\.\d+)?\s*[)⟌]\s*\d+(?:\.\d+)?\s*$/.test(text);
  if (division) {
    // Long division has an overbar above the dividend instead of a sum rule.
    const line = input.find((stroke) => {
      if (stroke.length < 2) {
        return false;
      }
      const xs = stroke.map(([x]) => x);
      const ys = stroke.map(([, y]) => y);
      const left = Math.min(...xs);
      const right = Math.max(...xs);
      const bottom = Math.max(...ys);
      const width = right - left;
      return (
        width >= 8 &&
        bottom - Math.min(...ys) <= Math.max(3, width * 0.14) &&
        input.some(
          (other) =>
            other !== stroke &&
            other.some(([x, y]) => x >= left && x <= right && y > bottom),
        )
      );
    });
    if (line) {
      return { mode: "column" as const, lines: 2 };
    }
  }
  const rows = columnInkRows(input);
  if (rows && /[+＋−－×÷*/xX-]|\\(?:times|div|cdot)/.test(text)) {
    return { mode: "column" as const, lines: rows.length };
  }
};
