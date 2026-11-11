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

import { getLassoBounds, getLassoSelectedElementIds } from "../lasso/utils";

import { factoryCircleHits, factoryCircleObject } from "./factoryRegion";
import { createEraseRegion, mergeEraseIntervals } from "./region";

import type { EraseRegion } from "./region";

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
  region?: EraseRegion,
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
  const nibHit = region
    ? nibOutline.some((point) => region.contains(point)) ||
      nibOutline.some(
        (point, index) =>
          index > 0 &&
          region.intervals(nibOutline[index - 1], point).length > 0,
      ) ||
      (nibPolygon.length > 0 &&
        region.path.some((point) =>
          polygonIncludesPointNonZero(point, nibPolygon),
        ))
    : nibOutline.some(
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
    return (
      region
        ? region.contains(samples[0])
        : insideInterval(samples[0], samples[0], area, ellipse)
    )
      ? []
      : null;
  }
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const hit = region ? null : insideInterval(a, b, area, ellipse);
    const cuts = region
      ? mergeEraseIntervals(region.intervals(a, b))
      : hit && hit[1] - hit[0] > 1e-10
      ? [hit]
      : [];
    touched ||= cuts.length > 0;
    const intervals: [number, number][] = [];
    let start = 0;
    for (const [enter, exit] of cuts) {
      if (enter > start) {
        intervals.push([start, enter]);
      }
      start = Math.max(start, exit);
    }
    if (start < 1) {
      intervals.push([start, 1]);
    }
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
  return restoreEraseFragments(element, result, {
    brush: !!brush,
    factory: !!factory,
    nib,
    nibHit,
    brushAngle,
    endDistance: samples.at(-1)!.distance,
  });
};

/** Canonical scene-space geometry is serialized once per element version. Native
 * erasure retains/indexes it and performs all continuous sweep intersections. */
export const prepareNativeEraseStroke = (element: FcboardFreeDrawElement) => {
  const brush = isFactoryBrush(element);
  const factory = isFactoryStroke(element);
  const factorySamples = factory ? factoryInkSamples(element) : null;
  const input = brush
    ? factoryBrushSamples(element)
    : factorySamples
    ? factorySamples.map((p) => ({ ...p, width: 0 }))
    : element.points.map(([x, y]) => ({ x, y, width: 0 }));
  const [, , , , cx, cy] = getElementAbsoluteCoords(element, new Map());
  const cos = Math.cos(element.angle);
  const sin = Math.sin(element.angle);
  const global = ([x, y]: readonly [number, number]) => ({
    x: cx + (element.x + x - cx) * cos - (element.y + y - cy) * sin,
    y: cy + (element.x + x - cx) * sin + (element.y + y - cy) * cos,
  });
  let distance = element.customData?.fcInk?.dashOffset || 0;
  const samples = input.map((p, i): Sample => {
    if (i) {
      distance += Math.hypot(p.x - input[i - 1].x, p.y - input[i - 1].y);
    }
    return {
      ...global([p.x, p.y]),
      pressure: factorySamples?.[i].pressure ?? element.pressures[i] ?? 0.5,
      distance,
      brushWidth: p.width,
    };
  });
  const nib = factoryNibControls(element)?.map(global);
  const nibOutline = factoryNibSamples(element).map(global);
  const brushAngle =
    (element.customData?.fcInk?.brushAngle || 0) + element.angle;
  const cap = brush
    ? 0
    : element.strokeWidth * (element.customData?.fcInk ? 1 : 4.25);
  return {
    samples,
    nib,
    nibOutline,
    brush,
    factory,
    brushAngle,
    cap,
    endDistance: distance,
  };
};

export type NativeEraseUpdate = {
  source: FcboardFreeDrawElement;
  version: number;
  nonce: number;
  survivors: FcboardFreeDrawElement[];
};
export type NativeEraserBackend = (
  elements: readonly FcboardElement[],
  path: readonly Point[],
  width: number,
  height: number,
) => Promise<readonly NativeEraseUpdate[]>;

