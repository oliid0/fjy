import { calculatorResourceId } from "@fcboard/common";

import { restoreCalculatorState } from "./calculatorInput";

import resourceRuntime from "./interactiveResourceRuntime.js?raw";
import { validateVisualization } from "./visualizationRuntime";

import type { CalculatorState } from "./calculatorInput";

import type { Visualization } from "./visualizationRuntime";

export { calculatorResourceId };
export const mediaResourceId = "builtin-media";
export const documentResourceId = "builtin-document";

export const resourceLibraryNames = ["vega", "jsxgraph"] as const;
export type ResourceLibrary = typeof resourceLibraryNames[number];
export type InteractiveResource = {
  id: string;
  title: string;
  html: string;
  media?: { key: string; video: boolean };
  document?: { key: string };
  calculator?: CalculatorState;
  visualization?: Visualization;
  libraries?: ResourceLibrary[];
};
export const resourceNeedsRuntime = (resource: InteractiveResource) =>
  !!resource.visualization || !!resource.libraries?.length;

/** Self-contained lessons run only in an opaque-origin iframe, never in the host. */
export const interactiveHtml = (
  value: unknown,
  libraries: readonly ResourceLibrary[] = [],
): string => {
  if (typeof value !== "string" || value.length > 120000 || !value.trim()) {
    throw new Error("Invalid interactive lesson HTML");
  }
  const document = new DOMParser().parseFromString(value, "text/html");
  document
    .querySelectorAll(
      "base,meta,link,iframe,frame,object,embed,script[src],style[data-fc-lesson-defaults],script[data-fc-lesson-controls]",
    )
    .forEach((node) => node.remove());
  document.querySelectorAll("a,form").forEach((node) => {
    node.removeAttribute("href");
    node.removeAttribute("action");
    node.removeAttribute("target");
  });
  const styles = [
    ...Array.from(
      document.querySelectorAll("style"),
      (node) => node.textContent || "",
    ),
    ...Array.from(
      document.querySelectorAll("[style]"),
      (node) => node.getAttribute("style") || "",
    ),
  ];
  const animated =
    document.querySelector(
      "svg animate,svg animateTransform,svg animateMotion",
    ) ||
    (styles.some((css) => /@(?:-webkit-)?keyframes\s/i.test(css)) &&
      styles.some((css) =>
        /(?:^|[;{])\s*(?:-webkit-)?animation(?:-name)?\s*:/i.test(css),
      ));
  const constructed =
    libraries.length &&
    document.querySelector("[data-fc-graphics]") &&
    [...document.querySelectorAll("script")].some((script) =>
      script.textContent?.trim(),
    );
  if (
    (!document.querySelector("canvas,svg") && !animated && !constructed) ||
    document.querySelector("form") ||
    (!(document.body.textContent || "").trim() && !constructed)
  ) {
    throw new Error("A lesson needs a graphical demonstration or animation");
  }
  const policy = document.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  const charset = document.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  document.head.prepend(policy, charset);
  const style = document.createElement("style");
  style.setAttribute("data-fc-lesson-defaults", "");
  style.textContent =
    "html{height:100%;color-scheme:light}body{box-sizing:border-box;margin:0;min-height:100%;font:16px/1.45 system-ui,sans-serif;overflow-wrap:anywhere;background:#fff;color:#17243c}*,*::before,*::after{box-sizing:border-box}canvas,svg{max-width:100%}button,input,select{font:inherit}button,input,select{touch-action:manipulation}";
  // Defaults fill missing styles; the authored lesson keeps its own theme.
  charset.after(style);
  const script = document.createElement("script");
  script.setAttribute("data-fc-lesson-controls", "");
  script.textContent = resourceRuntime;
  document.body.append(script);
  const html = `<!doctype html>${document.documentElement.outerHTML}`;
  if (html.length > 120000) {
    throw new Error("Invalid interactive lesson HTML");
  }
  return html;
};

export const validateInteractiveResource = (
  value: unknown,
): InteractiveResource => {
  const resource = value as Partial<InteractiveResource> | null;
  if (
    !resource ||
    typeof resource.id !== "string" ||
    !resource.id.trim() ||
    resource.id.length > 200 ||
    typeof resource.title !== "string" ||
    !resource.title.trim() ||
    resource.title.length > 160
  ) {
    throw new Error("Invalid interactive lesson");
  }
  // Saved boards already identify the built-in calculator by this id.
  // Its behavior comes from the app, so an old document's HTML is discarded.
  if (resource.id === calculatorResourceId) {
    return {
      id: resource.id,
      title: resource.title.trim(),
      html: "",
      ...(resource.calculator !== undefined
        ? { calculator: restoreCalculatorState(resource.calculator) }
        : {}),
    };
  }
  if (resource.id === mediaResourceId) {
    const media = resource.media;
    if (
      !media ||
      !/^[a-f0-9-]{36}$/i.test(media.key) ||
      typeof media.video !== "boolean"
    ) {
      throw new Error("Invalid local media playlist");
    }
    return {
      id: mediaResourceId,
      html: "",
      title: resource.title.trim(),
      media: { key: media.key, video: media.video },
    };
  }
  if (resource.id === documentResourceId) {
    if (!resource.document || !/^[a-f0-9-]{36}$/i.test(resource.document.key)) {
      throw new Error("Invalid local document");
    }
    return {
      id: documentResourceId,
      title: resource.title.trim(),
      html: "",
      document: { key: resource.document.key },
    };
  }
  const libraries: unknown[] = [];
  if (resource.libraries !== undefined) {
    if (!Array.isArray(resource.libraries) || resource.libraries.length > 2) {
      throw new Error("Invalid teaching resource libraries");
    }
    libraries.push(...resource.libraries);
  }
  if (typeof resource.html === "string" && resource.html.length <= 120000) {
    const document = new DOMParser().parseFromString(
      resource.html,
      "text/html",
    );
    for (const declaration of document.querySelectorAll(
      'meta[name="fc-libraries"]',
    )) {
      libraries.push(
        ...(declaration.getAttribute("content") || "")
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean),
      );
    }
  }
  if (
    libraries.some(
      (name) => !resourceLibraryNames.includes(name as ResourceLibrary),
    )
  ) {
    throw new Error("Unsupported teaching resource library");
  }
  const declared = [...new Set(libraries)] as ResourceLibrary[];
  return {
    id: resource.id,
    title: resource.title.trim(),
    html: interactiveHtml(resource.html, declared),
    ...(declared.length ? { libraries: declared } : {}),
    ...(resource.visualization
      ? { visualization: validateVisualization(resource.visualization) }
      : {}),
  };
};
