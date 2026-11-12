import ClipperLib from "clipper-lib";
import {
  getElementAbsoluteCoords,
  getElementBounds,
  getElementLineSegments,
  getElementShape,
  isLineElement,
  isPathALoop,
} from "@fcboard/element";
import {
  factoryInkSamples,
  isFactoryStroke,
} from "@fcboard/element/factoryInk";
import { factoryNibSamples } from "@fcboard/element/factoryNib";
import {
  isFactoryBrush,
  traceFactoryBrush,
} from "@fcboard/element/factoryBrush";
import {
  lineSegment,
  lineSegmentIntersectionPoints,
  pointFrom,
  polygonIncludesPointNonZero,
} from "@fcboard/math";

import type { ElementsMap, FcboardElement } from "@fcboard/element/types";
import type { GlobalPoint } from "@fcboard/math";

import { createEraseRegion } from "./region";

export type FactoryCircleObject = {
  id: string;
  parent?: string;
  kind?: "image" | "text";
  bounds: readonly [number, number, number, number];
  paths: { points: GlobalPoint[]; closed: boolean }[];
};

/** Read the same sampled quadratics, nib and brush stamps as Canvas/SVG.
 * Circle erasing removes the source object; it never rewrites these paths. */
export const factoryCircleObject = (
  element: FcboardElement,
  elementsMap: ElementsMap,
  area?: readonly [number, number, number, number],
): FactoryCircleObject => {
  const paths: FactoryCircleObject["paths"] = [];
  if (element.type === "freedraw") {
    const [, , , , cx, cy] = getElementAbsoluteCoords(element, elementsMap);
    const cos = Math.cos(element.angle);
    const sin = Math.sin(element.angle);
    const global = (x: number, y: number) =>
      pointFrom<GlobalPoint>(
        cx + (element.x + x - cx) * cos - (element.y + y - cy) * sin,
        cy + (element.x + x - cx) * sin + (element.y + y - cy) * cos,
      );
    if (isFactoryBrush(element)) {
      traceFactoryBrush(element, (sample, angle) => {
        const center = global(sample.x, sample.y);
        const radius = sample.width / 2;
        if (
          area &&
          (center[0] + radius < area[0] ||
            center[0] - radius > area[2] ||
            center[1] + radius < area[1] ||
            center[1] - radius > area[3])
        ) {
          return;
        }
        const count = Math.max(16, Math.min(64, Math.ceil(sample.width * 2)));
        paths.push({
          closed: true,
          points: Array.from({ length: count }, (_, index) => {
            const theta = (index / count) * 2 * Math.PI;
            const x = (sample.width / 2) * Math.cos(theta);
            const y = (sample.width / 4) * Math.sin(theta);
            return global(
              sample.x + x * Math.cos(angle) - y * Math.sin(angle),
              sample.y + x * Math.sin(angle) + y * Math.cos(angle),
            );
          }),
        });
      });
    } else {
      paths.push({
        closed:
          element.backgroundColor !== "transparent" &&
          isPathALoop(element.points),
        points: isFactoryStroke(element)
          ? factoryInkSamples(element).map(({ x, y }) => global(x, y))
          : element.points.map(([x, y]) => global(x, y)),
      });
      const nib = factoryNibSamples(element);
      if (nib.length) {
        paths.push({ closed: true, points: nib.map(([x, y]) => global(x, y)) });
      }
    }
  } else {
    const shape = getElementShape<GlobalPoint>(element, elementsMap);
    paths.push({
      closed:
        !["line", "arrow"].includes(element.type) ||
        (isLineElement(element) && !!element.polygon),
      points:
        shape.type === "polygon"
          ? shape.data
          : getElementLineSegments(element, elementsMap).flatMap(([a, b]) => [
              a,
              b,
            ]),
    });
  }
  const bounds: [number, number, number, number] = [
    ...getElementBounds(element, elementsMap),
  ];
  // ImageShape/TextShape.checkContained use getShapeRectF / mapRect's axis-
  // aligned bounds, including after rotation, rather than bitmap alpha or crop.
  if (element.type === "image" || element.type === "text") {
    paths.splice(0, paths.length, {
      closed: true,
      points: [
        pointFrom(bounds[0], bounds[1]),
        pointFrom(bounds[2], bounds[1]),
        pointFrom(bounds[2], bounds[3]),
        pointFrom(bounds[0], bounds[3]),
      ],
    });
  }
  for (const { points } of paths) {
    for (const [x, y] of points) {
      bounds[0] = Math.min(bounds[0], x);
      bounds[1] = Math.min(bounds[1], y);
      bounds[2] = Math.max(bounds[2], x);
      bounds[3] = Math.max(bounds[3], y);
    }
  }
  return {
    id: element.id,
    parent: element.groupIds[0],
    kind:
      element.type === "image" || element.type === "text"
        ? element.type
        : undefined,
    bounds,
    paths,
  };
};

const crosses = (
  a: GlobalPoint,
  b: GlobalPoint,
  points: GlobalPoint[],
  closed: boolean,
) =>
  points.some((point, index) => {
    const next = points[index + 1] || (closed ? points[0] : undefined);
    return (
      !!next &&
      !!lineSegmentIntersectionPoints(
        lineSegment(a, b),
        lineSegment(point, next),
      )
    );
  });

