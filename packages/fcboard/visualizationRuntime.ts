// Run before dependencies that may capture structuredClone at module scope.
// eslint-disable-next-line import/order
import "./vendor/vega/compatibility.js";

import * as runtime from "vega";
import { expressionInterpreter } from "vega-interpreter";

import type { Loader, Spec, View } from "vega";
import type { Result, VisualizationSpec } from "vega-embed";

export type Visualization = {
  mode: "vega" | "vega-lite";
  spec: Record<string, unknown>;
};
export type VisualizationView = View;
export type { Spec };

// SVGStringRenderer is exported by Vega 6.4.0 but missing from vega-typings.
// Its four methods follow the installed vega-scenegraph source exactly.
export const vega = runtime as typeof runtime & {
  SVGStringRenderer: new (loader?: Loader) => {
    initialize: (
      target: null,
      width: number,
      height: number,
      origin: [number, number],
    ) => {
      render: (root: unknown) => { svg: () => string | null };
    };
  };
};

export const createInlineVegaView = (spec: Spec) =>
  new runtime.View(runtime.parse(spec, undefined, { ast: true }), {
    renderer: "none",
    loader: inlineVisualizationLoader(),
    expr: expressionInterpreter,
  });

export const validateVisualization = (value: unknown): Visualization => {
  const input = value as Partial<Visualization> | null;
  if (
    !input ||
    !["vega", "vega-lite"].includes(input.mode || "") ||
    !input.spec ||
    Array.isArray(input.spec) ||
    typeof input.spec !== "object"
  ) {
    throw new Error("Invalid visualization specification");
  }
  let nodes = 0;
  let generatedRows = 0;
  const sequence = (value: unknown) => {
    const input = value as {
      start?: number;
      stop?: number;
      step?: number;
    } | null;
    const start = input?.start ?? 0;
    const stop = input?.stop;
    const step = input?.step ?? 1;
    const count =
      typeof stop === "number" ? Math.ceil((stop - start) / step) : NaN;
    if (
      ![start, stop, step, count].every(
        (number) => typeof number === "number" && Number.isFinite(number),
      ) ||
      !step ||
      count < 1 ||
      count > 2000 ||
      (generatedRows += count) > 5000
    ) {
      throw new Error(
        "A visualization sequence needs finite numeric bounds and at most 2000 rows",
      );
    }
  };
  const walk = (item: unknown, depth = 0) => {
    if (++nodes > 30000 || depth > 32) {
      throw new Error("The visualization is too large");
    }
    if (typeof item === "number" && !Number.isFinite(item)) {
      throw new Error("Invalid visualization number");
    }
    if (item && typeof item === "object") {
      if (Array.isArray(item) && item.length > 5000) {
        throw new Error("Too many visualization data rows");
      }
      if ((item as { type?: unknown }).type === "sequence") {
        sequence(item);
      }
      for (const [key, child] of Object.entries(item)) {
        if (
          ["url", "href", "__proto__", "prototype", "constructor"].includes(key)
        ) {
          throw new Error("Visualizations must use inline data");
        }
        if (key === "sequence") {
          sequence(child);
        }
        if (
          key === "type" &&
          ["force", "cross", "timer"].includes(String(child))
        ) {
          throw new Error("Unbounded visualization transform");
        }
        if (
          (key === "events" || key === "type") &&
          typeof child === "string" &&
          /\btimer\b/.test(child)
        ) {
          throw new Error("Timer-driven visualization is not supported");
        }
        walk(child, depth + 1);
      }
    } else if (
      !["string", "number", "boolean"].includes(typeof item) &&
      item !== null
    ) {
      throw new Error("Visualizations must contain JSON data");
    }
  };
  walk(input.spec);
  const json = JSON.stringify(input.spec);
  if (json.length > 200000) {
    throw new Error("The visualization is too large");
  }
  return { mode: input.mode as Visualization["mode"], spec: JSON.parse(json) };
};

export const inlineVisualizationLoader = (): Loader => {
  const reject = () =>
    Promise.reject(new Error("External visualization data is disabled"));
  return {
    load: reject,
    http: reject,
    file: reject,
    sanitize: (uri) =>
      /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(uri)
        ? Promise.resolve({ href: uri })
        : Promise.reject(
            new Error("External visualization assets are disabled"),
          ),
  };
};

export const createVisualizationView = async (
  target: HTMLElement,
  value: Visualization,
) => {
  const visualization = validateVisualization(value);
  const { default: embed } = await import("vega-embed");
  return embed(target, visualization.spec as VisualizationSpec, {
    mode: visualization.mode,
    renderer: "svg",
    actions: false,
    defaultStyle: false,
    tooltip: false,
    ast: true,
    loader: inlineVisualizationLoader(),
  });
};

export const visualizationSvg = async (value: Visualization) => {
  const target = document.createElement("div");
  let result: Result | undefined;
  try {
    result = await createVisualizationView(target, value);
    const svg = await result.view.toSVG();
    const document = new DOMParser().parseFromString(svg, "image/svg+xml");
    if (
      !document.querySelector(
        ".role-mark path[d], .role-mark rect, .role-mark circle, .role-mark line, .role-mark text",
      )
    ) {
      throw new Error("The visualization rendered no data marks");
    }
    return svg;
  } finally {
    result?.finalize();
    target.replaceChildren();
  }
};
