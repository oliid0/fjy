import { factoryInkUnit } from "./factoryInk";

import type { FcboardFreeDrawElement } from "./types";

export type BrushSample = { x: number; y: number; width: number };

export const isFactoryBrush = (element: FcboardFreeDrawElement) =>
  element.customData?.fcInk?.version === 3 &&
  element.customData.fcInk.pen === "brush";

const storedWidths = (element: FcboardFreeDrawElement): number[] | null => {
  const saved = element.customData?.fcInk?.brushWidths;
  if (
    Array.isArray(saved) &&
    saved.length === element.points.length &&
    saved.every(
      (width: unknown) =>
        typeof width === "number" && Number.isFinite(width) && width >= 0,
    )
  ) {
    return saved;
  }
  return null;
};

type WidthTrace = {
  key: string;
  input: [number, number, number][];
  widths: number[];
  states: { width: number; velocity: number }[];
  finished: boolean;
};
const widthTraces = new WeakMap<FcboardFreeDrawElement, WidthTrace>();
const sampleTraces = new WeakMap<
  FcboardFreeDrawElement,
  {
    unit: number;
    nodes: BrushSample[];
    stable: BrushSample[];
    ends: number[];
    samples: BrushSample[];
  }
>();

/** HBezierObject.calcInitialWidth / calcNewWidth; distances are physical pixels. */
export const factoryBrushWidths = (
  element: FcboardFreeDrawElement,
): number[] => {
  const saved = storedWidths(element);
  if (saved) {
    return saved.map((width) => width * element.strokeWidth);
  }
  const unit = factoryInkUnit(element);
  const base = (element.strokeWidth * 4) / 3 + 3 * unit;
  // HDataSet.getBzPenThreshold defaults to 45, normalized by 50.
  const configured = element.customData?.fcInk?.variation;
  const variation =
    (typeof configured === "number" && Number.isFinite(configured)
      ? Math.max(0, Math.min(50, configured))
      : 45) / 50;
  const key = `${unit}|${element.strokeWidth}|${variation}|${element.simulatePressure}`;
  const finished = element.customData?.fcInk?.finished === true;
  const previous = widthTraces.get(element);
  const cached = previous?.key === key ? previous : undefined;
  const count = element.points.length;
  const pressure = (index: number) =>
    element.simulatePressure ? 0 : element.pressures[index] ?? 0.5;
  // A prefix may have been edited in place by an object operation. Compare the
  // recorded scalar inputs rather than trusting point or array identities.
  let from = 0;
  while (
    cached &&
    from < Math.min(cached.input.length, count) &&
    Object.is(cached.input[from][0], element.points[from][0]) &&
    Object.is(cached.input[from][1], element.points[from][1]) &&
    Object.is(cached.input[from][2], pressure(from))
  ) {
    from++;
  }
  if (cached?.finished || (finished && count)) {
    from = Math.min(
      from,
      Math.max(0, count - 1),
      Math.max(0, cached ? cached.input.length - 1 : 0),
    );
  }
  if (
    cached &&
    from === count &&
    from === cached.input.length &&
    finished === cached.finished
  ) {
    return cached.widths;
  }
  const widths = cached?.widths.slice(0, from) || [];
  const states = cached?.states || [];
  states.length = from;
  const input = cached?.input || [];
  input.length = from;
  for (let index = from; index < count; index++) {
    input.push([
      element.points[index][0],
      element.points[index][1],
      pressure(index),
    ]);
  }
  const pressureFactor = (index: number) =>
    element.simulatePressure
      ? 1
      : 1 +
        (Math.sqrt(Math.max(0, Math.min(1, input[index][2]))) * 0.9 +
          0.55 -
          1) *
          variation *
          0.3;
  let lastWidth = from
    ? states[from - 1].width
    : input.length
    ? base * (1 + 0.4 * variation) * pressureFactor(0)
    : 0;
  let lastVelocity = from ? states[from - 1].velocity : 0;
  for (let index = from; index < input.length; index++) {
    if (index && index === input.length - 1 && finished) {
      widths.push(0);
    } else {
      if (index) {
        const point = input[index];
        const previousPoint = input[index - 1];
        const velocity =
          (Math.hypot(
            point[0] - previousPoint[0],
            point[1] - previousPoint[1],
          ) /
            unit) *
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
      widths.push(Math.max(unit, base * 0.08, lastWidth));
    }
    states.push({ width: lastWidth, velocity: lastVelocity });
  }
  widthTraces.set(element, { key, input, widths, states, finished });
  return widths;
};

/** Bezier.init/addNode: midpoint quadratics with linearly interpolated widths. */
export const factoryBrushSamples = (
  element: FcboardFreeDrawElement,
): BrushSample[] => {
  const widths = factoryBrushWidths(element);
  const count = element.points.length;
  // Erased fragments already contain the sampled curve; never smooth them again.
  if (storedWidths(element) || count < 2) {
    return element.points.map(([x, y], index) => ({
      x,
      y,
      width: widths[index],
    }));
  }
  const mid = (a: BrushSample, b: BrushSample): BrushSample => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    width: (a.width + b.width) / 2,
  });
  const unit = factoryInkUnit(element);
  const previous = sampleTraces.get(element);
  const cached = previous?.unit === unit ? previous : undefined;
  let shared = 0;
  while (
    cached &&
    shared < Math.min(cached.nodes.length, count) &&
    cached.nodes[shared].x === element.points[shared][0] &&
    cached.nodes[shared].y === element.points[shared][1] &&
    cached.nodes[shared].width === widths[shared]
  ) {
    shared++;
  }
  if (cached && shared === count && shared === cached.nodes.length) {
    return cached.samples;
  }
  const nodes = cached?.nodes || [];
  nodes.length = shared;
  for (let index = shared; index < count; index++) {
    nodes.push({
      x: element.points[index][0],
      y: element.points[index][1],
      width: widths[index],
    });
  }
  const from = Math.max(1, shared);
  const stable = cached && shared ? cached.stable : [nodes[0]];
  if (cached && shared) {
    stable.length = cached.ends[from - 1];
  }
  const ends = cached && shared ? cached.ends : [1];
  ends.length = from;
  let source = from === 1 ? nodes[0] : mid(nodes[from - 2], nodes[from - 1]);
  for (let i = from; i < nodes.length; i++) {
    const previousNode = nodes[i - 1];
    const destination = mid(previousNode, nodes[i]);
    const control = i === 1 ? mid(previousNode, destination) : previousNode;
    // Bound work for imported scenes whose coordinates exceed a physical screen.
    const steps = Math.min(
      4096,
      Math.floor(
        Math.hypot(nodes[i].x - previousNode.x, nodes[i].y - previousNode.y) /
          unit /
          10,
      ) + 1,
    );
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const a = 1 - t;
      stable.push({
        x: a * a * source.x + 2 * a * t * control.x + t * t * destination.x,
        y: a * a * source.y + 2 * a * t * control.y + t * t * destination.y,
        width: source.width + (destination.width - source.width) * t,
      });
    }
    source = destination;
    ends.push(stable.length);
  }
  // The temporary latest-contact segment never enters the accumulated prefix.
  const samples = [...stable, nodes.at(-1)!];
  sampleTraces.set(element, { unit, nodes, stable, ends, samples });
  return samples;
};

