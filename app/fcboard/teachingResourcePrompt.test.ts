import {
  teachingResourceEngines,
  teachingResourceFormat,
  teachingResourceInstructions,
} from "./teachingResourcePrompt";

it.each([
  ["人口增长图表", "auto"],
  ["Create charts of the supplied data", "auto"],
  ["地图", "auto"],
  ["用Vega交互拖动曲线", "vega"],
  ["使用JSXGraph演示动态几何", "jsxgraph"],
  ["生成人口增长HTML可视化", "html"],
  ["Canvas animation with a chart", "html"],
  ["原生SVG几何动画", "html"],
  ["可视化拖动抛物线顶点，方程随之变化", "auto"],
  ["黎曼和可视化", "auto"],
  ["气体模拟实验带统计图", "auto"],
  ["agent-based population growth simulation", "auto"],
  ["不用图表，做自由风格可视化", "auto"],
  ["不要使用Vega，展示数学关系", "auto"],
  ["Interactive visualization without charts", "auto"],
  ["力学可视化", "auto"],
  ["Newton's first law", "auto"],
  ["用Vega和JSXGraph组合展示", "auto"],
] as const)(
  "honors only explicit medium/engine choices for %s",
  (topic, format) => {
    expect(teachingResourceFormat(topic)).toBe(format);
  },
);

it.each([
  ["用Vega和JSXGraph组合展示", ["vega", "jsxgraph"], []],
  ["Use Vega and JSXGraph", ["vega", "jsxgraph"], []],
  ["不要用Vega，改用JSXGraph", ["jsxgraph"], ["vega"]],
  ["不用JSXGraph，使用Vega", ["vega"], ["jsxgraph"]],
  ["Learn about Vega history", [], []],
  ["using JSGraph", ["jsxgraph"], []],
])(
  "keeps explicit requirements/exclusions separate from subject choice: %s",
  (topic, required, excluded) => {
    expect(teachingResourceEngines(topic)).toEqual({ required, excluded });
  },
);

it("offers both optional engines and free HTML without preferring an engine by subject", () => {
  const html = teachingResourceInstructions("html");
  expect(html).toContain("dragging the vertex should change h and k");
  expect(html).toContain(
    "predict, change one relevant variable, observe, measure",
  );
  expect(html).toContain("local rules");
  expect(html).toContain("JSXGraph 1.14.3");
  expect(html).toContain("fc-libraries");
  expect(html).toContain("jc.compile=false");
  expect(html).toContain("Every displayed control must work");
  const auto = teachingResourceInstructions("auto");
  expect(auto).toContain('The word "visualization" does not require a chart');
  expect(auto).toContain("freely choose or combine");
  expect(auto).toContain("DECLARATIVE VEGA OPTION");
  expect(teachingResourceInstructions("jsxgraph")).toContain(
    "explicitly requested JSXGraph",
  );
});

it.each([
  "Use Vega or JSXGraph",
  "用Vega或JSXGraph展示",
  "使用Vega或者JSXGraph展示",
])("preserves the author choice in an explicit alternative: %s", (topic) => {
  expect(teachingResourceEngines(topic)).toEqual({
    required: [],
    excluded: [],
    anyOf: ["vega", "jsxgraph"],
  });
  expect(teachingResourceFormat(topic)).toBe("auto");
});
