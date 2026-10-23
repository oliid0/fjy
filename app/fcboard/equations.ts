import { parse } from "mathjs";
import nerdamer from "nerdamer/all";

import type {
  MathNode,
  OperatorNode,
  SymbolNode,
  ConstantNode,
  ParenthesisNode,
} from "mathjs";

/** Restrict automatic solving to complete polynomials; transcendental solvers can omit roots. */
const polynomialDegree = (node: MathNode): number => {
  if (
    node.type === "ConstantNode" &&
    Number.isFinite(Number((node as ConstantNode).value))
  ) {
    return 0;
  }
  if (node.type === "SymbolNode" && /^[xyz]$/.test((node as SymbolNode).name)) {
    return 1;
  }
  if (node.type === "ParenthesisNode") {
    return polynomialDegree((node as ParenthesisNode).content);
  }
  if (node.type === "OperatorNode") {
    const { fn, args } = node as OperatorNode;
    const degrees = args.map(polynomialDegree);
    if (["add", "subtract", "unaryMinus", "unaryPlus"].includes(fn)) {
      return Math.max(...degrees);
    }
    if (fn === "multiply") {
      return degrees.reduce((a, b) => a + b, 0);
    }
    if (fn === "divide" && degrees[1] === 0) {
      return degrees[0];
    }
    if (fn === "pow" && args[1].type === "ConstantNode") {
      const exponent = Number((args[1] as ConstantNode).value);
      if (Number.isInteger(exponent) && exponent >= 0 && exponent <= 2) {
        return degrees[0] * exponent;
      }
    }
  }
  throw new Error("Unsupported automatic equation");
};

export const solveEquations = (input: string): string => {
  const equations = input.split(";").map((equation) => {
    const sides = equation.split("=");
    if (sides.length !== 2 || sides.some((side) => !side.trim())) {
      throw new Error("Incomplete equation");
    }
    return `(${sides[0]})-(${sides[1]})`;
  });
  if (equations.length > 3 || input.length > 500) {
    throw new Error("Equation system is too large");
  }
  const variables = new Set<string>();
  const degrees = equations.map((equation) => {
    const node = parse(equation);
    let count = 0;
    node.traverse((child) => {
      if (++count > 100) {
        throw new Error("Equation is too complex");
      }
      if (child.type === "SymbolNode") {
        variables.add((child as SymbolNode).name);
      }
    });
    return polynomialDegree(node);
  });
  const names = [...variables].sort();
  if (
    !names.length ||
    names.length !== equations.length ||
    degrees.some(
      (degree) => degree < 1 || degree > (names.length === 1 ? 2 : 1),
    )
  ) {
    throw new Error("Equation has no verified complete solution");
  }
  if (names.length === 1) {
    const roots = nerdamer.solveEquations(equations[0], names[0]) as {
      toString(): string;
    }[];
    const coefficients = parse(
      nerdamer(`coeffs(${equations[0]},${names[0]})`).toString(),
    ) as import("mathjs").ArrayNode;
    if (coefficients.type !== "ArrayNode") {
      throw new Error("Invalid polynomial");
    }
    const [c, b, a] = coefficients.items.map((item) => item.toString());
    const expected =
      !a || nerdamer(`(${b})^2-4*(${a})*(${c})`).toString() === "0" ? 1 : 2;
    if (
      roots.length !== expected ||
      roots.some(
        (root) =>
          nerdamer(equations[0], { [names[0]]: root.toString() }).toString() !==
          "0",
      )
    ) {
      throw new Error("Unverified equation roots");
    }
    return `${names[0]} = ${roots.map(String).join(", ")}`;
  }
  const values = nerdamer.solveEquations(equations, names) as [
    string,
    number | string,
  ][];
  const scope = Object.fromEntries(
    values.map(([name, value]) => [name, String(value)]),
  );
  if (
    values.length !== names.length ||
    names.some((name) => !scope[name]) ||
    equations.some((equation) => nerdamer(equation, scope).toString() !== "0")
  ) {
    throw new Error("Unverified equation system");
  }
  return names.map((name) => `${name} = ${scope[name]}`).join(", ");
};
