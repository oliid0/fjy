type Point = [number, number];
export type CurveView = {
  left: number;
  right: number;
  bottom: number;
  top: number;
  tolerance?: number;
};

/** Interval-guided, viewport-aware subdivision, with separate
 * compile, sample and render stages. Unresolved poles remain gaps. A hard work
 * budget bounds CPU and output size on small ARM boards. */
export const sampleCurve = (
  value: (x: number) => number,
  range: (left: number, right: number) => [number, number] | undefined,
  view: CurveView,
): number[][][] => {
  if (
    ![view.left, view.right, view.bottom, view.top].every(Number.isFinite) ||
    view.right <= view.left ||
    view.top <= view.bottom
  ) {
    throw new Error("Invalid plot viewport");
  }
  const tolerance = view.tolerance || (view.top - view.bottom) / 800;
  const lines: number[][][] = [];
  let line: number[][] = [];
  let work = 0;
  const flush = () => {
    if (line.length > 1) {
      lines.push(line);
    }
    line = [];
  };
  const segment = (a: Point, b: Point) => {
    const dy = b[1] - a[1];
    let start = 0;
    let end = 1;
    if (dy) {
      const first = (view.bottom - a[1]) / dy;
      const second = (view.top - a[1]) / dy;
      start = Math.max(0, Math.min(first, second));
      end = Math.min(1, Math.max(first, second));
    } else if (a[1] < view.bottom || a[1] > view.top) {
      flush();
      return;
    }
    if (start > end) {
      flush();
      return;
    }
    const point = (t: number) => [
      a[0] + (b[0] - a[0]) * t,
      Math.max(view.bottom, Math.min(view.top, a[1] + dy * t)),
    ];
    const first = point(start);
    const last = point(end);
    const previous = line[line.length - 1];
    if (
      !previous ||
      Math.abs(previous[0] - first[0]) > 1e-10 ||
      Math.abs(previous[1] - first[1]) > tolerance / 100
    ) {
      flush();
      line.push(first);
    }
    line.push(last);
    if (end < 1) {
      flush();
    }
  };
  const visit = (a: Point, b: Point, depth: number) => {
    if (++work > 4096) {
      flush();
      return;
    }
    const bounds = range(a[0], b[0]);
    if (bounds && (bounds[1] < view.bottom || bounds[0] > view.top)) {
      flush();
      return;
    }
    const x = (a[0] + b[0]) / 2;
    const middle: Point = [x, value(x)];
    const finite = [a[1], middle[1], b[1]].every(Number.isFinite);
    const flat = finite && Math.abs(middle[1] - (a[1] + b[1]) / 2) <= tolerance;
    const tight =
      bounds &&
      bounds[1] - Math.max(a[1], middle[1], b[1]) <= tolerance &&
      Math.min(a[1], middle[1], b[1]) - bounds[0] <= tolerance;
    if (bounds && flat && tight) {
      segment(a, b);
      return;
    }
    if (
      depth >= 10 ||
      (depth >= 3 && ![a[1], middle[1], b[1]].some(Number.isFinite))
    ) {
      flush();
      return;
    }
    visit(a, middle, depth + 1);
    visit(middle, b, depth + 1);
  };
  let a: Point = [view.left, value(view.left)];
  for (let index = 1; index <= 80; index++) {
    const x = view.left + ((view.right - view.left) * index) / 80;
    const b: Point = [x, value(x)];
    visit(a, b, 0);
    a = b;
  }
  flush();
  return lines;
};
