import { validateVisualization } from "@fcboard/fcboard/visualizationRuntime";

import type { InteractiveResource } from "@fcboard/fcboard/interactiveHtml";
import type { Visualization } from "@fcboard/fcboard/visualizationRuntime";

export type QuizFigure =
  | Visualization
  | {
      mode: "jsxgraph";
      boundingbox: [number, number, number, number];
      axis?: boolean;
      elements: {
        id: string;
        type: string;
        parents: unknown[];
        attributes?: Record<string, unknown>;
      }[];
    };

/** Validate data once; the fixed renderer owns all executable code. */
export const validateQuizFigure = (input: unknown): QuizFigure => {
  const value = input as QuizFigure;
  if (value?.mode === "vega" || value?.mode === "vega-lite")
    return validateVisualization(value);
  if (
    value?.mode !== "jsxgraph" ||
    !Array.isArray(value.boundingbox) ||
    value.boundingbox.length !== 4 ||
    !value.boundingbox.every(Number.isFinite) ||
    value.boundingbox[0] >= value.boundingbox[2] ||
    value.boundingbox[1] <= value.boundingbox[3] ||
    !Array.isArray(value.elements) ||
    !value.elements.length ||
    value.elements.length > 200
  ) {
    throw new Error("Invalid quiz diagram JSON");
  }
  const ids = new Set<string>();
  for (const element of value.elements) {
    if (
      !element ||
      typeof element.id !== "string" ||
      !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(element.id) ||
      ids.has(element.id) ||
      ![
        "point",
        "line",
        "segment",
        "arrow",
        "polygon",
        "circle",
        "angle",
        "curve",
        "text",
      ].includes(element.type) ||
      !Array.isArray(element.parents)
    )
      throw new Error("Invalid quiz diagram element");
    ids.add(element.id);
  }
  const json = JSON.stringify(value);
  if (
    json.length > 100000 ||
    /"(?:__proto__|prototype|constructor|url|href)"\s*:/.test(json)
  )
    throw new Error("Invalid quiz diagram data");
  return value;
};

export const quizFigureResource = async (
  input: unknown,
  title: string,
): Promise<InteractiveResource> => {
  const value = validateQuizFigure(input);
  title = title.slice(0, 160);
  if (value.mode === "vega" || value.mode === "vega-lite") {
    return (
      await import("./visualizationResource")
    ).createVisualizationResource(title, value);
  }
  const json = JSON.stringify(value);
  const html =
    '<!doctype html><html><head><style>html,body,#figure{margin:0;width:100%;height:100%;overflow:hidden;background:white}</style></head><body><main id="figure" data-fc-graphics></main>';
  const payload = json.replace(/</g, "\\u003c");
  return {
    id: crypto.randomUUID(),
    title,
    libraries: ["jsxgraph"],
    html: `${html}<script>
    const figure=${payload};
    const board=JXG.JSXGraph.initBoard('figure',{boundingbox:figure.boundingbox,axis:!!figure.axis,renderer:'svg',showCopyright:false,showNavigation:false,keepaspectratio:true});
    board.suspendUpdate();
    for(const element of figure.elements) board.create(element.type,element.parents,Object.assign({},element.attributes,{id:element.id,fixed:true,highlight:false}));
    board.unsuspendUpdate();
    document.dispatchEvent(new Event("fc-figure-ready"));
  </script></body></html>`,
  };
};