export const restoreEraseFragments = (
  element: FcboardFreeDrawElement,
  result: Sample[][],
  {
    brush,
    factory,
    nib,
    nibHit,
    brushAngle,
    endDistance,
  }: {
    brush: boolean;
    factory: boolean;
    nib?: Point[];
    nibHit: boolean;
    brushAngle: number;
    endDistance: number;
  },
) => {
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
                      nib: !nibHit && fragment.at(-1)!.distance === endDistance,
                      nibPath:
                        !nibHit && fragment.at(-1)!.distance === endDistance
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

export const eraseStrokeInRegion = (
  element: FcboardFreeDrawElement,
  region: EraseRegion,
) =>
  eraseStroke(
    element,
    { x: region.bounds.left, y: region.bounds.top },
    { x: region.bounds.right, y: region.bounds.bottom },
    0,
    0,
    region,
  );

export const pointerSamples = (event: PointerEvent) => {
  const samples = event.getCoalescedEvents?.() || [];
  return samples.length ? [...samples, event] : [event];
};

/** Shared partial-stroke sweep for browser and native input transactions. */
export const eraseSceneStrokes = (
  elements: readonly FcboardElement[],
  from: Point,
  to: Point,
  width: number,
  height: number,
): readonly FcboardElement[] => {
  let changed = false;
  const next: FcboardElement[] = [];
  for (const element of elements) {
    const survivors =
      element.type === "freedraw"
        ? eraseStroke(element, from, to, width, height)
        : null;
    if (survivors === null) {
      next.push(element);
    } else {
      changed = true;
      next.push(
        ...(survivors.length
          ? survivors
          : [newElementWith(element, { isDeleted: true })]),
      );
    }
  }
  return changed ? next : elements;
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

/** Preserve exterior handwriting fragments; non-ink objects retain native hit/parent rules. */
export const eraseSceneRegion = (
  elements: readonly FcboardElement[],
  path: GlobalPoint[],
  tappedIds: readonly string[] = [],
  precision = 0.125,
) => {
  const elementsMap = new Map(elements.map((element) => [element.id, element]));
  const live = elements.filter(
    (element) => !element.isDeleted && !element.locked,
  );
  const area = getLassoBounds(path);
  const candidates = live.filter((element) => {
    const bounds = getElementBounds(element, elementsMap);
    const padding = element.type === "freedraw" ? element.strokeWidth * 12 : 0;
    return (
      bounds[2] + padding >= area[0] &&
      bounds[0] - padding <= area[2] &&
      bounds[3] + padding >= area[1] &&
      bounds[1] - padding <= area[3]
    );
  });
  const selected = factoryCircleHits(
    candidates.map((element) =>
      factoryCircleObject(element, elementsMap, area),
    ),
    path,
    tappedIds,
    precision,
  );
  // A bound label is stored separately in this editor, but belongs to its
  // container. Preserve locked relationships and avoid dangling text references.
  for (const element of live) {
    if (!selected.has(element.id)) {
      continue;
    }
    const related = [
      ...(element.boundElements || [])
        .filter((bound) => bound.type === "text")
        .map((bound) => bound.id),
      ...(element.type === "text" && element.containerId
        ? [element.containerId]
        : []),
    ];
    if (related.some((id) => elementsMap.get(id)?.locked)) {
      selected.delete(element.id);
    } else {
      related.forEach((id) => selected.add(id));
    }
  }
  const region = createEraseRegion(path, precision);
  let changed = false;
  const next = elements.flatMap((element) => {
    if (element.locked || element.isDeleted || !selected.has(element.id)) {
      return [element];
    }
    if (
      element.type === "freedraw" &&
      element.backgroundColor === "transparent"
    ) {
      const parts = region ? eraseStrokeInRegion(element, region) : null;
      if (!parts) {
        return [element];
      }
      changed = true;
      return parts.length
        ? parts
        : [newElementWith(element, { isDeleted: true })];
    }
    changed = true;
    return [newElementWith(element, { isDeleted: true })];
  });
  return changed ? next : elements;
};
