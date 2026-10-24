import { getCommonBounds } from "@excalidraw/element";

import { configureSolid, solidDefaults, solidShapes } from "./solids";
import { readWidgets, renderWidget, widgetDefaults } from "./widgets";
import { sceneAPI } from "./test/scene";

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
