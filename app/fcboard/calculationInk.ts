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
  const letters = bounds.slice(0, -1).filter((box) => height(box) > 4);
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
    if (row && box.top <= row.bottom + typical * 0.08) {
      row.bottom = Math.max(row.bottom, box.bottom);
    } else {
      rows.push({ bottom: box.bottom });
    }
  }
  if (
    rows.length >= 2 &&
    height(last) <= Math.max(3, width(last) * 0.14) &&
    width(last) >= Math.max(typical * 0.65, (right - left) * 0.7) &&
    last.left <= left + typical * 0.3 &&
    last.right >= right - typical * 0.3 &&
    last.top >= bottom - typical * 0.12
  ) {
    return {
      complete: true,
      strokes: input.filter((_, index) => index !== last.index),
    };
  }
  return { complete: false, strokes: input };
};

/** A completed bottom bar separates operand rows from a fraction or exponent. */
export const columnInkRows = (input: InkInput): InkInput[] | undefined => {
  const ending = calculationInk(input);
  if (!ending.complete || ending.strokes === input) {
    return;
  }
  const bounds = boxes(ending.strokes);
  const letters = bounds
    .filter((box) => height(box) > 4)
    .sort((a, b) => a.top - b.top);
  const typical =
    letters.map(height).sort((a, b) => a - b)[Math.floor(letters.length / 2)] ||
    0;
  const rows: { top: number; bottom: number; indices: number[] }[] = [];
  for (const box of letters) {
    const row = rows.at(-1);
    if (row && box.top <= row.bottom + typical * 0.08) {
      row.bottom = Math.max(row.bottom, box.bottom);
      row.indices.push(box.index);
    } else {
      rows.push({ top: box.top, bottom: box.bottom, indices: [box.index] });
    }
  }
  if (rows.length < 2 || rows.length > 12) {
    return;
  }
  for (const box of bounds.filter((box) => height(box) <= 4)) {
    const center = (box.top + box.bottom) / 2;
    const row = [...rows].sort(
      (a, b) =>
        Math.abs(center - (a.top + a.bottom) / 2) -
        Math.abs(center - (b.top + b.bottom) / 2),
    )[0];
    row.indices.push(box.index);
  }
  return rows.map((row) =>
    row.indices.sort((a, b) => a - b).map((index) => ending.strokes[index]),
  );
};

const divisionSigns = (bounds: ReturnType<typeof boxes>, typical: number) => {
  if (!typical) {
    return [];
  }
  const used = new Set<number>();
  return bounds.flatMap((bar) => {
    if (
      used.has(bar.index) ||
      width(bar) < 8 ||
      height(bar) > Math.max(3, width(bar) * 0.15)
    ) {
      return [];
    }
    const centerX = (bar.left + bar.right) / 2;
    const centerY = (bar.top + bar.bottom) / 2;
    const dots = bounds.filter(
      (dot) =>
        dot !== bar &&
        !used.has(dot.index) &&
        width(dot) <= Math.max(4, typical * 0.2) &&
        height(dot) <= Math.max(4, typical * 0.2) &&
        Math.abs((dot.left + dot.right) / 2 - centerX) <=
          Math.max(3, width(bar) * 0.25) &&
        Math.abs((dot.top + dot.bottom) / 2 - centerY) <= typical * 0.65 + 3,
    );
    const above = dots.filter((dot) => dot.bottom < bar.top - 1);
    const below = dots.filter((dot) => dot.top > bar.bottom + 1);
    if (above.length !== 1 || below.length !== 1) {
      return [];
    }
    const [top] = above;
    const [bottom] = below;
    const first = centerY - (top.top + top.bottom) / 2;
    const second = (bottom.top + bottom.bottom) / 2 - centerY;
    if (Math.min(first, second) < Math.max(first, second) * 0.45) {
      return [];
    }
    [bar, top, bottom].forEach((box) => used.add(box.index));
    return [{ bar, top, bottom }];
  });
};

