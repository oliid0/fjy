/** The user's comparison, with formula-evaluated dense samples and explicit
 * reciprocal branches, following the supplied layered Vega-Lite examples. */
export const comparisonVisualization = {
  mode: "vega-lite" as const,
  spec: {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    title: "y = x + 1 与 y = 1/x",
    width: 500,
    height: 400,
    encoding: {
      x: { field: "x", type: "quantitative", scale: { domain: [-4, 4] } },
      y: { field: "y", type: "quantitative", scale: { domain: [-4, 4] } },
    },
    params: [
      {
        name: "zoom",
        select: { type: "interval", encodings: ["x", "y"] },
        bind: "scales",
        views: ["curves"],
      },
    ],
    layer: [
      {
        name: "curves",
        data: { sequence: { start: -4, stop: 4.02, step: 0.04, as: "x" } },
        transform: [
          { calculate: "datum.x+1", as: "linear" },
          {
            calculate: "abs(datum.x)<1e-9 ? null : 1/datum.x",
            as: "reciprocal",
          },
          { fold: ["linear", "reciprocal"], as: ["formula", "y"] },
          {
            calculate: "datum.formula==='linear' ? 'y = x + 1' : 'y = 1/x'",
            as: "series",
          },
          {
            calculate:
              "datum.formula==='linear' ? 'linear' : datum.x<0 ? 'negative' : 'positive'",
            as: "branch_id",
          },
          { filter: "isValid(datum.y)" },
        ],
        mark: { type: "line", clip: true },
        encoding: {
          color: {
            field: "series",
            type: "nominal",
            scale: {
              domain: ["y = x + 1", "y = 1/x"],
              range: ["#1f77b4", "#ff7f0e"],
            },
          },
          detail: { field: "branch_id", type: "nominal" },
          order: { field: "x", type: "quantitative" },
          tooltip: [
            { field: "series" },
            { field: "x", type: "quantitative" },
            { field: "y", type: "quantitative" },
          ],
        },
      },
      {
        data: {
          values: [
            { x: (-1 + Math.sqrt(5)) / 2, label: "A (0.62, 1.62)" },
            { x: (-1 - Math.sqrt(5)) / 2, label: "B (-1.62, -0.62)" },
          ],
        },
        transform: [{ calculate: "datum.x+1", as: "y" }],
        layer: [
          { mark: { type: "point", filled: true, color: "red", size: 60 } },
          {
            mark: { type: "text", align: "left", dx: 8, dy: -8 },
            encoding: { text: { field: "label" } },
          },
        ],
      },
    ],
  },
};
