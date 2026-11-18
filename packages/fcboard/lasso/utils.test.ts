import * as geometry from "@fcboard/element";
import { pointFrom } from "@fcboard/math";

import type { ElementsSegmentsMap } from "@fcboard/math";
import type { FcboardElement } from "@fcboard/element/types";

import { API } from "../tests/helpers/api";

import { getLassoSelectedElementIds } from "./utils";

const path = (left: number, top: number, right: number, bottom: number) => [
  pointFrom<import("@fcboard/math").GlobalPoint>(left, top),
  pointFrom<import("@fcboard/math").GlobalPoint>(right, top),
  pointFrom<import("@fcboard/math").GlobalPoint>(right, bottom),
  pointFrom<import("@fcboard/math").GlobalPoint>(left, bottom),
];
const select = (
  elements: FcboardElement[],
  lassoPath: ReturnType<typeof path>,
  segments: ElementsSegmentsMap = new Map(),
) =>
  getLassoSelectedElementIds({
    lassoPath,
    elements,
    elementsMap: new Map(elements.map((element) => [element.id, element])),
    elementsSegments: segments,
    intersectedElements: new Set(),
    enclosedElements: new Set(),
  }).selectedElementIds;
afterEach(() => vi.restoreAllMocks());

it.each(["text", "image"] as const)(
  "selects a small word circle wholly inside a %s object without touching its corners or edges",
  (type) => {
    const element =
      type === "text"
        ? API.createElement({
            type,
            text: "A sentence with several words",
            fontSize: 80,
            x: 0,
            y: 0,
          })
        : API.createElement({ type, width: 700, height: 300, x: 0, y: 0 });
    const segments = new Map();
    expect(select([element], path(40, 15, 80, 45), segments)).toEqual([
      element.id,
    ]);
    expect(segments.size).toBe(0);
  },
);

it("uses actual occupied geometry and preserves empty outlined interiors and separate object identities", () => {
  const outline = API.createElement({
    type: "rectangle",
    x: 0,
    y: 0,
    width: 300,
    height: 300,
    backgroundColor: "transparent",
  });
  const filled = API.createElement({
    type: "ellipse",
    x: 400,
    y: 0,
    width: 300,
    height: 300,
    backgroundColor: "#ffffff",
  });
  expect(select([outline, filled], path(100, 100, 200, 200))).toEqual([]);
  expect(select([outline, filled], path(500, 100, 600, 200))).toEqual([
    filled.id,
  ]);
  expect(new Set(select([outline, filled], path(-20, -20, 720, 320)))).toEqual(
    new Set([outline.id, filled.id]),
  );
});

it("expands only bounds candidates and reuses the current gesture's geometry instead of every off-region stroke", () => {
  const target = API.createElement({
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
  });
  const others = Array.from({ length: 250 }, (_, index) =>
    API.createElement({
      type: "freedraw",
      x: 1000 + index * 20,
      y: 1000,
      points: Array.from({ length: 256 }, (_, point) =>
        pointFrom<import("@fcboard/math").LocalPoint>(point, point % 40),
      ),
    }),
  );
  const sample = vi.spyOn(geometry, "getElementLineSegments");
  const segments = new Map();
  expect(
    select([target, ...others], path(-10, -10, 110, 110), segments),
  ).toEqual([target.id]);
  expect(sample).toHaveBeenCalledTimes(1);
  expect(
    select([target, ...others], path(-20, -20, 120, 120), segments),
  ).toEqual([target.id]);
  expect(sample).toHaveBeenCalledTimes(1);
  expect([...segments.keys()]).toEqual([target.id]);
});

it("does not retain stale hit sets for an empty path or select locked/deleted objects", () => {
  const locked = API.createElement({
    type: "image",
    width: 200,
    height: 200,
    locked: true,
  });
  const deleted = {
    ...API.createElement({ type: "image", width: 200, height: 200 }),
    isDeleted: true,
  };
  expect(select([locked, deleted], path(20, 20, 40, 40))).toEqual([]);
  expect(select([locked, deleted], [])).toEqual([]);
});
