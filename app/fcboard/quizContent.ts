import { formulaSvg } from "./formula";

export const escapeQuizHTML = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        char
      ]!),
  );

const formulas = new Map<string, string>();
/** Reuse the board's bundled MathJax renderer; no CDN or scripts in model text. */
export const quizText = (text: string) => {
  const pattern =
    /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$([^\n$]+?)\$/g;
  let result = "";
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    result += escapeQuizHTML(text.slice(offset, match.index));
    const latex = match[1] || match[2] || match[3] || match[4];
    let content = formulas.get(latex);
    if (!content) {
      const formula = formulaSvg(latex, "#20232d");
      content = `<img class="formula" alt="${escapeQuizHTML(
        latex,
      )}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(
        formula.svg,
      )}" style="width:${formula.width * 0.625}px;height:${
        formula.height * 0.625
      }px"/>`;
      if (formulas.size >= 256) {
        formulas.clear();
      }
      formulas.set(latex, content);
    }
    result += `<span class="${
      match[1] || match[2] ? "math-display" : "math-inline"
    }">${content}</span>`;
    offset = match.index! + match[0].length;
  }
  return result + escapeQuizHTML(text.slice(offset));
};

export type QuizDiagram = { svg: string; caption: string };
/** Static textbook diagrams are images, with bounded local SVG drawing elements. */
export const quizDiagram = (diagram: QuizDiagram) => {
  if (
    !diagram ||
    typeof diagram.svg !== "string" ||
    diagram.svg.length > 80000 ||
    typeof diagram.caption !== "string" ||
    !diagram.caption.trim() ||
    diagram.caption.length > 500 ||
    /<!DOCTYPE|<!ENTITY/i.test(diagram.svg)
  ) {
    throw new Error("题目示意图不完整或格式不支持");
  }
  const doc = new DOMParser().parseFromString(diagram.svg, "image/svg+xml");
  const root = doc.documentElement;
  const allowed = new Set([
    "svg",
    "g",
    "defs",
    "marker",
    "path",
    "line",
    "rect",
    "circle",
    "ellipse",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "title",
    "desc",
  ]);
  const elements = [root, ...root.querySelectorAll("*")];
  const box = (root.getAttribute("viewBox") || "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    root.localName !== "svg" ||
    root.namespaceURI !== "http://www.w3.org/2000/svg" ||
    box.length !== 4 ||
    !box.every(Number.isFinite) ||
    box[2] <= 0 ||
    box[3] <= 0 ||
    box[2] > 10000 ||
    box[3] > 10000 ||
    elements.length > 1000 ||
    elements.some(
      (element) =>
        !allowed.has(element.localName) ||
        [...element.attributes].some(
          (attribute) =>
            /^on|href$|src$/i.test(attribute.name) ||
            /url\s*\(|@import|javascript:|data:/i.test(
              attribute.value.replace(/url\(\s*#[\w-]+\s*\)/g, ""),
            ),
        ),
    )
  ) {
    throw new Error("题目示意图包含不支持的绘图内容");
  }
  return `<figure class="quiz-diagram"><img alt="${escapeQuizHTML(
    diagram.caption,
  )}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    diagram.svg,
  )}"/><figcaption>${escapeQuizHTML(diagram.caption)}</figcaption></figure>`;
};
