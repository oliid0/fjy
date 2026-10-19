import type { ExcalidrawFreeDrawElement } from "./types";

export const isFactoryStroke = (element: ExcalidrawFreeDrawElement) =>
  element.customData?.fcInk?.version === 2 &&
  element.customData.fcInk.pen !== "brush";

export const factoryInkUnit = (element: ExcalidrawFreeDrawElement) => {
  const value = element.customData?.fcInk?.unit;
  return Number.isFinite(value) && value > 0 ? value : 1;
};

/** HObject.round and HCurveObject.continueStroke: half-pixel quadratic midpoints. */
export const factoryInkPath = (element: ExcalidrawFreeDrawElement) => {
  const points = element.points;
  if (!points.length) {
    return "";
  }
  const unit = factoryInkUnit(element);
  const round = (coordinate: number) => {
    const pixels = Math.fround(coordinate / unit);
    const integer = Math.trunc(pixels);
    const fraction = pixels - integer;
    return (integer + (fraction <= 0.3 ? 0 : fraction < 0.7 ? 0.5 : 1)) * unit;
  };
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
