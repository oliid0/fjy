import type { InkInput } from "./digitalInk";

const boxes = (input: InkInput) =>
  input.flatMap((stroke, index) => {
    if (!stroke.length) {
      return [];
    }
    const box = {
      index,
      left: Infinity,
      right: -Infinity,
      top: Infinity,
      bottom: -Infinity,
    };
    for (const [x, y] of stroke) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return [];
      }
      box.left = Math.min(box.left, x);
      box.right = Math.max(box.right, x);
      box.top = Math.min(box.top, y);
      box.bottom = Math.max(box.bottom, y);
    }
    return [box];
  });
const height = (box: { top: number; bottom: number }) => box.bottom - box.top;
const width = (box: { left: number; right: number }) => box.right - box.left;

/** Geometry identifies an ending, never the operands or arithmetic operation. */
export const calculationInk = (input: InkInput) => {
  const bounds = boxes(input);
  const letters = bounds.filter((box) => height(box) > 4);
  const typical =
    letters.map(height).sort((a, b) => a - b)[Math.floor(letters.length / 2)] ||
    0;
  const horizontal = (box: typeof bounds[number]) =>
    height(box) <= Math.max(3, typical * 0.15) && width(box) >= typical * 0.35;
  const last = bounds.at(-1);
  const previous = bounds.at(-2);
  if (!last || !typical) {
    return { complete: false, strokes: input };
  }
  const right = Math.max(...letters.map((box) => box.right));
  if (
    previous &&
    horizontal(last) &&
    horizontal(previous) &&
    letters.length &&
    last.left >= right - typical * 0.2 &&
    previous.left >= right - typical * 0.2 &&
    Math.min(last.right, previous.right) - Math.max(last.left, previous.left) >=
      Math.max(width(last), width(previous)) * 0.65 &&
    Math.abs(last.top - previous.top) >= Math.max(2, typical * 0.08) &&
    Math.abs(last.top - previous.top) <= typical * 0.45
  ) {
    return { complete: true, strokes: input };
  }
  const left = Math.min(...letters.map((box) => box.left));
  const bottom = Math.max(...letters.map((box) => box.bottom));
  const rows: { bottom: number }[] = [];
  for (const box of [...letters].sort((a, b) => a.top - b.top)) {
    const row = rows.at(-1);
    if (row && box.top <= row.bottom + typical * 0.2) {
      row.bottom = Math.max(row.bottom, box.bottom);
    } else {
      rows.push({ bottom: box.bottom });
    }
  }
  if (
    rows.length >= 2 &&
    horizontal(last) &&
    width(last) >= Math.max(typical * 1.5, (right - left) * 0.7) &&
    last.left <= left + typical * 0.3 &&
    last.right >= right - typical * 0.3 &&
    last.top >= bottom + typical * 0.05
  ) {
    return {
      complete: true,
      strokes: input.filter((_, index) => index !== last.index),
    };
  }
  return { complete: false, strokes: input };
};

/** Ordinary text recognizers must not flatten a fraction or a raised/lowered
 * operand into another valid but incorrect horizontal calculation. */
const mathStructure = (input: InkInput) => {
  const bounds = boxes(calculationInk(input).strokes);
  const fraction = bounds.some((bar) => {
    if (width(bar) < 12 || height(bar) > Math.max(3, width(bar) * 0.05)) {
      return false;
    }
    const overlapping = bounds.filter(
      (box) =>
        box !== bar &&
        height(box) > 4 &&
        Math.min(box.right, bar.right) - Math.max(box.left, bar.left) >=
          Math.min(width(box), width(bar)) * 0.3,
    );
    return (
      overlapping.some((box) => box.bottom < bar.top) &&
      overlapping.some((box) => box.top > bar.bottom)
    );
  });
  const script = bounds.some(
    (small) =>
      height(small) > 4 &&
      bounds.some(
        (base) =>
          base !== small &&
          height(small) <= height(base) * 0.6 &&
          small.left >= base.right - height(base) * 0.2 &&
          small.left <= base.right + height(base) * 0.6 &&
          ((small.bottom <= base.top + height(base) * 0.55 &&
            small.bottom >= base.top - height(base) * 0.65) ||
            (small.top >= base.bottom - height(base) * 0.2 &&
              small.top <= base.bottom + height(base) * 0.65)),
      ),
  );
  return { fraction, script };
};

export const hasStructuredMathInk = (input: InkInput) => {
  const { fraction, script } = mathStructure(input);
  return fraction || script;
};

export const preservesMathInkStructure = (input: InkInput, text: string) => {
  const { fraction, script } = mathStructure(input);
  return (
    (!fraction || /\\(?:d?frac|over)\b|\//.test(text)) &&
    (!script || /[_^⁰¹²³⁴⁵⁶⁷⁸⁹₀-₉°]|\\sqrt\b/.test(text))
  );
};