/** x.apk draw/mode/e: collect the top object at each motion segment, then
 * checkContained from top to bottom on lift. Closed shapes consume their
 * intersection with the region, so covered objects are not erased through them.
 * j() accepts only shapes with the same direct parent as the first hit. */
export const factoryCircleHits = (
  objects: FactoryCircleObject[],
  path: GlobalPoint[],
  tappedIds: readonly string[] = [],
  precision = 0.125,
) => {
  const selected = new Set<string>();
  if (!path.length || path.some((point) => !point.every(Number.isFinite))) {
    return selected;
  }
  const topFirst = objects
    .filter(
      (object) =>
        object.bounds.every(Number.isFinite) &&
        object.paths.every((part) =>
          part.points.every((point) => point.every(Number.isFinite)),
        ),
    )
    .reverse();
  let parent: string | undefined;
  const add = (object: FactoryCircleObject) => {
    if (!selected.size) {
      parent = object.parent;
    }
    if (parent === object.parent) {
      selected.add(object.id);
    }
  };
  if (path.length === 1) {
    const tapped = topFirst.find((object) => tappedIds.includes(object.id));
    if (tapped) {
      add(tapped);
    }
    return selected;
  }
  const insideBounds = (point: GlobalPoint, object: FactoryCircleObject) =>
    point[0] >= object.bounds[0] &&
    point[0] <= object.bounds[2] &&
    point[1] >= object.bounds[1] &&
    point[1] <= object.bounds[3];
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1];
    const b = path[index];
    if (a[0] === b[0] && a[1] === b[1]) {
      continue;
    }
    const object = topFirst.find((object) => {
      const [left, top, right, bottom] = object.bounds;
      if (
        Math.max(a[0], b[0]) < left ||
        Math.min(a[0], b[0]) > right ||
        Math.max(a[1], b[1]) < top ||
        Math.min(a[1], b[1]) > bottom
      ) {
        return false;
      }
      if (object.kind === "text") {
        return insideBounds(b, object);
      }
      return object.paths.some(({ points, closed }) =>
        closed
          ? polygonIncludesPointNonZero(a, points) ||
            (object.kind === "image" && crosses(a, b, points, true))
          : crosses(a, b, points, false),
      );
    });
    if (object) {
      add(object);
    }
  }
  const region = createEraseRegion(path, precision);
  if (!region) {
    return selected;
  }
  // Keep integer coordinates local and subpixel, avoiding Clipper's large-range
  // slow path while preserving Canvas geometry at normal writing scales.
  const origin = region.path[0];
  const extent = region.path.reduce(
    (maximum, point) =>
      Math.max(
        maximum,
        Math.abs(point[0] - origin[0]),
        Math.abs(point[1] - origin[1]),
      ),
    1,
  );
  const scale = Math.min(1024, 1e7 / extent);
  const integer = (point: GlobalPoint): ClipperLib.IntPoint => ({
    X: Math.round((point[0] - origin[0]) * scale),
    Y: Math.round((point[1] - origin[1]) * scale),
  });
  let remaining = ClipperLib.Clipper.SimplifyPolygon(
    region.path.map(integer),
    ClipperLib.PolyFillType.pftNonZero,
  );
  const contains = (point: GlobalPoint) => {
    const p = integer(point);
    let winding = 0;
    for (const polygon of remaining) {
      const inside = ClipperLib.Clipper.PointInPolygon(p, polygon);
      if (inside === -1) {
        return true;
      }
      if (inside) {
        winding += Math.sign(ClipperLib.Clipper.Area(polygon));
      }
    }
    return winding !== 0;
  };
  const operation = (clip: ClipperLib.Paths, type: ClipperLib.ClipType) => {
    const engine = new ClipperLib.Clipper();
    engine.AddPaths(remaining, ClipperLib.PolyType.ptSubject, true);
    engine.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
    const result: ClipperLib.Paths = [];
    engine.Execute(
      type,
      result,
      ClipperLib.PolyFillType.pftNonZero,
      ClipperLib.PolyFillType.pftNonZero,
    );
    return result;
  };
  for (const object of topFirst) {
    if (!remaining.length) {
      break;
    }
    const [left, top, right, bottom] = object.bounds;
    if (
      right < region.bounds.left ||
      left > region.bounds.right ||
      bottom < region.bounds.top ||
      top > region.bounds.bottom
    ) {
      continue;
    }
    // Clipper's documented hiRange is 2^52-1. Reject malformed imported
    // geometry before the library's alert/throw error path can affect a gesture.
    if (
      object.paths.some((part) =>
        part.points.some(
          (point) =>
            Math.abs((point[0] - origin[0]) * scale) > 1e14 ||
            Math.abs((point[1] - origin[1]) * scale) > 1e14,
        ),
      )
    ) {
      continue;
    }
    const closed = object.paths
      .filter((part) => part.closed && part.points.length >= 3)
      .map((part) => part.points.map(integer));
    if (
      closed.length &&
      operation(closed, ClipperLib.ClipType.ctIntersection).length
    ) {
      add(object);
      remaining = operation(closed, ClipperLib.ClipType.ctDifference);
    } else if (
      object.paths.some((part) => !part.closed && part.points.some(contains))
    ) {
      add(object);
    }
  }
  return selected;
};
