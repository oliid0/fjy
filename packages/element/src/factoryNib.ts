import type { ExcalidrawFreeDrawElement } from "./types";

type Point = readonly [number, number];

// RectUtil.calcFrontPoint / calcControlPoint: preserve the factory's choice of
// the intersection on the directed line, including the stationary-lift case.
const onLine = (
  a: Point,
  b: Point,
  distance: number,
  stationary: boolean,
  control = false,
): [number, number] => {
  const slope = (a[1] - b[1]) / (a[0] - b[0]);
  const intercept = b[1] - slope * b[0];
  const delta = Math.sqrt((distance * distance) / (slope * slope + 1));
  const origin = stationary ? b[0] : a[0];
  let x = origin - delta;
  const opposite = control
    ? (x <= b[0] || x >= a[0]) && (x >= b[0] || x <= a[0])
    : (x <= b[0] || b[0] <= a[0]) && (x >= b[0] || b[0] >= a[0]);
  if (opposite) {
    x = origin + delta;
  }
  return [x, slope * x + intercept];
};

/** HCurveObject.addNib and RectUtil.combineIntersection's two filled quadratics. */
export const factoryNibControls = (
  element: ExcalidrawFreeDrawElement,
): [number, number][] | undefined => {
  if (!element.points.length || !(element.strokeWidth > 0)) {
    return;
  }
  const data = element.customData?.fcInk;
  if (
    data?.nib !== true ||
    data.finished !== true ||
    data.pen !== "hard" ||
    data.assist === "shape"
  ) {
    return;
  }
  if (
    Array.isArray(data.nibPath) &&
    data.nibPath.length === 5 &&
    data.nibPath.every(
      (point: unknown) =>
        Array.isArray(point) &&
        point.length === 2 &&
        point.every(Number.isFinite),
    )
  ) {
    // Surviving tails use stroke-width units relative to the first point, so
    // the body's existing move / duplicate / uniform resize also moves the nib.
    return data.nibPath.map(([x, y]: Point) => [
      element.points[0][0] + x * element.strokeWidth,
      element.points[0][1] + y * element.strokeWidth,
    ]);
  }
  if (data.centerline || element.points.length < 4) {
    return;
  }
  const unit = Number.isFinite(data.unit) && data.unit > 0 ? data.unit : 1;
  const points = element.points;
  const previous = points[points.length - 2];
  const earlier = points[points.length - 3];
  const last = points[points.length - 1];
  if (
    points.length > 4 &&
    Math.hypot(previous[0] - points[0][0], previous[1] - points[0][1]) <
      30 * unit
  ) {
    return;
  }
  let start: Point = [
    (earlier[0] + previous[0]) / (2 * unit),
    (earlier[1] + previous[1]) / (2 * unit),
  ];
  const end: Point = [
    (previous[0] + last[0]) / (2 * unit),
    (previous[1] + last[1]) / (2 * unit),
  ];
  const stationary = Math.hypot(start[0] - end[0], start[1] - end[1]) < 0.1;
  if (stationary) {
    for (let index = points.length - 2; index > 0; index--) {
      const point = points[index];
      if (point[0] / unit !== start[0] && point[1] / unit !== start[1]) {
        start = [point[0] / unit, point[1] / unit];
        break;
      }
    }
  }
  if (start[0] === end[0] && start[1] === end[1]) {
    return;
  }
  const radius = element.strokeWidth / (2 * unit);
  const reach = radius + 1.1 * radius;
  let tip: Point = end;
  let tangent: Point = end;
  if (Math.hypot(end[0] - start[0], end[1] - start[1]) <= reach || stationary) {
    if (start[0] === end[0]) {
      const direction = end[1] > start[1] ? 1 : -1;
      const origin = stationary ? end[1] : start[1];
      tip = [end[0], origin + direction * reach];
      tangent = [end[0], origin + direction * reach * 1.2];
    } else {
      tip = onLine(start, end, reach, stationary);
      tangent = onLine(start, end, reach * 1.2, stationary);
    }
  }
  const dx = tangent[0] - start[0];
  const dy = tangent[1] - start[1];
  let first: Point;
  let second: Point;
  const center = stationary ? end : start;
  if (dx === 0) {
    const side = Math.sqrt(
      radius * radius - Math.pow(radius, 4) / Math.pow(dy, 4),
    );
    const offset = (radius * radius) / dy;
    first = [center[0] - side, center[1] + offset];
    second = [center[0] + side, center[1] + offset];
  } else {
    const lengthSquared = dx * dx + dy * dy;
    const offset = (dy * radius * radius) / lengthSquared;
    const side = Math.sqrt(
      (dx * dx * radius * radius - Math.pow(radius, 4)) / lengthSquared +
        offset * offset,
    );
    const y1 = offset + side;
    const y2 = offset - side;
    first = [center[0] + (radius * radius - dy * y1) / dx, center[1] + y1];
    second = [center[0] + (radius * radius - dy * y2) / dx, center[1] + y2];
  }
  const control = (side: Point) => {
    const front = onLine(start, side, radius * 1.5, stationary);
    return onLine(
      front,
      tip,
      Math.hypot(front[0] - tip[0], front[1] - tip[1]) * 0.5,
      stationary,
      true,
    );
  };
  // calcIntersection returns HPointF(float) before combineIntersection builds
  // its controls. Preserve that conversion rather than rounding only the end.
  const asFloat = ([x, y]: Point): Point => [Math.fround(x), Math.fround(y)];
  first = asFloat(first);
  second = asFloat(second);
  tip = asFloat(tip);
  const result = [first, control(first), tip, control(second), second].map(
    (point) =>
      point.map((coordinate) => Math.fround(coordinate) * unit) as [
        number,
        number,
      ],
  );
  return result.every((point) => point.every(Number.isFinite))
    ? result
    : undefined;
};

