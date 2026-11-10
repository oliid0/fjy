import { dataURLToString } from "@fcboard/fcboard/data/blob";
import { validateInteractiveResource } from "@fcboard/fcboard/interactiveHtml";

import type { DataURL } from "@fcboard/fcboard/types";

import { functionView } from "./math";
import { functionGraphImage, functionGraphSpec } from "./functionVisualization";
import { functionGraphNavigation } from "./functionGraphNavigation";
import runtime from "./functionGraphRuntime.js?raw";

import type { Plot } from "./math";

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
    "html,body{height:100%;margin:0;overflow:hidden}body{display:flex;flex-direction:column}#fc-vega{flex:1;min-height:0;width:100%;touch-action:none}#fc-vega svg{display:block}nav{display:flex;flex-wrap:wrap;gap:4px;padding:4px;font:11px system-ui}label{display:flex;align-items:center;gap:2px}input{width:54px;min-width:0;padding:1px;border:1px solid #aaa;border-radius:3px;font:inherit}output{display:block;min-height:20px;padding:2px 6px;font:12px system-ui}h1{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}";
  page.head.append(style);
  const title = page.createElement("h1");
  title.textContent = [plot.expression, ...(plot.compare || [])]
    .map((expression) => `y = ${expression}`)
    .join("; ");
  const nav = page.createElement("nav");
  const bounds = functionView(plot);
  for (const [key, label] of [
    ["left", "x min"],
    ["right", "x max"],
    ["bottom", "y min"],
    ["top", "y max"],
  ] as const) {
    const control = page.createElement("label");
    control.textContent = label;
    const input = page.createElement("input");
    input.type = "number";
    input.step = "any";
    input.dataset.bound = key;
    input.value = String(bounds[key]);
    control.append(input);
    nav.append(control);
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
