import { getSizeFromPoints } from "@fcboard/common";
import {
  getElementAbsoluteCoords,
  getElementBounds,
  getElementLineSegments,
  isPointInElement,
  shouldTestInside,
  newElementWith,
} from "@fcboard/element";
import { pointFrom, polygonIncludesPointNonZero } from "@fcboard/math";
import {
  factoryNibControls,
  factoryNibSamples,
} from "@fcboard/element/factoryNib";
import {
  factoryBrushSamples,
  isFactoryBrush,
} from "@fcboard/element/factoryBrush";
import {
  factoryInkSamples,
  isFactoryStroke,
} from "@fcboard/element/factoryInk";

import type {
  FcboardElement,
  FcboardFreeDrawElement,
} from "@fcboard/element/types";
import type { GlobalPoint, LocalPoint, Radians } from "@fcboard/math";

import { getLassoSelectedElementIds } from "../lasso/utils";

type Point = { x: number; y: number };
type Sample = Point & {
  pressure: number;
  distance: number;
  brushWidth: number;
};
const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Minkowski sum of a motion segment and the APK's rectangular eraser footprint. */
const sweptRectangle = (
  from: Point,
  to: Point,
  width: number,
  height: number,
) => {
  const corners = [from, to].flatMap((p) =>
    [-1, 1].flatMap((x) =>
      [-1, 1].map((y) => ({
        x: p.x + (x * width) / 2,
        y: p.y + (y * height) / 2,
      })),
    ),
  );
  const points = corners
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .filter((p, i, all) => !i || p.x !== all[i - 1].x || p.y !== all[i - 1].y);
  const half = (values: Point[]) => {
    const hull: Point[] = [];
    for (const p of values) {
      while (
        hull.length > 1 &&
        cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0
      ) {
        hull.pop();
      }
      hull.push(p);
    }
    return hull.slice(0, -1);
  };
  return [...half(points), ...half([...points].reverse())];
};

/** Clip a segment to a convex swept area; exact intersections preserve sparse, fast strokes. */
const insideInterval = (
  a: Point & { brushWidth?: number },
  b: Point & { brushWidth?: number },
  polygon: Point[],
  ellipse?: { cos: number; sin: number },
) => {
  let enter = 0;
  let exit = 1;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i];
    const q = polygon[(i + 1) % polygon.length];
    // A brush's ellipse radius changes continuously along each sampled segment.
    // Using the segment's maximum width creates discontinuous cut boundaries
    // and can leave isolated slivers when the tip narrows across a sample.
    const nx = p.y - q.y;
    const ny = q.x - p.x;
    const support = ellipse
      ? Math.hypot(
          nx * ellipse.cos + ny * ellipse.sin,
          (-nx * ellipse.sin + ny * ellipse.cos) / 2,
        ) / 2
      : 0;
    const start = cross(p, q, a) + (a.brushWidth || 0) * support;
    const delta = cross(p, q, b) + (b.brushWidth || 0) * support - start;
    if (Math.abs(delta) < 1e-10) {
      if (start < 0) {
        return null;
      }
    } else if (delta > 0) {
      enter = Math.max(enter, -start / delta);
    } else {
      exit = Math.min(exit, -start / delta);
    }
    if (enter > exit) {
      return null;
    }
  }
  return [enter, exit] as const;
};