/** Give OCR the equivalent slash only where both detached dots identify ÷. */
export const divisionSlashInk = (input: InkInput): InkInput | undefined => {
  const bounds = boxes(input);
  const heights = bounds
    .map(height)
    .filter((size) => size > 4)
    .sort((a, b) => a - b);
  const signs = divisionSigns(bounds, heights[Math.floor(heights.length / 2)]);
  if (!signs.length) {
    return;
  }
  const slashes = new Map<number, InkInput[number]>();
  const dots = new Set<number>();
  for (const { bar, top, bottom } of signs) {
    slashes.set(bar.index, [
      [bar.left, bottom.bottom],
      [bar.right, top.top],
    ]);
    dots.add(top.index);
    dots.add(bottom.index);
  }
  return input.flatMap((stroke, index) =>
    dots.has(index) ? [] : [slashes.get(index) || stroke],
  );
};

/** A clear inline operator permits reading each operand independently. */
export const divisionOperands = (
  input: InkInput,
): [InkInput, InkInput] | undefined => {
  const bounds = boxes(input);
  const sizes = bounds
    .map(height)
    .filter((size) => size > 4)
    .sort((a, b) => a - b);
  const signs = divisionSigns(bounds, sizes[Math.floor(sizes.length / 2)]);
  if (signs.length !== 1) {
    return;
  }
  const { bar, top, bottom } = signs[0];
  const sign = new Set([bar.index, top.index, bottom.index]);
  const left: InkInput = [];
  const right: InkInput = [];
  const center = (bar.left + bar.right) / 2;
  for (const box of bounds) {
    if (sign.has(box.index)) {
      continue;
    }
    if (box.right < center) {
      left.push(input[box.index]);
    } else if (box.left > center) {
      right.push(input[box.index]);
    } else {
      return;
    }
  }
  return left.length && right.length ? [left, right] : undefined;
};

/** Ordinary text recognizers must not flatten a fraction or a raised/lowered
 * operand into another valid but incorrect horizontal calculation. */
const mathStructure = (input: InkInput) => {
  const ending = calculationInk(input);
  const bounds = boxes(ending.strokes);
  const columnRows = columnInkRows(input);
  const rowByStroke = new Map(
    columnRows?.flatMap((row, index) =>
      row.map((stroke) => [stroke, index] as const),
    ),
  );
  const sizes = bounds
    .map(height)
    .filter((size) => size > 4)
    .sort((a, b) => a - b);
  const typical = sizes[Math.floor(sizes.length / 2)] || 0;
  const division = divisionSigns(bounds, typical).length > 0;
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
          (!columnRows ||
            rowByStroke.get(ending.strokes[base.index]) ===
              rowByStroke.get(ending.strokes[small.index])) &&
          height(small) <= height(base) * 0.6 &&
          small.left >= base.right - height(base) * 0.2 &&
          small.left <= base.right + height(base) * 0.6 &&
          ((small.bottom <= base.top + height(base) * 0.55 &&
            small.bottom >= base.top - height(base) * 0.65) ||
            (small.top >= base.bottom - height(base) * 0.2 &&
              small.top <= base.bottom + height(base) * 0.65)),
      ),
  );
  return { fraction, script, division };
};

export const hasStructuredMathInk = (input: InkInput) => {
  const { fraction, script, division } = mathStructure(input);
  const ending = calculationInk(input);
  return (
    fraction ||
    script ||
    division ||
    (ending.complete && ending.strokes !== input)
  );
};

export const preservesMathInkStructure = (input: InkInput, text: string) => {
  const { fraction, script, division } = mathStructure(input);
  return (
    (!fraction || /\\(?:d?frac|over)\b|\//.test(text)) &&
    (!division || /[÷/∕／]|\\(?:div|d?frac|over)(?![A-Za-z])/.test(text)) &&
    (!script || /[_^⁰¹²³⁴⁵⁶⁷⁸⁹₀-₉°]|\\sqrt\b/.test(text))
  );
};
