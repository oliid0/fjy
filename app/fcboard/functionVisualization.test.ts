import { defaultPlot, functionView } from "./math";
import { validatedPlot } from "./mathRecognition";
import { vegaFunctionImage, vegaFunctionSpec } from "./vegaFunctionGraph";
import {
  drawFunctionGraph,
  functionColors,
  functionGraphImage,
  plotSize,
  zoomFunctionGraph,
} from "./functionVisualization";

it("keeps fitted multi-function curves connected and scales their widths only once", () => {
  const context = document.createElement("canvas").getContext("2d")!;
  const curves: { width: number; dash: number[] }[] = [];
  vi.spyOn(context, "stroke").mockImplementation(() => {
    if (
      functionColors.includes(
        String(context.strokeStyle) as typeof functionColors[number],
      )
    ) {
      curves.push({ width: context.lineWidth, dash: context.getLineDash() });
    }
  });
  const segments = vi.spyOn(context, "lineTo");
  drawFunctionGraph(
    context,
    { ...defaultPlot, expression: "x", compare: ["x^2"] },
    functionColors[0],
    plotSize,
    { width: 0.5, scale: 0.25 },
  );
  expect(curves).toHaveLength(2);
  expect(curves).toEqual([
    { width: 2, dash: [] },
    { width: 2, dash: [] },
  ]);
  expect(segments.mock.calls.length).toBeGreaterThan(80);
});

it("uses ordinary border width/dashes only on curves and keeps the canvas background transparent", () => {
  const context = document.createElement("canvas").getContext("2d")!;
  const strokes: { width: number; dash: number[]; color: string }[] = [];
  vi.spyOn(context, "stroke").mockImplementation(() => {
    strokes.push({
      width: context.lineWidth,
      dash: context.getLineDash(),
      color: String(context.strokeStyle),
    });
  });
  const fill = vi.spyOn(context, "fillRect");
  drawFunctionGraph(
    context,
    { ...defaultPlot, expression: "x" },
    "#2563eb",
    plotSize,
    { width: 6, strokeStyle: "dashed" },
  );
  expect(strokes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ width: 6, dash: [8, 14], color: "#2563eb" }),
      expect.objectContaining({ width: 1, dash: [] }),
    ]),
  );
  expect(fill).not.toHaveBeenCalled();
});

it("paints a transparent canvas/PNG with x/y axes, three curve colors and end expressions", () => {
  const context = document.createElement("canvas").getContext("2d")!;
  const labels = vi.spyOn(context, "fillText");
  const background = vi.spyOn(context, "fillRect");
  const strokes: string[] = [];
  vi.spyOn(context, "stroke").mockImplementation(() => {
    strokes.push(String(context.strokeStyle));
  });
  drawFunctionGraph(
    context,
    { ...defaultPlot, expression: "x", compare: ["x+1", "x-1"] },
    functionColors[0],
  );
  expect(background).not.toHaveBeenCalled();
  expect(strokes).toEqual(expect.arrayContaining([...functionColors]));
  const text = labels.mock.calls.map(([text]) => text);
  expect(text).toEqual(
    expect.arrayContaining(["x", "y", "y = x", "y = x+1", "y = x-1"]),
  );
  expect(
    labels.mock.calls.every(
      ([, x, y]) => Number.isFinite(x) && Number.isFinite(y),
    ),
  ).toBe(true);
  expect(functionGraphImage(defaultPlot)).toMatch(/^data:image\/png;base64,/);
});

it("paints reciprocal branches as separate paths and labels actual intersection coordinates", () => {
  const context = document.createElement("canvas").getContext("2d")!;
  const labels = vi.spyOn(context, "fillText");
  const strokes: string[] = [];
  vi.spyOn(context, "stroke").mockImplementation(() => {
    strokes.push(String(context.strokeStyle));
  });
  drawFunctionGraph(context, {
    ...defaultPlot,
    expression: "1/x",
    compare: ["x+1"],
  });
  expect(strokes.filter((color) => color === functionColors[0])).toHaveLength(
    2,
  );
  const text = labels.mock.calls.map(([text]) => text);
  expect(text).toContain("a (-1.61803, -0.618034)");
  expect(text).toContain("b (0.618034, 1.61803)");
});

it.each(["sqrt(-1)", "window.alert(1)"])(
  "rejects %s before saving a graph",
  (expression) => {
    expect(() => functionGraphImage({ ...defaultPlot, expression })).toThrow();
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

it("renders separate reciprocal branches through Vega and produces a PNG preview", async () => {
  const plot = { ...defaultPlot, expression: "1/x" };
  const { createInlineVegaView } = await import(
    "@fcboard/fcboard/visualizationRuntime"
  );
  const view = createInlineVegaView(vegaFunctionSpec(plot));
  try {
    const svg = await view.toSVG();
    const image = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(image.querySelectorAll("path[stroke='#2563eb']")).toHaveLength(2);
    expect(image.querySelector(".role-axis")).not.toBeNull();
    expect(await vegaFunctionImage(plot)).toMatch(/^data:image\/png;base64,/);
  } finally {
    view.finalize();
  }
});
