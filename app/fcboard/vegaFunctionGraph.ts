import type { DataURL } from "@fcboard/fcboard/types";
import type { Spec } from "@fcboard/fcboard/visualizationRuntime";

import { functionGeometry } from "./functionGeometry";
import { functionColors, plotSize } from "./functionVisualization";
import { functionView } from "./math";

import type { Plot } from "./math";

/** The numeric engine supplies real branches. Vega renders the data, axes and labels. */
export const vegaFunctionSpec = (plot: Plot): Spec => {
  const { left, right, bottom, top } = functionView(plot);
  const { curves, intersections } = functionGeometry(plot);
  const width = plotSize.width - 60;
  const height = plotSize.height - 40;
  const chartColor = "#64748b";
  return {
    width,
    height,
    padding: { left: 40, right: 20, top: 20, bottom: 20 },
    autosize: "none",
    data: [
      {
        name: "curves",
        values: curves.flatMap(({ lines }, series) =>
          lines.flatMap((line, branch) =>
            line.map(([x, y]) => ({
              x,
              y,
              series,
              branch,
              color: functionColors[series],
            })),
          ),
        ),
      },
      { name: "intersections", values: intersections },
      {
        name: "labels",
        values: curves.flatMap(({ expression, lines }, series) => {
          const last = lines.at(-1)?.at(-1);
          return last
            ? [
                {
                  x: last[0],
                  y: last[1],
                  label: `y = ${expression}`,
                  color: functionColors[series],
                },
              ]
            : [];
        }),
      },
    ],
    scales: [
      {
        name: "x",
        type: "linear",
        range: "width",
        domain: [left, right],
        zero: false,
      },
      {
        name: "y",
        type: "linear",
        range: "height",
        domain: [bottom, top],
        zero: false,
      },
    ],
    axes: [
      {
        scale: "x",
        orient: "bottom",
        grid: true,
        gridOpacity: 0.18,
        labelColor: chartColor,
        tickCount: 8,
      },
      {
        scale: "y",
        orient: "left",
        grid: true,
        gridOpacity: 0.18,
        labelColor: chartColor,
        tickCount: 8,
      },
    ],
    marks: [
      {
        type: "group",
        from: {
          facet: {
            name: "curve",
            data: "curves",
            groupby: ["series", "branch"],
          },
        },
        encode: {
          update: { width: { value: width }, height: { value: height } },
        },
        marks: [
          {
            type: "line",
            from: { data: "curve" },
            clip: true,
            encode: {
              update: {
                x: { scale: "x", field: "x" },
                y: { scale: "y", field: "y" },
                stroke: { field: "color" },
                strokeWidth: { value: 2 },
              },
            },
          },
        ],
      },
      {
        type: "symbol",
        from: { data: "intersections" },
        encode: {
          update: {
            x: { scale: "x", field: "x" },
            y: { scale: "y", field: "y" },
            fill: { value: chartColor },
            size: { value: 40 },
          },
        },
      },
      {
        type: "text",
        from: { data: "labels" },
        clip: true,
        encode: {
          update: {
            x: { scale: "x", field: "x", offset: -4 },
            y: { scale: "y", field: "y", offset: -8 },
            align: { value: "right" },
            fill: { field: "color" },
            text: { field: "label" },
          },
        },
      },
    ],
  };
};

export const vegaFunctionImage = async (plot: Plot): Promise<DataURL> => {
  const { createInlineVegaView } = await import(
    "@fcboard/fcboard/visualizationRuntime"
  );
  const view = createInlineVegaView(vegaFunctionSpec(plot));
  try {
    const canvas = await view.toCanvas(2);
    return canvas.toDataURL("image/png") as DataURL;
  } finally {
    view.finalize();
  }
};
