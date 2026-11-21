import { calculateLatex } from "./latexCalculation";

it.each([
  [String.raw`\sin(30^\circ)`, "1/2"],
  [String.raw`\cos(90^\circ)`, "0"],
  [String.raw`\sin(180^\circ)`, "0"],
  [String.raw`\log_{2}4`, "2"],
  [String.raw`\frac{1}{\frac{2}{3}}`, "3/2"],
  [String.raw`\sqrt{-1}`, "i"],
  [String.raw`2^{\sqrt{4}}`, "4"],
  [String.raw`\binom{10}{3}`, "120"],
  [String.raw`\sum_{k=1}^{5}k^2`, "55"],
  [String.raw`\int_0^1 x^2\,dx`, "1/3"],
  [String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`, "[[1,2],[3,4]]"],
])(
  "evaluates original structural LaTeX with the real local engine: %s",
  (latex, answer) => {
    expect(calculateLatex(latex)).toBe(answer);
  },
);

it.each([
  String.raw`\frac{1}{}`,
  String.raw`\frac{1}{0}`,
  String.raw`\tan(90^\circ)`,
  String.raw`\int_0^1 \frac{1}{x}\,dx`,
  String.raw`\sin(x)`,
  String.raw`\operatorname{unknown}(2)`,
  "a:=2",
  String.raw`\operatorname{Assign}(a,2)`,
])("withholds an incomplete, unresolved or nonfinite answer: %s", (latex) => {
  expect(() => calculateLatex(latex)).toThrow();
});

it("evaluates without dynamic JavaScript code generation", () => {
  const original = globalThis.Function;
  vi.stubGlobal("Function", () => {
    throw new Error("Dynamic code disabled");
  });
  try {
    expect(calculateLatex(String.raw`\frac{1}{2}+\frac{1}{3}`)).toBe("5/6");
  } finally {
    vi.stubGlobal("Function", original);
    vi.unstubAllGlobals();
  }
});