/** Null means untouched; survivors remain editable, serializable vector strokes. */
export const eraseStroke = (
  element: FcboardFreeDrawElement,
  from: Point,
  to: Point,
  width: number,
  height: number,
): FcboardFreeDrawElement[] | null => {
  if (element.locked || element.isDeleted || !element.points.length) {
    return null;
  }
  const brush = isFactoryBrush(element) ? factoryBrushSamples(element) : null;
  const cap = brush
    ? brush.reduce((maximum, sample) => Math.max(maximum, sample.width), 0)
    : element.strokeWidth * (element.customData?.fcInk ? 1 : 4.25);
  const bounds = getElementBounds(element, new Map());
  if (
    Math.max(from.x, to.x) + (width + cap) / 2 < bounds[0] ||
    Math.min(from.x, to.x) - (width + cap) / 2 > bounds[2] ||
    Math.max(from.y, to.y) + (height + cap) / 2 < bounds[1] ||
    Math.min(from.y, to.y) - (height + cap) / 2 > bounds[3]
  ) {
    return null;
  }
  const factory = isFactoryStroke(element) ? factoryInkSamples(element) : null;
  const [, , , , cx, cy] = getElementAbsoluteCoords(element, new Map());
  const cos = Math.cos(element.angle);
  const sin = Math.sin(element.angle);
  const globalPoint = ([x, y]: readonly [number, number]) => ({
    x: cx + (element.x + x - cx) * cos - (element.y + y - cy) * sin,
    y: cy + (element.x + x - cx) * sin + (element.y + y - cy) * cos,
  });
  const nib = factoryNibControls(element)?.map(globalPoint);
  const nibOutline = factoryNibSamples(element).map(globalPoint);
  const nibArea = sweptRectangle(from, to, width, height);
  const nibPolygon = nibOutline.map(({ x, y }) => pointFrom<GlobalPoint>(x, y));
  const nibHit =
    nibOutline.some(
      (point, index) =>
        index > 0 && insideInterval(nibOutline[index - 1], point, nibArea),
    ) ||
    (nibPolygon.length > 0 &&
      [from, to].some(({ x, y }) =>
        polygonIncludesPointNonZero(pointFrom<GlobalPoint>(x, y), nibPolygon),
      ));
  const brushAngle =
    (element.customData?.fcInk?.brushAngle || 0) + element.angle;
  const ellipse = brush
    ? { cos: Math.cos(brushAngle), sin: Math.sin(brushAngle) }
    : undefined;
  let travelled = element.customData?.fcInk?.dashOffset || 0;
  const input =
    brush ||
    factory?.map((p) => ({ ...p, width: 0 })) ||
    element.points.map(([x, y]) => ({ x, y, width: 0 }));
  const samples = input.map(({ x, y, width: brushWidth }, i): Sample => {
    if (i) {
      travelled += Math.hypot(x - input[i - 1].x, y - input[i - 1].y);
    }
    const dx = element.x + x - cx;
    const dy = element.y + y - cy;
    return {
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos,
      pressure: factory?.[i].pressure ?? element.pressures[i] ?? 0.5,
      distance: travelled,
      brushWidth,
    };
  });
  // Include the stroke cap so a cut doesn't leave half a round cap in the erased area.
  const area = sweptRectangle(
    from,
    to,
    width + (brush ? 0 : cap),
    height + (brush ? 0 : cap),
  );
  const result: Sample[][] = [];
  let current: Sample[] = [];
  let touched = nibHit;
  const flush = () => {
    if (current.length) {
      result.push(current);
      current = [];
    }
  };
  const interpolate = (a: Sample, b: Sample, t: number): Sample => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    pressure: a.pressure + (b.pressure - a.pressure) * t,
    distance: a.distance + (b.distance - a.distance) * t,
    brushWidth: a.brushWidth + (b.brushWidth - a.brushWidth) * t,
  });
  if (samples.length === 1) {
    return insideInterval(samples[0], samples[0], area, ellipse) ? [] : null;
  }
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const hit = insideInterval(a, b, area, ellipse);
    const cut = hit && hit[1] - hit[0] > 1e-10;
    touched ||= !!cut;
    const intervals = !cut
      ? [[0, 1]]
      : [
          ...(hit[0] > 0 ? [[0, hit[0]]] : []),
          ...(hit[1] < 1 ? [[hit[1], 1]] : []),
        ];
    if (!intervals.length) {
      flush();
    }
    for (const [start, end] of intervals) {
      const first = interpolate(a, b, start);
      const last = current[current.length - 1];
      if (!last || Math.hypot(last.x - first.x, last.y - first.y) > 1e-7) {
        flush();
        current.push(first);
      }
      current.push(interpolate(a, b, end));
      if (end < 1) {
        flush();
      }
    }
  }
  flush();
  if (!touched) {
    return null;
  }
  return result.map((fragment, i) => {
    const first = fragment[0];
    const points = fragment.map((p) =>
      pointFrom<LocalPoint>(p.x - first.x, p.y - first.y),
    );
    const base = i
      ? { ...element, id: crypto.randomUUID(), version: 0 }
      : element;
    return newElementWith(base, {
      x: first.x,
      y: first.y,
      angle: 0 as Radians,
      ...(brush ||
      factory ||
      (element.customData?.fcInk && element.strokeStyle === "dashed")
        ? {
            customData: {
              ...element.customData,
              fcInk: {
                ...element.customData?.fcInk,
                dashOffset: first.distance,
                ...(factory ? { centerline: true } : {}),
                ...(nib
                  ? {
                      nib:
                        !nibHit &&
                        fragment.at(-1)!.distance === samples.at(-1)!.distance,
                      nibPath:
                        !nibHit &&
                        fragment.at(-1)!.distance === samples.at(-1)!.distance
                          ? nib.map(({ x, y }) => [
                              (x - first.x) / element.strokeWidth,
                              (y - first.y) / element.strokeWidth,
                            ])
                          : undefined,
                    }
                  : {}),
                ...(brush
                  ? {
                      brushWidths: fragment.map(
                        (p) => p.brushWidth / element.strokeWidth,
                      ),
                      brushAngle,
                    }
                  : {}),
              },
            },
          }
        : {}),
      points,
      pressures: element.simulatePressure
        ? []
        : fragment.map((p) => p.pressure),
      ...getSizeFromPoints(points),
    });
  });
};

