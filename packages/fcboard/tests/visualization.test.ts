import { comparisonVisualization } from "../../../app/fcboard/test/comparisonVisualization";
import {
  createVisualizationView,
  validateVisualization,
  visualizationSvg,
  vega,
} from "../visualizationRuntime";
import { visualizationHtml } from "../visualizationHtml";

const population = {
  mode: "vega-lite" as const,
  spec: {
    width: 550,
    height: 400,
    title: "Theoretical population growth",
    data: {
      values: [
        { time: 0, population: 100, model: "Exponential" },
        { time: 10, population: 200, model: "Exponential" },
        { time: 0, population: 100, model: "Logistic" },
        { time: 10, population: 180, model: "Logistic" },
      ],
    },
    mark: { type: "line", point: true },
    encoding: {
      x: { field: "time", type: "quantitative", title: "Time (Years)" },
      y: { field: "population", type: "quantitative", title: "Population" },
      color: { field: "model", type: "nominal" },
      tooltip: [{ field: "model" }, { field: "time" }, { field: "population" }],
    },
    params: [
      {
        name: "zoom",
        select: { type: "interval", encodings: ["x", "y"] },
        bind: "scales",
      },
    ],
  },
};

it("uses the pinned Vega runtime and compiles a real multi-series population chart offline", async () => {
  expect(vega.version).toBe("6.4.0");
  const svg = new DOMParser().parseFromString(
    await visualizationSvg(population),
    "image/svg+xml",
  );
  expect(svg.querySelector("parsererror")).toBeNull();
  expect(svg.querySelectorAll(".mark-line path")).toHaveLength(2);
  expect(svg.documentElement.textContent).toContain("Exponential");
  expect(svg.documentElement.textContent).toContain("Logistic");
  expect(svg.documentElement.textContent).toContain("Time (Years)");
});

it("supports non-function bar charts and releases the real embed view", async () => {
  const target = document.createElement("div");
  const result = await createVisualizationView(target, {
    mode: "vega-lite",
    spec: {
      data: {
        values: [
          { category: "A", value: 3 },
          { category: "B", value: 7 },
        ],
      },
      mark: "bar",
      encoding: {
        x: { field: "category", type: "nominal" },
        y: { field: "value", type: "quantitative" },
      },
    },
  });
  expect(target.querySelectorAll(".role-mark path").length).toBeGreaterThan(1);
  const finalize = vi.spyOn(result.view, "finalize");
  result.finalize();
  expect(finalize).toHaveBeenCalledOnce();
});

it("assembles the three built-in runtimes inside the isolated no-eval resource", async () => {
  const html = await visualizationHtml({
    id: "population",
    title: "Population",
    html: '<html><body><main id="fc-vega"><svg><text>Population</text></svg></main></body></html>',
    visualization: population,
  });
  const document = new DOMParser().parseFromString(html, "text/html");
  expect(document.querySelector("script[src]")).toBeNull();
  expect(
    document
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute("content"),
  ).not.toContain("unsafe-eval");
  expect(document.querySelectorAll("script").length).toBeGreaterThanOrEqual(5);
  expect(html).toContain("ast:true");
  expect(html).toContain("result.finalize()");
});

it.each([
  { data: { url: "https://example.com/data.csv" }, mark: "bar" },
  { data: [{ transform: [{ type: "sequence", start: 0, stop: 1e10 }] }] },
  { data: { values: new Array(5001).fill({ x: 1 }) } },
  { data: { values: [{ x: Infinity }] } },
])("rejects external data and excessive work before rendering", (spec) => {
  expect(() => validateVisualization({ mode: "vega-lite", spec })).toThrow();
});

