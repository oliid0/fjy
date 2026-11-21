import { calculateLocal, prepareCalculation } from "./mathCalculation";
import { calculationNotation } from "./mathNotation";

it.each([
  ["１１＋１１＝", "22"],
  ["sin30°", "0.5"],
  ["sin30 度", "0.5"],
  [String.raw`\sin 30^\circ`, "0.5"],
  ["log₂4", "2"],
  ["log2 4", "2"],
  ["log_3(9)", "2"],
  [String.raw`\log_{2}(8)`, "3"],
  ["ln1", "0"],
  ["√9+∛27", "6"],
  ["2³+2⁻²", "8.25"],
  ["2^sqrt(4)", "4"],
  ["factorial(sqrt(16))", "24"],
  ["cot(pi/4)", "1"],
  ["asinh(0)", "0"],
  ["hypot(3,4)", "5"],
  ["gcd(48,18)", "6"],
  ["lcm(6,8)", "24"],
  ["combinations(10,3)", "120"],
  ["permutations(6,2)", "30"],
  ["mean([1,2,3])", "2"],
  ["median([1,7,3])", "3"],
  ["std([1,2,3])", "1"],
  ["variance([1,2,3])", "1"],
])("normalizes and calculates scientific notation %s", (input, answer) => {
  expect(calculateLocal(input)).toBe(answer);
});

it.each([
  "2^(2^1000)",
  "factorial(100000)",
  "permutations(100000,2)",
  "combinations(200,2^1000)",
])("rejects unchecked excessive work: %s", (input) => {
  expect(() => prepareCalculation(input)).toThrow();
});

it("distinguishes a function's power from its argument's power", () => {
  expect(calculateLocal("sin^2(30°)")).toBe("0.25");
  expect(calculationNotation("sin 3^2")).toBe("sin(3^2)");
  expect(() => prepareCalculation("log24")).toThrow();
});