export const pointerSamples = (event: PointerEvent) => {
  const samples = event.getCoalescedEvents?.() || [];
  return samples.length ? [...samples, event] : [event];
};

/** The visible rectangular footprint sweeps whole objects, including fast moves. */
export const eraseSceneObjects = (
  elements: readonly FcboardElement[],
  from: Point,
  to: Point,
  width: number,
  height: number,
) => {
  const elementsMap = new Map(elements.map((element) => [element.id, element]));
  const hit = new Set<string>();
  const groups = new Set<string>();
  const path = sweptRectangle(from, to, width, height).map(({ x, y }) =>
    pointFrom<GlobalPoint>(x, y),
  );
  for (const element of elements) {
    if (element.isDeleted || element.locked) {
      continue;
    }
    const bounds = getElementBounds(element, elementsMap);
    if (
      Math.max(from.x, to.x) + width / 2 < bounds[0] ||
      Math.min(from.x, to.x) - width / 2 > bounds[2] ||
      Math.max(from.y, to.y) + height / 2 < bounds[1] ||
      Math.min(from.y, to.y) - height / 2 > bounds[3]
    ) {
      continue;
    }
    const inside =
      shouldTestInside(element) &&
      path.some((point) => isPointInElement(point, element, elementsMap));
    const touched =
      inside ||
      (element.type === "freedraw"
        ? eraseStroke(element, from, to, width, height) !== null
        : getLassoSelectedElementIds({
            lassoPath: path,
            elements: [element],
            elementsMap,
            elementsSegments: new Map([
              [element.id, getElementLineSegments(element, elementsMap)],
            ]),
            intersectedElements: new Set(),
            enclosedElements: new Set(),
          }).selectedElementIds.length > 0);
    if (touched) {
      hit.add(element.id);
      const group = element.groupIds.at(-1);
      if (group) {
        groups.add(group);
      }
      element.boundElements
        ?.filter((bound) => bound.type === "text")
        .forEach((bound) => hit.add(bound.id));
      if (element.type === "text" && element.containerId) {
        hit.add(element.containerId);
      }
    }
  }
  if (!hit.size) {
    return elements;
  }
  return elements.map((element) =>
    !element.locked &&
    !element.isDeleted &&
    (hit.has(element.id) || element.groupIds.some((id) => groups.has(id)))
      ? newElementWith(element, { isDeleted: true })
      : element,
  );
};

export const isPalmContact = (
  event: Pick<PointerEvent, "pointerType" | "width" | "height">,
  threshold: number,
) =>
  event.pointerType === "touch" &&
  Math.max(event.width || 0, event.height || 0) >= threshold;
