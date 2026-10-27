import {
  factoryBrushSamples,
  isFactoryBrush,
  traceFactoryBrush,
} from "./factoryBrush";
import { traceFactoryInk } from "./factoryInk";
import { traceFactoryNib } from "./factoryNib";

import type { ExcalidrawFreeDrawElement } from "./types";
import type { BrushSample } from "./factoryBrush";

const paths = new WeakMap<
  ExcalidrawFreeDrawElement,
  {
    version: number;
    points: ExcalidrawFreeDrawElement["points"];
    path: Path2D;
    stable?: Path2D;
    geometryKey: string;
    brushSamples?: BrushSample[];
  }
>();

/** Canvas consumes vector commands directly; SVG export uses the same trace. */
export const factoryPath2D = (element: ExcalidrawFreeDrawElement) => {
  const cached = paths.get(element);
  const data = element.customData?.fcInk;
  const geometryKey = [
    data?.version,
    data?.pen,
    data?.unit,
    data?.centerline,
    data?.brushAngle,
    data?.variation,
    data?.finished,
    data?.nib,
  ].join("|");
  if (
    cached?.version === element.version &&
    cached.points === element.points &&
    cached.geometryKey === geometryKey
  ) {
    return cached.path;
  }
  const path = new Path2D();
  let stable: Path2D | undefined;
  let brushSamples: BrushSample[] | undefined;
  if (isFactoryBrush(element)) {
    const samples = factoryBrushSamples(element);
    const stableEnd = Math.max(
      0,
      samples.length === 1 ? 1 : samples.length - 1,
    );
    const append =
      !!cached?.stable &&
      !!cached.brushSamples &&
      cached.geometryKey === geometryKey &&
      cached.brushSamples.length <= stableEnd &&
      cached.brushSamples.every((point, index) => {
        const next = samples[index];
        return (
          point.x === next.x && point.y === next.y && point.width === next.width
        );
      });
    stable = append ? cached!.stable! : new Path2D();
    const stamp = (target: Path2D) => (point: BrushSample, angle: number) => {
      const rx = point.width / 2;
      const ry = point.width / 4;
      target.moveTo(
        point.x - rx * Math.cos(angle),
        point.y - rx * Math.sin(angle),
      );
      // Match the SVG's negative-sweep ellipses, including their winding.
      target.ellipse(point.x, point.y, rx, ry, angle, Math.PI, -Math.PI, true);
      target.closePath();
    };
    traceFactoryBrush(
      element,
      stamp(stable),
      samples,
      append ? cached!.brushSamples!.length : 0,
      stableEnd,
    );
    path.addPath(stable);
    traceFactoryBrush(element, stamp(path), samples, stableEnd);
    brushSamples = samples.slice(0, stableEnd);
  } else {
    // HCurveObject appends midpoint quadratics to its accumulated path. The
    // temporary line to the latest contact must never enter the stable path.
    const append =
      !!cached?.stable &&
      cached.geometryKey === geometryKey &&
      cached.points.length <= element.points.length &&
      cached.points.every((point, index) => point === element.points[index]);
    stable = append ? cached!.stable! : new Path2D();
    traceFactoryInk(element, stable, append ? cached!.points.length : 0, false);
    path.addPath(stable);
    traceFactoryInk(element, path, element.points.length);
  }
  paths.set(element, {
    version: element.version,
    points: element.points,
    path,
    stable,
    geometryKey,
    brushSamples,
  });
  return path;
};

export const factoryNibPath2D = (element: ExcalidrawFreeDrawElement) => {
  const path = new Path2D();
  return traceFactoryNib(element, path) ? path : undefined;
};
