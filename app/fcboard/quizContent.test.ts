import { quizDiagram, quizText } from "./quizContent";
import { quizDocument, validateQuiz } from "./quiz";

const diagram = {
  caption: "小推车在水平面上的受力图，重力竖直向下",
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10Z"/></marker></defs><rect x="120" y="40" width="80" height="50"/><path d="M160 65V150" marker-end="url(#arrow)"/><text x="170" y="135">G=mg</text></svg>',
};
it("renders fractions, vectors and units locally while keeping surrounding model text literal", () => {
  const html = quizText(
    String.raw`加速度 $a=\frac{F}{m}$，$$\sum\vec F=0\ \mathrm{N}$$ <script>unsafe</script>`,
  );
  const doc = new DOMParser().parseFromString(html, "text/html");
  expect(doc.querySelectorAll("img.formula")).toHaveLength(2);
  expect(doc.querySelectorAll("script")).toHaveLength(0);
  expect(doc.body.textContent).toContain("<script>unsafe</script>");
  expect(
    decodeURIComponent(doc.querySelector("img")!.getAttribute("src")!),
  ).toContain("<path");
  expect(doc.querySelector(".math-display")).not.toBeNull();
  expect(() => quizText(String.raw`$\href{https://example.org}{x}$`)).toThrow();
});
it("keeps problem and solution diagrams distinct and renders math in choices and worked steps", () => {
  const value = {
    title: "牛顿定律",
    sources: [{ title: "教材", url: "https://www.pep.com.cn/" }],
    questions: [
      {
        type: "calculation" as const,
        question: String.raw`质量 $m=2\ \mathrm{kg}$，合力 $F=4\ \mathrm{N}$，求加速度。`,
        answer: [String.raw`$a=2\ \mathrm{m/s^2}$`],
        explanation: "合力与加速度同向。",
        steps: [String.raw`由 $F=ma$，得 $a=\frac{F}{m}=2\ \mathrm{m/s^2}$`],
        diagram,
        solutionDiagram: diagram,
      },
    ],
  };
  validateQuiz(value);
  const doc = new DOMParser().parseFromString(quizDocument(value), "text/html");
  expect(doc.querySelector(".card > figure img")?.getAttribute("alt")).toBe(
    diagram.caption,
  );
  expect(doc.querySelector(".answer figure img")).not.toBeNull();
  expect(doc.querySelectorAll(".steps .formula")).toHaveLength(2);
  expect(doc.querySelector("input,textarea")).toBeNull();
  expect(
    doc
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute("content"),
  ).toContain("img-src data:");
});
it.each([
  "<script>alert(1)</script>",
  "<foreignObject><div>bad</div></foreignObject>",
  '<image href="https://example.org/img.png"/>',
  '<rect onload="alert(1)"/>',
  '<path fill="url(https://example.org/x)"/>',
])("rejects active or external diagram content %s", (content) => {
  expect(() =>
    quizDiagram({
      ...diagram,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${content}</svg>`,
    }),
  ).toThrow();
});
