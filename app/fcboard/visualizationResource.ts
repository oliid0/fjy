import {
  visualizationSvg,
  validateVisualization,
} from "@fcboard/fcboard/visualizationRuntime";
import { validateInteractiveResource } from "@fcboard/fcboard/interactiveHtml";

/** Store a compact, real SVG preview plus the editable JSON specification.
 * Trusted offline runtimes are supplied by the app when the resource is opened. */
export const createVisualizationResource = async (
  title: string,
  value: unknown,
) => {
  const visualization = validateVisualization(value);
  const svg = await visualizationSvg(visualization);
  const document = window.document.implementation.createHTMLDocument(title);
  const style = document.createElement("style");
  style.textContent =
    "html,body,#fc-vega{width:100%;height:100%;margin:0;overflow:hidden}#fc-vega>svg{width:100%;height:100%;display:block}";
  document.head.append(style);
  const root = document.createElement("main");
  root.id = "fc-vega";
  root.innerHTML = svg;
  document.body.append(root);
  return validateInteractiveResource({
    id: `generated:${crypto.randomUUID()}`,
    title,
    html: `<!doctype html>${document.documentElement.outerHTML}`,
    visualization,
  });
};
