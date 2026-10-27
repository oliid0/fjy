import { calculate, samplePlot, sampleInequality } from "./math";
import {
  localMathResult,
  recognizeMath,
  validatedPlot,
} from "./mathRecognition";
import { saveSettings, defaults } from "./settings";
import * as ai from "./ai";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

it.each([
  ["6+7=", "13"],
  ["65×3+12=", "207"],
  ["0.1+0.2", "0.3"],
  ["9007199254740993+1", "9.007199254740994e+15"],
  ["2**3", "8"],
  ["2^-3", "0.125"],
  ["7 % 3", "1"],
  [String.raw`7 \pmod{3}`, "1"],
  ["5!", "120"],
  [String.raw`\vert -5\vert`, "5"],
  [String.raw`\sqrt[3]{27}`, "3"],
  [String.raw`\frac{1}{\frac{2}{3}}`, "1.5"],
  [String.raw`\log_{2}(8)`, "3"],
  [String.raw`\sin^{-1}(1)`, "1.5707963267948966192313216916398"],
  [String.raw`\lim_{x\to 0} \frac{\sin(x)}{x}`, "1"],
  [String.raw`\frac{d}{dx}(x^2)`, "2*x"],
  [String.raw`\int_{0}^{2} x \, dx`, "2"],
  [String.raw`\int x \, dx`, "(1/2)*x^2 + C"],
  [String.raw`\sum_{i=1}^{5} i`, "15"],
  [String.raw`\prod_{i=1}^{5} i`, "120"],
  ["123\n+ 45\n----", "168"],
  ["det([1,2;3,4])", "-2"],
  ["[1,2;3,4]*[1;2]", "[[5], [11]]"],
  [
    String.raw`\begin{bmatrix}1&2\\3&4\end{bmatrix}+[1,1;1,1]`,
    "[[2, 3], [4, 5]]",
  ],
  ["x^2-4=0", "x = 2, -2"],
  ["x+y=3\nx-y=1", "x = 2, y = 1"],
])("locally evaluates %s", (input, expected) =>
  expect(calculate(input)).toBe(expected),
);

it.each([
  "1/0",
  "0/0",
  "1\n2",
  String.raw`\frac{1}{}`,
  "sin(x)=0",
  "x+y=1",
  "[1,2;3]",
  "zeros(999999)",
  'evaluate("1+1")',
  "x.constructor",
  "2^(2^1000)",
  "defint(1/x^2,-1,1,x)",
  "defint(1/x,-1,1,x)",
  "defint(log(x),-1,1,x)",
  "sum(x,x,1,1000000)",
  "limit(abs(x)/x,x,0)",
])("withholds unsupported or invalid mathematics: %s", (input) => {
  expect(() => calculate(input)).toThrow();
});

it("splits a narrow pole between sample points even when its amplitude is small", () => {
  const pole = 0.0123;
  const lines = samplePlot(
    validatedPlot({ expression: `1/(100000*(x-${pole}))` }),
  );
  expect(lines.length).toBeGreaterThan(1);
  expect(
    lines.some((line) => line[0][0] < pole && line[line.length - 1][0] > pole),
  ).toBe(false);
});

it.each([
  "y=sin(x)",
  "y=cos(x)",
  "y=tan(x)",
  "y=arcsin(x)",
  "y=log_2(x)",
  "y=e^x",
  "y=2^x",
  String.raw`y=\sqrt{x}`,
  "f(x,y)=sin(x)*cos(y)",
])("generates finite local geometry for %s", (input) => {
  const result = localMathResult(input, "function");
  expect(result.kind).toBe("function");
  if (result.kind === "function") {
    const lines = samplePlot(result.plot);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.flat(2).every(Number.isFinite)).toBe(true);
    if (input === "y=tan(x)") {
      for (const line of lines) {
        for (const pole of [-3, -1, 1, 3].map((n) => (n * Math.PI) / 2)) {
          expect(line[0][0] < pole && line[line.length - 1][0] > pole).toBe(
            false,
          );
        }
      }
    }
  }
});

it("shades the requested side of an inequality using local coordinates", () => {
  for (const relation of [">", ">=", "<", "<="] as const) {
    const plot = validatedPlot({ expression: "2*x+1", relation });
    const polygons = sampleInequality(plot);
    expect(polygons.length).toBeGreaterThan(0);
    expect(
      polygons.flat().every(([x, y]) => Math.abs(x) <= 10 && Math.abs(y) <= 10),
    ).toBe(true);
    const edge = polygons[0][polygons[0].length - 2][1];
    expect(edge).toBe(relation.startsWith(">") ? -10 : 10);
  }
  expect(localMathResult("y ≥ 2x+1", "function")).toMatchObject({
    kind: "function",
    plot: { relation: ">=", expression: "2x+1" },
  });
});

it("never calls AI for a supported local formula", async () => {
  const cloud = vi.spyOn(ai, "chat");
  expect(
    await recognizeMath("0.1+0.2", "calculation", new AbortController().signal),
  ).toMatchObject({ answer: "0.3" });
  await recognizeMath("y=x^2", "function", new AbortController().signal);
  expect(cloud).not.toHaveBeenCalled();
});

it("accepts only source-matching JSON, locally draws it and rejects invented values/images/points", async () => {
  saveSettings({ ...defaults, apiKey: "key", model: "parser" }, false);
  const text = "y = sine(x) + 2";
  const json = {
    version: 1,
    kind: "function",
    source: text,
    expression: "sin(x)+2",
    surface: false,
  };
  const cloud = vi.spyOn(ai, "chat").mockResolvedValue(JSON.stringify(json));
  expect(
    await recognizeMath(text, "function", new AbortController().signal),
  ).toMatchObject({ kind: "function", plot: { expression: "sin(x)+2" } });
  const messages = cloud.mock.calls[0][0];
  expect(messages.every((message) => typeof message.content === "string")).toBe(
    true,
  );
  for (const bad of [
    { expression: "sin(x)+3" },
    { source: "other" },
    {
      points: [
        [0, 0],
        [1, 1],
      ],
    },
    { image: "data:image/png;base64,AA" },
    { expression: "x+y+2" },
  ]) {
    cloud.mockResolvedValueOnce(JSON.stringify({ ...json, ...bad }));
    await expect(
      recognizeMath(text, "function", new AbortController().signal),
    ).rejects.toThrow();
  }
});