it("renders the user's comparison as a blue line, two separate orange branches and labelled true intersections", async () => {
  const svg = new DOMParser().parseFromString(
    await visualizationSvg(comparisonVisualization),
    "image/svg+xml",
  );
  expect(
    svg.querySelectorAll('.mark-line path[stroke="#1f77b4"]'),
  ).toHaveLength(1);
  const reciprocal = [
    ...svg.querySelectorAll('.mark-line path[stroke="#ff7f0e"]'),
  ];
  expect(reciprocal).toHaveLength(2);
  for (const branch of reciprocal) {
    expect(branch.getAttribute("d")!.match(/M/g) || []).toHaveLength(1);
    expect(
      (branch.getAttribute("d")!.match(/L/g) || []).length,
    ).toBeGreaterThan(80);
  }
  expect(svg.documentElement.textContent).toContain("A (0.62, 1.62)");
  expect(svg.documentElement.textContent).toContain("B (-1.62, -0.62)");
  expect(svg.querySelectorAll('.mark-symbol path[fill="red"]')).toHaveLength(2);
  expect(svg.querySelectorAll("clipPath").length).toBeGreaterThan(0);
});

it.each([
  {
    title: "Known locations",
    width: 400,
    height: 300,
    projection: { type: "equalEarth" },
    layer: [
      { data: { sphere: true }, mark: { type: "geoshape", fill: "aliceblue" } },
      {
        data: { graticule: true },
        mark: { type: "geoshape", stroke: "gray", strokeWidth: 0.3 },
      },
      {
        data: {
          values: [{ name: "London", longitude: -0.1276, latitude: 51.5072 }],
        },
        mark: "circle",
        encoding: {
          longitude: { field: "longitude", type: "quantitative" },
          latitude: { field: "latitude", type: "quantitative" },
          tooltip: { field: "name" },
        },
      },
    ],
  },
  {
    title: "Multiple views",
    data: {
      values: [
        { group: "A", x: 0, y: 1 },
        { group: "B", x: 1, y: 2 },
      ],
    },
    hconcat: [
      {
        mark: "bar",
        encoding: {
          x: { field: "group", type: "nominal" },
          y: { field: "y", type: "quantitative" },
        },
      },
      {
        mark: "point",
        encoding: {
          x: { field: "x", type: "quantitative" },
          y: { field: "y", type: "quantitative" },
        },
      },
    ],
  },
])("renders projected maps and composed charts offline", async (spec) => {
  const svg = await visualizationSvg({ mode: "vega-lite", spec });
  expect(svg).toContain(spec.title);
  expect(
    new DOMParser()
      .parseFromString(svg, "image/svg+xml")
      .querySelectorAll(".role-mark path").length,
  ).toBeGreaterThan(1);
});

it("supports the native Vega mode with bounded formula-generated data", async () => {
  const svg = await visualizationSvg({
    mode: "vega",
    spec: {
      width: 200,
      height: 150,
      data: [
        {
          name: "curve",
          transform: [
            { type: "sequence", start: 0, stop: 100, step: 1, as: "x" },
            { type: "formula", expr: "datum.x*datum.x/100", as: "y" },
          ],
        },
      ],
      marks: [
        {
          type: "line",
          from: { data: "curve" },
          encode: {
            update: {
              x: { field: "x" },
              y: { field: "y" },
              stroke: { value: "blue" },
            },
          },
        },
      ],
    },
  });
  expect(svg).toContain('stroke="blue"');
});

it.each([
  { start: -1, stop: 1e9, step: 0.01 },
  { start: 0, stop: 10, step: 0 },
  { stop: { signal: "n" } },
  { start: 0, stop: 10, step: -1 },
])(
  "rejects an unbounded or invalid Vega-Lite sequence before model data is evaluated",
  (sequence) => {
    expect(() =>
      validateVisualization({
        mode: "vega-lite",
        spec: { data: { sequence }, mark: "line" },
      }),
    ).toThrow();
  },
);

it("rejects an empty chart rather than saving only its title and axes", async () => {
  await expect(
    visualizationSvg({
      mode: "vega-lite",
      spec: {
        title: "Empty",
        data: { values: [] },
        mark: "line",
        encoding: {
          x: { field: "x", type: "quantitative" },
          y: { field: "y", type: "quantitative" },
        },
      },
    }),
  ).rejects.toThrow("no data marks");
});
