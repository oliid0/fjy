import {
  compileSourceFunction,
  validSourceFunction,
  functionPresets,
  sampleSourceFunction,
  functionGraphNodes,
  functionGraphSvg,
  defaultGraphTransform,
  nextFunctionColor,
  zoomGraph,
  clampGraph,
  isFunctionGraphData,
} from "./functionGraphData";

import type { FunctionItem } from "./functionGraphData";

it("uses the original expression grammar, constants, base-ten log and invalid-domain rules", () => {
  for (const [expression, x, result] of [
    ["y=（x^2+2*x+1）", 2, 9],
    ["sin(pi/2)", 0, 1],
    ["ln(e)", 0, 1],
    ["log(100)", 0, 2],
    ["log10(1000)", 0, 3],
    ["abs(-3)+sqrt(4)", 0, 5],
    ["2^3^2", 0, 64],
  ] as const) {
    expect(compileSourceFunction(expression)(x)).toBeCloseTo(result);
  }
  expect(compileSourceFunction("1/x")(1e-8)).toBeNaN();
  expect(compileSourceFunction("sqrt(x)")(-1)).toBeNaN();
  expect(validSourceFunction("sqrt(x)")).toBe(true);
  for (const expression of [
    "",
    "window.alert(1)",
    "a*x",
    "sqrt(-5)",
    "sin(x",
    "x) + (x",
  ]) {
    expect(validSourceFunction(expression)).toBe(false);
  }
});

it("keeps all source presets, splits invalid samples and screen excursions, and exports the current coordinate system", () => {
  const functions = functionPresets.map((preset) => ({
    ...preset,
    name: preset.key,
    color: "#0b5fff",
  }));
  const reciprocal = sampleSourceFunction(functions[2]);
  expect(reciprocal.points).toHaveLength(1001);
  expect(reciprocal.points[500]).toBeNull();
  expect(sampleSourceFunction(functions[4]).points[500]).toBeNull();
  const data = {
    ...defaultGraphTransform,
    width: 500,
    height: 400,
    functions: [functions[2]],
  };
  const path = functionGraphNodes(data, [reciprocal]).find(
    (node) => node.tag === "path",
  )!;
  expect(String(path.attrs.d).match(/M/g)?.length).toBe(2);
  const svg = new DOMParser().parseFromString(
    functionGraphSvg({ ...data, x: 40, y: -20 }),
    "image/svg+xml",
  );
  expect(svg.documentElement.getAttribute("viewBox")).toBe("0 0 500 400");
  expect(svg.querySelector("circle")?.getAttribute("cx")).toBe("290");
  expect(svg.querySelector("circle")?.getAttribute("cy")).toBe("180");
  expect(svg.querySelector('path[stroke-linecap="round"]')).not.toBeNull();
  expect(isFunctionGraphData(data)).toBe(true);
  expect(isFunctionGraphData({ ...data, unit: Infinity })).toBe(false);
});

it("keeps the math point beneath a pinch focus stationary and clamps zoom and pan to original limits", () => {
  const view = { unit: 42, x: 30, y: -10 };
  const zoomed = zoomGraph(view, 600, 500, 400, 200, 2);
  expect((400 - 300 - zoomed.x) / zoomed.unit).toBeCloseTo(
    (400 - 300 - view.x) / view.unit,
  );
  expect((250 + zoomed.y - 200) / zoomed.unit).toBeCloseTo(
    (250 + view.y - 200) / view.unit,
  );
  expect(zoomGraph(view, 600, 500, 300, 250, 100).unit).toBe(200);
  expect(zoomGraph(view, 600, 500, 300, 250, 0.001).unit).toBe(20);
  expect(clampGraph({ unit: 42, x: 1000, y: -1000 }, 600, 500)).toEqual({
    unit: 42,
    x: 600,
    y: -500,
  });
});

it("assigns distinct source colors and reuses a released color", () => {
  const items: FunctionItem[] = [];
  for (let index = 0; index < 16; index++) {
    items.push({
      id: index,
      name: "",
      expression: "x",
      color: nextFunctionColor(items),
    });
  }
  expect(new Set(items.map((item) => item.color)).size).toBe(16);
  expect(nextFunctionColor(items.slice(1))).toBe(items[0].color);
});
