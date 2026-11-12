import { dataURLToString } from "@fcboard/fcboard/data/blob";
import { validateInteractiveResource } from "@fcboard/fcboard/interactiveHtml";
import { t } from "@fcboard/fcboard/i18n";

import type { DataURL } from "@fcboard/fcboard/types";

import { functionGraphImage, functionGraphSpec } from "./functionVisualization";
import { functionGraphNavigation } from "./functionGraphNavigation";
import { validatedPlot } from "./mathRecognition";
import runtime from "./functionGraphRuntime.js?raw";

import type { Plot } from "./math";
import type { DocumentInk } from "./documents";

/** Upgrade old courseware SVG plots without changing their identity or bounds. */
export const restoreDocumentFunctionGraphs = (
  ink: DocumentInk,
): DocumentInk => {
  let changed = false;
  const restored = Object.fromEntries(
    Object.entries(ink).map(([page, strokes]) => [
      page,
      strokes.map((stroke) => {
        if (
          stroke.plot?.renderer !== "vega" ||
          stroke.resource ||
          !stroke.image ||
          !stroke.imageWidth ||
          !stroke.imageHeight
        ) {
          return stroke;
        }
        try {
          const plot = validatedPlot({ ...stroke.plot.plot });
          const resource = functionGraphResource(
            plot,
            stroke.color,
            stroke.plot.id,
            stroke.image as DataURL,
          );
          changed = true;
          return {
            ...stroke,
            shapeType: "iframe" as const,
            resource: {
              ...resource,
              width: stroke.imageWidth,
              height: stroke.imageHeight,
            },
            plot: { ...stroke.plot, plot, renderer: "iframe" as const },
          };
        } catch {
          // An invalid imported plot remains visible as its saved image.
          return stroke;
        }
      }),
    ]),
  );
  return changed ? restored : ink;
};

export const functionGraphResource = (
  plot: Plot,
  color: string,
  id: string,
  image?: DataURL,
) => {
  const spec = functionGraphSpec(plot, color);
  spec.signals = functionGraphNavigation(plot);
  spec.scales![0].domain = { signal: "xdom" };
  spec.scales![1].domain = { signal: "ydom" };
  const page = document.implementation.createHTMLDocument(
    `y = ${plot.expression}`,
  );
  const style = page.createElement("style");
  style.textContent =
    "html,body{height:100%;margin:0;overflow:hidden;background:transparent}body{position:relative}#fc-vega{height:100%;width:100%;touch-action:none}#fc-vega svg{display:block}nav{position:absolute;bottom:24px;left:40px;display:flex;flex-wrap:wrap;gap:6px;font:11px system-ui}nav:empty,output:empty{display:none}label{display:flex;align-items:center;gap:2px}input{width:72px;min-width:0;font:inherit}output{position:absolute;bottom:2px;left:40px;max-width:calc(100% - 60px);font:12px system-ui;pointer-events:none}h1{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}";
  page.head.append(style);
  const title = page.createElement("h1");
  title.textContent = [plot.expression, ...(plot.compare || [])]
    .map((expression) => `y = ${expression}`)
    .join("; ");
  const nav = page.createElement("nav");
  for (const key of ["a", "b", "c"] as const) {
    if (
      ![plot.expression, ...(plot.compare || [])].some((expression) =>
        new RegExp(`\\b${key}\\b`).test(expression),
      )
    ) {
      continue;
    }
    const label = page.createElement("label");
    label.textContent = key;
    const input = page.createElement("input");
    input.type = "range";
    input.min = String(Math.min(-10, plot[key]));
    input.max = String(Math.max(10, plot[key]));
    input.step = "0.1";
    input.value = String(plot[key]);
    input.dataset.parameter = key;
    input.setAttribute("aria-label", t("fcboard.adjust_key", { key }));
    label.append(input);
    nav.append(label);
  }
  const root = page.createElement("main");
  root.id = "fc-vega";
  root.dataset.functionResource = id;
  root.innerHTML = dataURLToString(image || functionGraphImage(plot, color));
  const output = page.createElement("output");
  output.setAttribute("aria-live", "polite");
  const script = page.createElement("script");
  script.textContent = runtime;
  page.body.append(title, nav, root, output, script);
  return validateInteractiveResource({
    id,
    title: title.textContent!.slice(0, 160),
    html: `<!doctype html>${page.documentElement.outerHTML}`,
    visualization: { mode: "vega", spec },
  });
};
