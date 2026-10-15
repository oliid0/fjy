import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import "mathjax-full/js/input/tex/ams/AmsConfiguration.js";
import "mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js";
import "mathjax-full/js/input/tex/mathtools/MathtoolsConfiguration.js";
import "mathjax-full/js/input/tex/textmacros/TextMacrosConfiguration.js";
import "mathjax-full/js/input/tex/cancel/CancelConfiguration.js";

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const input = new TeX({
  packages: ["base", "ams", "newcommand", "mathtools", "textmacros", "cancel"],
  maxBuffer: 10000,
  formatError: (_jax: unknown, error: Error) => {
    throw error;
  },
});
const document = mathjax.document("", {
  InputJax: input,
  OutputJax: new SVG({ fontCache: "none" }),
});

/** MathJax's official liteDOM → SVG path, with embedded glyphs and no HTML or remote resources. */
export const formulaSvg = (latex: string, color = "#245bd6") => {
  if (
    !latex.trim() ||
    latex.length > 4000 ||
    /\\(?:href|url|require|includegraphics|style|html|class|cssId)\b/i.test(
      latex,
    )
  ) {
    throw new Error("公式包含不支持的内容");
  }
  const node = document.convert(latex.replace(/^\$\$?|\$\$?$/g, ""), {
    display: true,
  });
  const svg = adaptor.tags(node, "svg")[0];
  if (!svg) {
    throw new Error("公式未生成图形");
  }
  const box = String(adaptor.getAttribute(svg, "viewBox"))
    .split(/\s+/)
    .map(Number);
  if (
    box.length !== 4 ||
    !box.every(Number.isFinite) ||
    box[2] <= 0 ||
    box[3] <= 0
  ) {
    throw new Error("公式尺寸无效");
  }
  const width = Math.max(16, (box[2] / 1000) * 32);
  const height = Math.max(16, (box[3] / 1000) * 32);
  adaptor.setAttribute(svg, "width", `${width}px`);
  adaptor.setAttribute(svg, "height", `${height}px`);
  adaptor.setAttribute(svg, "color", color);
  return { svg: adaptor.outerHTML(svg), width, height };
};
