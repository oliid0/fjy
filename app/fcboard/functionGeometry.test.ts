import { functionGeometry } from "./functionGeometry";
import { defaultPlot } from "./math";

it("finds both actual reciprocal/line intersections with stable labels and shared coordinates", () => {
  const data = functionGeometry({
    ...defaultPlot,
    expression: "x+1",
    compare: ["1/x"],
  });
  expect(data.intersections).toHaveLength(2);
  expect(data.intersections[0]).toMatchObject({
    label: "a",
    functions: [0, 1],
  });
  expect(data.intersections[0].x).toBeCloseTo((-1 - Math.sqrt(5)) / 2, 6);
  expect(data.intersections[1].x).toBeCloseTo((-1 + Math.sqrt(5)) / 2, 6);
  expect(data.intersections[1].y).toBeCloseTo((1 + Math.sqrt(5)) / 2, 6);
});
it("detects a tangent away from the regular sample grid without a residual sign change", () => {
  const data = functionGeometry({
    ...defaultPlot,
    expression: "(x-0.1234)^2",
    compare: ["0"],
  });
  expect(data.intersections).toHaveLength(1);
  expect(data.intersections[0].x).toBeCloseTo(0.1234, 5);
  expect(data.intersections[0].y).toBeCloseTo(0, 8);
});
it("does not invent crossings for parallel/coincident curves or across a pole", () => {
  for (const expressions of [
    ["x-1", "x+1"],
    ["x+x", "2*x"],
    ["1/x", "0"],
  ]) {
    expect(
      functionGeometry({
        ...defaultPlot,
        expression: expressions[0],
        compare: [expressions[1]],
      }).intersections,
    ).toEqual([]);
  }
});
it("merges a three-function common point into one label and recomputes real intersections in a new viewport", () => {
  const plot = { ...defaultPlot, expression: "x", compare: ["-x", "0"] };
  const first = functionGeometry(plot);
  expect(first.intersections).toEqual([
    { x: 0, y: 0, label: "a", functions: [0, 1, 2] },
  ]);
  expect(functionGeometry(plot)).toBe(first);
  expect(
    functionGeometry({
      ...plot,
      view: { left: 1, right: 4, bottom: 1, top: 4 },
    }).intersections,
  ).toEqual([]);
});
it("retains disconnected branches and uses the actual parameter scope and z shift", () => {
  const data = functionGeometry({
    ...defaultPlot,
    expression: "1/x",
    compare: ["a*x"],
    a: 2,
    z: 3,
  });
  expect(data.curves[0].lines).toHaveLength(2);
  expect(data.intersections).toHaveLength(2);
  expect(data.intersections[1].x).toBeCloseTo(Math.sqrt(0.5), 6);
  expect(data.intersections[1].y).toBeCloseTo(Math.sqrt(2) + 3, 6);
});
