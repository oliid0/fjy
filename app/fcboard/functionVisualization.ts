import { getDataURL_sync } from "@fcboard/fcboard/data/blob";
import {
  vega,
  inlineVisualizationLoader,
  createInlineVegaView,
} from "@fcboard/fcboard/visualizationRuntime";

import type {
  Spec,
  VisualizationView,
} from "@fcboard/fcboard/visualizationRuntime";

import { compileExpression, functionView, sampleFunctionCurve } from "./math";

import type { Plot } from "./math";

export const plotSize = { width: 500, height: 440 };
export const releaseFunctionGraph = (view: VisualizationView) => {
  view.finalize();
};

/** Function mathematics stays in the bounded adaptive sampler. Vega owns the
 * same transparent vector scene used for saving, exports and point gestures. */
export const renderFunctionGraph = (
  target: HTMLElement,
  plot: Plot,
  color: string,
  size = plotSize,
) => {
  if (
    plot.surface ||
    plot.relation ||
    !Number.isFinite(plot.range) ||
    plot.range <= 0 ||
    plot.range > 1000
  ) {
    throw new Error("Invalid two-dimensional function graph");
  }
  const domain = functionView(plot);
  const segments = sampleFunctionCurve(plot.expression, domain, plot);
  if (!segments.length && !plot.view) {
    throw new Error("No real-valued plot in this range");
  }
  const axis = {
    grid: false,
    domainColor: color,
    tickColor: color,
    labelColor: color,
    titleColor: color,
    labelFont: "Arial",
    titleFont: "Arial",
    titleFontWeight: "normal",
  };
  const spec: Spec = {
    width: size.width - 60,
    height: size.height - 40,
    padding: { left: 40, right: 20, top: 20, bottom: 20 },
    autosize: "none",
    background: null,
    data: segments.map((points, index) => ({
      name: `curve${index}`,
      values: points.map(([x, y]) => ({ x, y })),
    })),
    scales: [
      {
        name: "x",
        type: "linear",
        domain: [domain.left, domain.right],
        range: "width",
        zero: false,
        nice: false,
      },
      {
        name: "y",
        type: "linear",
        domain: [domain.bottom, domain.top],
        range: "height",
        zero: false,
        nice: false,
      },
    ],
    axes: [
      {
        ...axis,
        scale: "x",
        orient: "bottom",
        offset: { signal: "clamp(scale('y',0),0,height)-height" },
        title: "x",
        titleAnchor: "end",
        tickCount: 8,
      },
      {
        ...axis,
        scale: "y",
        orient: "left",
        offset: { signal: "-clamp(scale('x',0),0,width)" },
        title: "y",
        titleAnchor: "end",
        titleAngle: 0,
        tickCount: 8,
      },
    ],
    marks: segments.map((_, index) => ({
      type: "line",
      from: { data: `curve${index}` },
      clip: true,
      encode: {
        update: {
          x: { scale: "x", field: "x" },
          y: { scale: "y", field: "y" },
          stroke: { value: color },
          strokeWidth: { value: 2 },
          strokeCap: { value: "round" },
          strokeJoin: { value: "round" },
        },
      },
    })),
  };
  const loader = inlineVisualizationLoader();
  const view = createInlineVegaView(spec);
  try {
    // Inline values evaluate synchronously, while View's DOM renderer waits
    // for a microtask. Use Vega's public string renderer for synchronous object
    // insertion; serializing the initial DOM SVG would save an empty graph.
    view.run();
    const svg = new vega.SVGStringRenderer(loader)
      .initialize(null, size.width, size.height, [40, 20])
      .render(view.scenegraph().root)
      .svg();
    if (!svg) {
      throw new Error("The function graph could not be rendered");
    }
    target.innerHTML = svg;
    return view;
  } catch (failure) {
    view.finalize();
    target.replaceChildren();
    throw failure;
  }
};

export const functionGraphImage = (plot: Plot, color: string) => {
  const target = document.createElement("div");
  let view: VisualizationView | undefined;
  try {
    view = renderFunctionGraph(target, plot, color);
    return getDataURL_sync(
      new XMLSerializer().serializeToString(target.querySelector("svg")!),
      "image/svg+xml",
    );
  } finally {
    view?.finalize();
    target.replaceChildren();
  }
};

// The Vega view uses this padding. Normalised coordinates keep pointer math
// correct after the saved image is resized or rotated.
export const functionGraphLocation = (u: number, v: number) => ({
  x: (u * plotSize.width - 40) / (plotSize.width - 60),
  y: 1 - (v * plotSize.height - 20) / (plotSize.height - 40),
});

export const zoomFunctionGraph = (
  plot: Plot,
  factor: number,
  from: { x: number; y: number },
  to = from,
): Plot => {
  const view = functionView(plot);
  factor = Math.max(0.05, Math.min(20, factor));
  const width = Math.min(
    2000,
    Math.max(0.0002, (view.right - view.left) / factor),
  );
  const height = Math.min(
    2000,
    Math.max(0.0002, (view.top - view.bottom) / factor),
  );
  const left = view.left + from.x * (view.right - view.left) - to.x * width;
  const bottom =
    view.bottom + from.y * (view.top - view.bottom) - to.y * height;
  if (
    ![left, bottom, left + width, bottom + height].every(
      (value) => Number.isFinite(value) && Math.abs(value) <= 1e6,
    )
  ) {
    return plot;
  }
  return {
    ...plot,
    range: Math.max(width, height) / 2,
    view: { left, right: left + width, bottom, top: bottom + height },
  };
};

export const pickFunctionPoint = (
  plot: Plot,
  location: { x: number; y: number },
  size: { width: number; height: number },
) => {
  if (location.x < 0 || location.x > 1 || location.y < 0 || location.y > 1) {
    return null;
  }
  const view = functionView(plot);
  const width = (size.width * (plotSize.width - 60)) / plotSize.width;
  const height = (size.height * (plotSize.height - 40)) / plotSize.height;
  const pixel = ([x, y]: number[]) => [
    ((x - view.left) / (view.right - view.left)) * width,
    ((y - view.bottom) / (view.top - view.bottom)) * height,
  ];
  const target = [location.x * width, location.y * height];
  let best: { x: number; distance: number } | undefined;
  for (const segment of sampleFunctionCurve(plot.expression, view, plot)) {
    for (let index = 1; index < segment.length; index++) {
      const a = pixel(segment[index - 1]);
      const b = pixel(segment[index]);
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const t = Math.max(
        0,
        Math.min(
          1,
          ((target[0] - a[0]) * dx + (target[1] - a[1]) * dy) /
            (dx * dx + dy * dy || 1),
        ),
      );
      const distance = Math.hypot(
        target[0] - a[0] - dx * t,
        target[1] - a[1] - dy * t,
      );
      if (distance <= 10 && (!best || distance < best.distance)) {
        best = {
          x:
            segment[index - 1][0] +
            t * (segment[index][0] - segment[index - 1][0]),
          distance,
        };
      }
    }
  }
  if (!best) {
    return null;
  }
  const y = compileExpression(plot.expression).evaluate({ ...plot, x: best.x });
  return typeof y === "number" && Number.isFinite(y)
    ? { x: best.x, y: y + plot.z }
    : null;
};