export const traceFactoryNib = (
  element: ExcalidrawFreeDrawElement,
  target: Pick<Path2D, "moveTo" | "quadraticCurveTo" | "closePath">,
) => {
  const points = factoryNibControls(element);
  if (!points) {
    return false;
  }
  target.moveTo(...points[0]);
  target.quadraticCurveTo(...points[1], ...points[2]);
  target.quadraticCurveTo(...points[3], ...points[4]);
  target.closePath();
  return true;
};

export const factoryNibPath = (element: ExcalidrawFreeDrawElement) => {
  const points = factoryNibControls(element);
  return points
    ? `M${points[0]} Q${points[1]} ${points[2]} Q${points[3]} ${points[4]} Z`
    : "";
};

/** The same bounded quadratic error as factoryInkSamples, including closure. */
export const factoryNibSamples = (
  element: ExcalidrawFreeDrawElement,
): [number, number][] => {
  const controls = factoryNibControls(element);
  if (!controls) {
    return [];
  }
  const configuredUnit = element.customData?.fcInk?.unit;
  const unit =
    Number.isFinite(configuredUnit) && configuredUnit > 0 ? configuredUnit : 1;
  const samples = [controls[0]];
  for (const index of [1, 3]) {
    const start = controls[index - 1];
    const control = controls[index];
    const end = controls[index + 1];
    const steps = Math.max(
      1,
      Math.min(
        4096,
        Math.ceil(
          Math.sqrt(
            Math.hypot(
              start[0] - 2 * control[0] + end[0],
              start[1] - 2 * control[1] + end[1],
            ) /
              ((4 * unit) / 64),
          ),
        ),
      ),
    );
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const a = 1 - t;
      samples.push([
        a * a * start[0] + 2 * a * t * control[0] + t * t * end[0],
        a * a * start[1] + 2 * a * t * control[1] + t * t * end[1],
      ]);
    }
  }
  samples.push(controls[0]);
  return samples;
};
