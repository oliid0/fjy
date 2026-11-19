import { simplify } from "points-on-curve";

import {
  polygonFromPoints,
  lineSegment,
  polygonIncludesPointNonZero,
} from "@fcboard/math";

import { type Bounds } from "@fcboard/common";

import {
  computeBoundTextPosition,
  doBoundsIntersect,
  getBoundTextElement,
  getElementBounds,
  getElementLineSegments,
  intersectElementWithLineSegment,
  isPointInElement,
  shouldTestInside,
} from "@fcboard/element";

import type {
  ElementsSegmentsMap,
  GlobalPoint,
  LineSegment,
} from "@fcboard/math/types";
import type { ElementsMap, FcboardElement } from "@fcboard/element/types";

export const getLassoBounds = (path: GlobalPoint[], padding = 0): Bounds => {
  const bounds = path.reduce<Bounds>(
    (value, point) => [
      Math.min(value[0], point[0]),
      Math.min(value[1], point[1]),
      Math.max(value[2], point[0]),
      Math.max(value[3], point[1]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
  return [
    bounds[0] - padding,
    bounds[1] - padding,
    bounds[2] + padding,
    bounds[3] + padding,
  ];
};

export const getLassoSelectedElementIds = (input: {
  lassoPath: GlobalPoint[];
  elements: readonly FcboardElement[];
  elementsMap: ElementsMap;
  elementsSegments: ElementsSegmentsMap;
  intersectedElements: Set<FcboardElement["id"]>;
  enclosedElements: Set<FcboardElement["id"]>;
  simplifyDistance?: number;
}): {
  selectedElementIds: string[];
} => {
  const {
    lassoPath,
    elements,
    elementsMap,
    elementsSegments,
    intersectedElements,
    enclosedElements,
    simplifyDistance,
  } = input;
  // simplify the path to reduce the number of points
  let path: GlobalPoint[] = lassoPath;
  if (simplifyDistance) {
    path = simplify(lassoPath, simplifyDistance) as GlobalPoint[];
  }
  if (!path.length) {
    intersectedElements.clear();
    enclosedElements.clear();
    return { selectedElementIds: [] };
  }
  const lassoPolygon = polygonFromPoints(path);
  const lassoSegments = path
    .slice(1)
    .map((point, index) => lineSegment(path[index], point))
    .concat([lineSegment(path[path.length - 1], path[0])]);
  const unlockedElements = elements.filter((el) => !el.locked && !el.isDeleted);
  // as the path might not enclose a shape anymore, clear before checking
  enclosedElements.clear();
  intersectedElements.clear();
  const lassoBounds = getLassoBounds(lassoPath);
  for (const element of unlockedElements) {
    // First check if the lasso segment intersects the element's axis-aligned
    // bounding box as it is much faster than checking intersection against
    // the element's shape
    const elementBounds = getElementBounds(element, elementsMap);

    if (
      doBoundsIntersect(lassoBounds, elementBounds) &&
      !intersectedElements.has(element.id) &&
      !enclosedElements.has(element.id)
    ) {
      // A word circle can be wholly inside a text/image object without
      // touching its outer corners or edges (TextShape/ImageShape in x.apk).
      const inside =
        shouldTestInside(element) &&
        path.some((point) => isPointInElement(point, element, elementsMap));
      if (inside) {
        enclosedElements.add(element.id);
        continue;
      }
      // Only actual bounds candidates need sampled curves. Callers retain this
      // map for the current gesture and invalidate mutations, never every ink.
      if (!elementsSegments.has(element.id)) {
        elementsSegments.set(
          element.id,
          getElementLineSegments(element, elementsMap),
        );
      }
      const enclosed = enclosureTest(lassoPolygon, element, elementsSegments);
      if (enclosed) {
        enclosedElements.add(element.id);
      } else {
        const intersects = intersectionTest(
          lassoSegments,
          element,
          elementsMap,
        );
        if (intersects) {
          intersectedElements.add(element.id);
        }
      }
    }
  }

  const results = [...intersectedElements, ...enclosedElements];

  return {
    selectedElementIds: results,
  };
};

const enclosureTest = (
  lassoPolygon: ReturnType<typeof polygonFromPoints>,
  element: FcboardElement,
  elementsSegments: ElementsSegmentsMap,
): boolean => {
  const segments = elementsSegments.get(element.id);
  if (!segments) {
    return false;
  }

  return segments.some((segment) => {
    return segment.some((point) =>
      polygonIncludesPointNonZero(point, lassoPolygon),
    );
  });
};

const intersectionTest = (
  lassoSegments: LineSegment<GlobalPoint>[],
  element: FcboardElement,
  elementsMap: ElementsMap,
): boolean => {
  const boundTextElement = getBoundTextElement(element, elementsMap);

  return lassoSegments.some(
    (lassoSegment) =>
      intersectElementWithLineSegment(
        element,
        elementsMap,
        lassoSegment,
        0,
        true,
      ).length > 0 ||
      (!!boundTextElement &&
        intersectElementWithLineSegment(
          {
            ...boundTextElement,
            ...computeBoundTextPosition(element, boundTextElement, elementsMap),
          },
          elementsMap,
          lassoSegment,
          0,
          true,
        ).length > 0),
  );
};