/** HBezierObject.drawLine: a filled union of horizontal 2:1 ellipses, every 2px. */
export const traceFactoryBrush = (
  element: FcboardFreeDrawElement,
  stamp: (point: BrushSample, angle: number) => void,
  samples = factoryBrushSamples(element),
  from = 0,
  end = samples.length,
) => {
  const unit = factoryInkUnit(element);
  const angle = Number.isFinite(element.customData?.fcInk?.brushAngle)
    ? element.customData!.fcInk.brushAngle
    : 0;
  if (end && !from && samples[0].width > 0) {
    stamp(samples[0], angle);
  }
  for (let i = Math.max(1, from); i < end; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const steps = Math.min(
      4096,
      Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / (2 * unit)) + 1,
    );
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const point = {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        width: a.width + (b.width - a.width) * t,
      };
      if (point.width > 0) {
        stamp(point, angle);
      }
    }
  }
};

export const factoryBrushPath = (element: FcboardFreeDrawElement) => {
  const path: string[] = [];
  traceFactoryBrush(element, (point, angle) => {
    const rx = point.width / 2;
    const ry = point.width / 4;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    path.push(
      `M${point.x - rx * cos},${point.y - rx * sin}a${rx},${ry} ${
        (angle * 180) / Math.PI
      } 1 0 ${2 * rx * cos},${2 * rx * sin}a${rx},${ry} ${
        (angle * 180) / Math.PI
      } 1 0 ${-2 * rx * cos},${-2 * rx * sin}Z`,
    );
  });
  return path.join(" ");
};
