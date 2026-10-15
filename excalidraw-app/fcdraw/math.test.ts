import {
  calculate,
  compileExpression,
  defaultPlot,
  normalizeExpression,
  samplePlot,
} from "./math";

describe("classroom mathematics", () => {
  it("calculates handwritten operators and complex numbers", () => {
    expect(calculate("1+1=")).toBe("2");
    expect(normalizeExpression("2×3÷2＝")).toBe("2*3/2");
    expect(calculate("sqrt(-1)")).toBe("i");
    expect(calculate("(2+3i)*(2-3i)")).toBe("13");
  });
  it("supports symbolic derivatives, integrals, definite integrals, limits and equations", () => {
    expect(calculate("diff(x^3,x)")).toBe("3*x^2");
    expect(calculate("integrate(x,x)")).toContain("x^2");
    expect(calculate("defint(x^2,0,3,x)")).toBe("9");
    expect(calculate("limit(sin(x)/x,x,0)")).toBe("1");
    expect(calculate("solve(x^2-1,x)")).toContain("1");
  });
  it("rejects assignment, property access and executable functions", () => {
    for (const input of [
      "x=3",
      "x.constructor",
      'evaluate("2+2")',
      "import(1)",
      "[1,2]",
      "unknown(x)",
    ]) {
      expect(() => compileExpression(input)).toThrow();
    }
  });
  it("samples 2D functions and changes with parameters", () => {
    const first = samplePlot({
      ...defaultPlot,
      expression: "a*x+b",
      a: 1,
      b: 1,
    });
    const second = samplePlot({
      ...defaultPlot,
      expression: "a*x+b",
      a: 2,
      b: 3,
    });
    expect(first[0][120]).toEqual([0, -1]);
    expect(second[0][120]).toEqual([0, -3]);
  });
  it("does not draw across asymptotes or nonreal ranges", () => {
    expect(
      samplePlot({ ...defaultPlot, expression: "1/x" }).length,
    ).toBeGreaterThan(1);
    expect(() =>
      samplePlot({ ...defaultPlot, expression: "sqrt(-1)" }),
    ).toThrow();
    expect(() => samplePlot({ ...defaultPlot, range: 0 })).toThrow();
  });
  it("creates a projected mesh for z=f(x,y)", () => {
    const lines = samplePlot({
      ...defaultPlot,
      expression: "sin(x)*cos(y)",
      surface: true,
    });
    expect(lines.length).toBe(22);
    expect(
      lines.every(
        (line) =>
          line.length > 1 && line.every((p) => p.every(Number.isFinite)),
      ),
    ).toBe(true);
  });
});
