import { dataURLToString } from "@fcboard/fcboard/data/blob";

import { defaultPlot, functionView } from "./math";
import { validatedPlot } from "./mathRecognition";
import {
  functionGraphImage,
  renderFunctionGraph,
  releaseFunctionGraph,
  zoomFunctionGraph,
  pickFunctionPoint,
} from "./functionVisualization";

it("saves the supplied renderer's transparent SVG with the pen colour on axes and curves", () => {
  const image = functionGraphImage(defaultPlot, "#d32941");
  const svg = new DOMParser().parseFromString(
    dataURLToString(image),
    "image/svg+xml",
  );
  expect(svg.querySelector("parsererror")).toBeNull();
  expect(svg.documentElement.getAttribute("viewBox")).toBe("0 0 500 440");
  expect(svg.querySelectorAll(".mark-line path").length).toBeGreaterThan(0);
  expect(
    [...svg.querySelectorAll(".mark-line path")].every(
      (path) => path.getAttribute("stroke") === "#d32941",
    ),
  ).toBe(true);
  expect(
    [
      ...svg.querySelectorAll(".role-axis-domain path, .role-axis-tick line"),
    ].every((path) => path.getAttribute("stroke") === "#d32941"),
  ).toBe(true);
  expect(svg.querySelectorAll(".role-axis-grid")).toHaveLength(0);
  expect(
    [...svg.querySelectorAll("rect")].every(
      (rect) =>
        rect.getAttribute("fill") === "none" || rect.closest("clipPath"),
    ),
  ).toBe(true);
  expect(dataURLToString(image)).not.toMatch(
    /NaN|Infinity|<script|https?:\/\/[^" ]+\.js/,
  );
});

it("keeps reciprocal branches separate and finalizes the real Vega view", () => {
  const target = document.createElement("div");
  const chart = renderFunctionGraph(
    target,
    { ...defaultPlot, expression: "1/x" },
    "#000000",
  );
  expect(target.querySelectorAll(".mark-line path")).toHaveLength(2);
  const finalize = vi.spyOn(chart, "finalize");
  releaseFunctionGraph(chart);
  expect(finalize).toHaveBeenCalledOnce();
});

it.each(["sqrt(-1)", "window.alert(1)"])(
  "rejects %s before producing a saved object",
  (expression) => {
    expect(() =>
      functionGraphImage({ ...defaultPlot, expression }, "#000000"),
    ).toThrow();
  },
);

it("zooms around the touched coordinate and persists independent x/y bounds", () => {
  const plot = {
    ...defaultPlot,
    view: { left: -2, right: 4, bottom: -5, top: 6 },
  };
  const from = { x: 0.25, y: 0.8 };
  const next = zoomFunctionGraph(plot, 2, from);
  const view = functionView(next);
  expect(view.right - view.left).toBeCloseTo(3);
  expect(view.top - view.bottom).toBeCloseTo(5.5);
  expect(view.left + from.x * (view.right - view.left)).toBeCloseTo(-0.5);
  expect(view.bottom + from.y * (view.top - view.bottom)).toBeCloseTo(3.8);
  expect(validatedPlot(JSON.parse(JSON.stringify(next))).view).toEqual(
    next.view,
  );
  const panned = functionView(
    zoomFunctionGraph(plot, 1, from, { x: 0.5, y: 0.5 }),
  );
  expect(panned.left).toBeCloseTo(-3.5);
  expect(panned.bottom).toBeCloseTo(-1.7);
});

it("reports only nearby real curve points, including steep lines, and never bridges reciprocal branches", () => {
  const size = { width: 500, height: 440 };
  expect(
    pickFunctionPoint(
      { ...defaultPlot, expression: "x" },
      { x: 0.5, y: 0.5 },
      size,
    ),
  ).toEqual({ x: 0, y: 0 });
  expect(
    pickFunctionPoint(
      { ...defaultPlot, expression: "100*x" },
      { x: 0.51, y: 0.5 },
      size,
    )?.y,
  ).toBeCloseTo(0, 1);
  expect(
    pickFunctionPoint(
      { ...defaultPlot, expression: "x" },
      { x: 0.1, y: 0.9 },
      size,
    ),
  ).toBeNull();
  expect(
    pickFunctionPoint(
      { ...defaultPlot, expression: "1/x" },
      { x: 0.5, y: 0.5 },
      size,
    ),
  ).toBeNull();
});

it("allows zooming across an empty domain and rejects corrupt or unbounded saved viewports", () => {
  expect(() =>
    functionGraphImage(
      {
        ...defaultPlot,
        expression: "sqrt(x)",
        view: { left: -10, right: -1, bottom: -10, top: 10 },
      },
      "#000000",
    ),
  ).not.toThrow();
  for (const view of [
    null,
    { left: 1, right: 1, bottom: -1, top: 1 },
    { left: 0, right: 2001, bottom: -1, top: 1 },
    { left: NaN, right: 1, bottom: -1, top: 1 },
  ]) {
    expect(() => validatedPlot({ ...defaultPlot, view })).toThrow();
  }
});
