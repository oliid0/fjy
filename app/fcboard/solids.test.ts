import { getCommonBounds } from "@excalidraw/element";

import { configureSolid, solidDefaults, solidShapes } from "./solids";
import { readWidgets, renderWidget, widgetDefaults } from "./widgets";
import { sceneAPI } from "./test/scene";
import { contentViewport } from "./board";
import { factorySolidOutlines } from "./factorySolidOutlines";

it.each([
  ["sphere", 3, 1, 180, 180],
  ["cone", 3, 1, 180, 200],
  ["frustum", 5, 1, 180, 175],
  ["prism", 2, 1, 180, 200],
  ["pyramid", 3, 2, 180, 180],
] as const)(
  "uses the APK silhouette, hidden paths and ink color for %s",
  (kind, count, hidden, width, height) => {
    const shapes = factorySolidOutlines(
      kind,
      { ...solidDefaults(), stroke: "#dc2626" },
      1,
      0,
    );
    expect(shapes).toHaveLength(count);
    expect(
      shapes.filter((shape) => shape.strokeStyle === "dashed"),
    ).toHaveLength(hidden);
    expect(shapes.every((shape) => shape.strokeColor === "#dc2626")).toBe(true);
    const points = shapes.flatMap((shape) =>
      (shape.type === "line" ? shape.points || [] : []).map(([x, y]) => [
        (shape.x || 0) + x,
        (shape.y || 0) + y,
      ]),
    );
    expect(
      Math.max(...points.map(([x]) => x)) - Math.min(...points.map(([x]) => x)),
    ).toBeCloseTo(width);
    expect(
      Math.max(...points.map(([, y]) => y)) -
        Math.min(...points.map(([, y]) => y)),
    ).toBeCloseTo(height);
  },
);

it("matches the factory cube with twelve edges, three hidden edges and six persistent faces", () => {
  const shapes = solidShapes("cube", solidDefaults());
  const faces = shapes.filter((shape) => shape.customData?.fcSolidFace);
  const edges = shapes.filter((shape) => !shape.customData?.fcSolidFace);
  expect(faces).toHaveLength(6);
  expect(edges).toHaveLength(12);
  expect(edges.filter((shape) => shape.strokeStyle === "dashed")).toHaveLength(
    3,
  );
  expect(edges.every((shape) => shape.strokeColor === "#17243c")).toBe(true);
});

it("preserves independent face colors, net choice and editability across fold poses", () => {
  const api = sceneAPI();
  const params = widgetDefaults();
  params.solid = configureSolid(params.solid, {
    colors: { front: "#245bd6", right: "#ef4444" },
    net: 8,
  });
  const widget = {
    id: "solid",
    kind: "cube" as const,
    params,
    position: { x: 200, y: 200 },
  };
  renderWidget(api, widget);
  const original = readWidgets(api)[0];
  renderWidget(api, {
    ...original,
    params: {
      ...original.params,
      solid: { ...original.params.solid, unfold: 1 },
    },
  });
  const restored = readWidgets(api)[0];
  expect(restored.params.solid).toEqual({ ...params.solid, unfold: 1 });
  const faces = api
    .getSceneElements()
    .filter((shape) => shape.customData?.fcSolidFace);
  expect(
    faces.find((shape) => shape.customData?.fcSolidFace === "front")
      ?.backgroundColor,
  ).toBe("#245bd6");
  expect(
    faces.find((shape) => shape.customData?.fcSolidFace === "right")
      ?.backgroundColor,
  ).toBe("#ef4444");
  expect(
    new Set(faces.map((shape) => shape.customData?.fcSolidFace)).size,
  ).toBe(6);
  expect(api.getSceneElements().some((shape) => shape.type === "image")).toBe(
    false,
  );
});

it("keeps cylinder ovals and outlines without drawing artificial panel seams", () => {
  const shapes = solidShapes("cylinder", solidDefaults());
  const edges = shapes.filter((shape) => !shape.customData?.fcSolidFace);
  expect(edges.length).toBeLessThan(10);
  expect(edges.some((shape) => shape.strokeStyle === "dashed")).toBe(true);
  const flat = solidShapes("cylinder", { ...solidDefaults(), unfold: 1 });
  expect(
    flat
      .filter((shape) => !shape.customData?.fcSolidFace)
      .every((shape) => shape.strokeStyle === "solid"),
  ).toBe(true);
});

it("retains the object and its colors when its border is hidden", () => {
  const api = sceneAPI();
  const params = widgetDefaults();
  params.solid.border = false;
  renderWidget(api, {
    id: "borderless",
    kind: "cube",
    params,
    position: { x: 200, y: 200 },
  });
  const faces = api
    .getSceneElements()
    .filter((shape) => shape.customData?.fcWidget?.id === "borderless");
  expect(faces).toHaveLength(6);
  expect(getCommonBounds(faces).every(Number.isFinite)).toBe(true);
  expect(readWidgets(api)[0].id).toBe("borderless");
  const original = solidDefaults();
  expect(() =>
    configureSolid(original, { colors: { front: "invalid" } }),
  ).toThrow();
  expect(original.colors).toEqual({});
  expect(() =>
    configureSolid(original, { colors: { inventedFace: "#123456" } }),
  ).toThrow();
  expect(() => configureSolid(original, { net: 11 })).toThrow();
});

it.each([
  [390, 844, 1],
  [800, 600, 2],
  [3080, 1240, 0.5],
])(
  "keeps all unfolding frames inside %s×%s at zoom %s",
  (width, height, zoom) => {
    const api = sceneAPI();
    vi.spyOn(api, "getAppState").mockReturnValue({
      ...api.getAppState(),
      width,
      height,
      zoom: { value: zoom as never },
      scrollX: -100,
      scrollY: -50,
    });
    const widget = {
      id: "fit",
      kind: "cube" as const,
      params: widgetDefaults(),
      position: { x: 5000, y: 5000 },
    };
    renderWidget(api, widget);
    const viewport = contentViewport(api);
    for (const unfold of [0.2, 0.5, 0.8, 1, 0]) {
      const current = readWidgets(api)[0];
      const elements = renderWidget(api, {
        ...current,
        params: {
          ...current.params,
          solid: { ...current.params.solid, unfold },
        },
      });
      const [left, top, right, bottom] = getCommonBounds(elements);
      expect(left).toBeGreaterThanOrEqual(viewport.left - 1e-7);
      expect(top).toBeGreaterThanOrEqual(viewport.top - 1e-7);
      expect(right).toBeLessThanOrEqual(viewport.right + 1e-7);
      expect(bottom).toBeLessThanOrEqual(viewport.bottom + 1e-7);
    }
  },
);
