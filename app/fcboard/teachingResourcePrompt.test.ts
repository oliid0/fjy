import {
  teachingResourceFormat,
  teachingResourceInstructions,
} from "./teachingResourcePrompt";

it.each([
  ["人口增长图表", "vega"],
  ["Create charts of the supplied data", "vega"],
  ["地图", "vega"],
  ["用Vega交互拖动曲线", "vega"],
  ["生成人口增长HTML可视化", "html"],
  ["Canvas animation with a chart", "html"],
  ["原生SVG几何动画", "html"],
  ["可视化拖动抛物线顶点，方程随之变化", "html"],
  ["黎曼和可视化", "html"],
  ["气体模拟实验带统计图", "html"],
  ["agent-based population growth simulation", "html"],
  ["不用图表，做自由风格可视化", "html"],
  ["不要使用Vega，展示数学关系", "html"],
  ["Interactive visualization without charts", "html"],
  ["力学可视化", "auto"],
  ["用其他风格展示可视化", "auto"],
  ["Newton's first law", "html"],
] as const)(
  "selects %s according to the task and explicit medium",
  (topic, format) => {
    expect(teachingResourceFormat(topic)).toBe(format);
  },
);

it("honors HTML even through an explicitly requested visualization route and keeps experiments flexible", () => {
  expect(teachingResourceFormat("人口增长HTML可视化", "visualization")).toBe(
    "html",
  );
  expect(teachingResourceFormat("Population growth", "experiment")).toBe(
    "html",
  );
  expect(teachingResourceFormat("Visualize this topic", "visualization")).toBe(
    "vega",
  );
});

it("guides real manipulation, experiments and local-rule models while naming only available runtimes", () => {
  const html = teachingResourceInstructions("html");
  expect(html).toContain("dragging the vertex should change h and k");
  expect(html).toContain(
    "predict, change one relevant variable, observe, measure",
  );
  expect(html).toContain("local rules");
  expect(html).toContain("has not bundled JSXGraph");
  expect(html).toContain("Every displayed control must work");
  expect(teachingResourceInstructions("auto")).toContain(
    'The word "visualization" does not require a chart',
  );
});
