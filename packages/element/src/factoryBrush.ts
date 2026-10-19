import { factoryInkUnit } from "./factoryInk";

import type { ExcalidrawFreeDrawElement } from "./types";

export type BrushSample = { x: number; y: number; width: number };

export const isFactoryBrush = (element: ExcalidrawFreeDrawElement) =>
  element.customData?.fcInk?.version === 3 &&
  element.customData.fcInk.pen === "brush";

const storedWidths = (element: ExcalidrawFreeDrawElement): number[] | null => {
  const saved = element.customData?.fcInk?.brushWidths;
  if (
    Array.isArray(saved) &&
    saved.length === element.points.length &&
    saved.every(
      (width: unknown) =>
        typeof width === "number" && Number.isFinite(width) && width > 0,
    )
  ) {
    return saved;
  }
  return null;
};

/** HBezierObject.calcInitialWidth / calcNewWidth; distances are physical pixels. */
export const factoryBrushWidths = (
  element: ExcalidrawFreeDrawElement,
): number[] => {
  const saved = storedWidths(element);
  if (saved) {
    return saved.map((width) => width * element.strokeWidth);
  }
  const unit = factoryInkUnit(element);
  const base = (element.strokeWidth * 4) / 3 + 3 * unit;
  // HDataSet.getBzPenThreshold defaults to 45, normalized by 50.
  const variation = 45 / 50;
  const pressureFactor = (index: number) =>
    element.simulatePressure
      ? 1
      : 1 +
        (Math.sqrt(Math.max(0, Math.min(1, element.pressures[index] ?? 0.5))) *
          0.9 +
          0.55 -
          1) *
          variation *
          0.3;
  let lastWidth = base * (1 + 0.4 * variation) * pressureFactor(0);
  let lastVelocity = 0;
  return element.points.map((point, index) => {
    if (index) {
      const previous = element.points[index - 1];
      const velocity =
        (Math.hypot(point[0] - previous[0], point[1] - previous[1]) / unit) *
        0.02;
      const weighted = velocity * 0.6 + lastVelocity * 0.4;
      const maximum = 1 + 0.4 * variation;
      const minimum = Math.max(0.08, 1 - 0.92 * variation);
      const target =
        maximum -
        (maximum - minimum) *
          Math.pow(Math.min(1, Math.max(0, weighted * 4)), 0.6);
      lastWidth +=
        (base * target * pressureFactor(index) - lastWidth) *
        (variation * 0.6 + 0.3);
      lastVelocity = velocity;
    }
    return Math.max(unit, base * 0.08, lastWidth);
  });
};

/** Bezier.init/addNode: midpoint quadratics with linearly interpolated widths. */
export const factoryBrushSamples = (
  element: ExcalidrawFreeDrawElement,
): BrushSample[] => {
  const widths = factoryBrushWidths(element);
  const nodes = element.points.map(([x, y], index) => ({
    x,
    y,
    width: widths[index],
  }));
  // Erased fragments already contain the sampled curve; never smooth them again.
  if (storedWidths(element) || nodes.length < 2) {
    return nodes;
  }
  const mid = (a: BrushSample, b: BrushSample): BrushSample => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    width: (a.width + b.width) / 2,
  });
  const unit = factoryInkUnit(element);
  const samples = [nodes[0]];
  let source = nodes[0];
  for (let i = 1; i < nodes.length; i++) {
    const previous = nodes[i - 1];
    const destination = mid(previous, nodes[i]);
    const control = i === 1 ? mid(previous, destination) : previous;
    // Bound work for imported scenes whose coordinates exceed a physical screen.
    const steps = Math.min(
      4096,
      Math.floor(
        Math.hypot(nodes[i].x - previous.x, nodes[i].y - previous.y) /
          unit /
          10,
      ) + 1,
    );
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const a = 1 - t;
      samples.push({
        x: a * a * source.x + 2 * a * t * control.x + t * t * destination.x,
        y: a * a * source.y + 2 * a * t * control.y + t * t * destination.y,
        width: source.width + (destination.width - source.width) * t,
      });
    }
    source = destination;
  }
  // Complete to the latest real sample so the visible tip follows the contact.
  samples.push(nodes.at(-1)!);
  return samples;
};

/** HBezierObject.drawLine: a filled union of horizontal 2:1 ellipses, every 2px. */
export const factoryBrushPath = (element: ExcalidrawFreeDrawElement) => {
  const samples = factoryBrushSamples(element);
  const unit = factoryInkUnit(element);
  const path: string[] = [];
  const angle = Number.isFinite(element.customData?.fcInk?.brushAngle)
    ? element.customData!.fcInk.brushAngle
    : 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const stamp = (point: BrushSample) => {
    const rx = point.width / 2;
    const ry = point.width / 4;
    path.push(
      `M${point.x - rx * cos},${point.y - rx * sin}a${rx},${ry} ${
        (angle * 180) / Math.PI
      } 1 0 ${2 * rx * cos},${2 * rx * sin}a${rx},${ry} ${
        (angle * 180) / Math.PI
      } 1 0 ${-2 * rx * cos},${-2 * rx * sin}Z`,
    );
  };
  if (samples.length) {
    stamp(samples[0]);
  }
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const steps = Math.min(
      4096,
      Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / (2 * unit)) + 1,
    );
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      stamp({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        width: a.width + (b.width - a.width) * t,
      });
    }
  }
  return path.join(" ");
};
