import type { ExcalidrawFreeDrawElement } from "./types";

export const isFactoryStroke = (element: ExcalidrawFreeDrawElement) =>
  element.customData?.fcInk?.version === 2 &&
  element.customData.fcInk.pen !== "brush";

export const factoryInkUnit = (element: ExcalidrawFreeDrawElement) => {
  const value = element.customData?.fcInk?.unit;
  return Number.isFinite(value) && value > 0 ? value : 1;
};

const roundInk = (coordinate: number, unit: number) => {
  const pixels = Math.fround(coordinate / unit);
  const integer = Math.trunc(pixels);
  const fraction = pixels - integer;
  return (integer + (fraction <= 0.3 ? 0 : fraction < 0.7 ? 0.5 : 1)) * unit;
};

/** HObject.round and HCurveObject.continueStroke: half-pixel quadratic midpoints. */
export const factoryInkPath = (element: ExcalidrawFreeDrawElement) => {
  const points = element.points;
  if (!points.length) {
    return "";
  }
  if (element.customData?.fcInk?.centerline === true) {
    return `M${points.map(([x, y]) => `${x},${y}`).join(" L")} L${points
      .at(-1)!
      .join(",")}`;
  }
  const unit = factoryInkUnit(element);
  const round = (coordinate: number) => roundInk(coordinate, unit);
  const pair = (x: number, y: number) => `${round(x)},${round(y)}`;
  const path = [`M${pair(points[0][0], points[0][1])}`];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    path.push(
      `Q${pair(a[0], a[1])} ${pair((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)}`,
    );
  }
  const last = points.at(-1)!;
  // Keep the visible tip at the latest real sample; do not predict future ink.
  path.push(`L${pair(last[0], last[1])}`);
  return path.join(" ");
};

/** Sample the rendered quadratics for geometric erasure, never their control polygon. */
export const factoryInkSamples = (element: ExcalidrawFreeDrawElement) => {
  const unit = factoryInkUnit(element);
  const sampled = element.customData?.fcInk?.centerline === true;
  const node = (x: number, y: number, pressure: number) => ({
    x: sampled ? x : roundInk(x, unit),
    y: sampled ? y : roundInk(y, unit),
    pressure,
  });
  const nodes = element.points.map(([x, y], i) =>
    node(x, y, element.pressures[i] ?? 0.5),
  );
  if (sampled || nodes.length < 2) {
    return nodes;
  }
  const samples = [nodes[0]];
  let source = nodes[0];
  for (let i = 1; i < nodes.length; i++) {
    const previous = element.points[i - 1];
    const current = element.points[i];
    const control = nodes[i - 1];
    const end = node(
      (previous[0] + current[0]) / 2,
      (previous[1] + current[1]) / 2,
      (control.pressure + nodes[i].pressure) / 2,
    );
    // Quadratic-to-chord error <= |P0 - 2P1 + P2| / (4 * steps²).
    // Keep it below 1/64 of a calibrated physical pixel, with bounded import work.
    const steps = Math.max(
      1,
      Math.min(
        4096,
        Math.ceil(
          Math.sqrt(
            Math.hypot(
              source.x - 2 * control.x + end.x,
              source.y - 2 * control.y + end.y,
            ) /
              ((4 * unit) / 64),
          ),
        ),
      ),
    );
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const a = 1 - t;
      samples.push({
        x: a * a * source.x + 2 * a * t * control.x + t * t * end.x,
        y: a * a * source.y + 2 * a * t * control.y + t * t * end.y,
        pressure:
          a * a * source.pressure +
          2 * a * t * control.pressure +
          t * t * end.pressure,
      });
    }
    source = end;
  }
  samples.push(nodes.at(-1)!);
  return samples;
};

export const factoryInkDashes = (element: ExcalidrawFreeDrawElement) => {
  const unit = factoryInkUnit(element);
  if (element.strokeStyle === "dotted") {
    return [0, Math.max(2 * element.strokeWidth, 6 * unit)];
  }
  return [
    Math.max(1.6 * element.strokeWidth, 8 * unit),
    Math.max(1.8 * element.strokeWidth, 10 * unit),
  ];
};
