import resourceRuntime from "./interactiveResourceRuntime.js?raw";

export type InteractiveResource = {
  id: string;
  title: string;
  html: string;
};

/** Self-contained lessons run only in an opaque-origin iframe, never in the host. */
export const interactiveHtml = (value: unknown): string => {
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
  if (
    !document.querySelector("script") ||
    !document.querySelector("canvas,svg") ||
    document.querySelector("form") ||
    !(document.body.textContent || "").trim()
  ) {
    throw new Error(
      "An interactive lesson needs a scripted graphical demonstration",
    );
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
  document.head.append(style);
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
  return {
    id: resource.id,
    title: resource.title.trim(),
    html: interactiveHtml(resource.html),
  };
};
