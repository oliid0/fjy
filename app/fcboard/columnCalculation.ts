import type { InkInput } from "./digitalInk";

/** A calculation bar spans two explicit operand rows; a minus or equals alone does not. */
export const columnCalculation = (input: InkInput, text: string) => {
  if (!/[+\-×*÷/]/.test(text)) {
    return;
  }
  const boxes = input
    .filter((stroke) => stroke.length)
    .map((stroke) =>
      stroke.reduce(
        (box, [x, y]) => ({
          left: Math.min(box.left, x),
          top: Math.min(box.top, y),
          right: Math.max(box.right, x),
          bottom: Math.max(box.bottom, y),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
      ),
    );
  const letters = boxes.filter((box) => box.bottom - box.top > 4);
  if (letters.length < 2) {
    return;
  }
  const height = letters
    .map((box) => box.bottom - box.top)
    .sort((a, b) => a - b)[Math.floor(letters.length / 2)];
  const left = Math.min(...letters.map((box) => box.left));
  const right = Math.max(...letters.map((box) => box.right));
  const bottom = Math.max(...letters.map((box) => box.bottom));
  const bar = boxes.find(
    (box) =>
      box.bottom - box.top <= Math.max(3, height * 0.15) &&
      box.right - box.left >= Math.max(height * 1.5, (right - left) * 0.7) &&
      box.top >= bottom - height * 0.15,
  );
  if (!bar) {
    return;
  }
  const rows: { top: number; bottom: number }[] = [];
  for (const box of letters.sort((a, b) => a.top - b.top)) {
    const row = rows.at(-1);
    if (row && box.top <= row.bottom + height * 0.2) {
      row.bottom = Math.max(row.bottom, box.bottom);
    } else {
      rows.push({ top: box.top, bottom: box.bottom });
    }
  }
  return rows.length >= 2
    ? { mode: "column" as const, lines: rows.length }
    : undefined;
};
