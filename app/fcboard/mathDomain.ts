import * as interval from "interval-arithmetic";

import type {
  MathNode,
  ConstantNode,
  FunctionNode,
  OperatorNode,
  ParenthesisNode,
  SymbolNode,
} from "mathjs";

type Bounds = [number, number];
type Range = interval.Interval | undefined;

/** Adapt the validated AST to interval-arithmetic's outward-rounded operations.
 * An unbounded/unknown domain must not become a finite integral or a connected curve.
 */
export const continuousMathRange = (
  node: MathNode,
  scope: Record<string, Bounds>,
): Bounds | undefined => {
  const visit = (node: MathNode): Range => {
    if (node.type === "ConstantNode") {
      const value = Number((node as ConstantNode).value);
      return Number.isFinite(value)
        ? Number.isInteger(value)
          ? new interval.Interval(value)
          : new interval.Interval().boundedSingleton(value)
        : undefined;
    }
    if (node.type === "SymbolNode") {
      const name = (node as SymbolNode).name;
      const bounds = scope[name];
      return bounds
        ? new interval.Interval(...bounds)
        : name === "pi"
        ? interval.constants.PI
        : name === "e"
        ? interval.constants.E
        : undefined;
    }
    if (node.type === "ParenthesisNode") {
      return visit((node as ParenthesisNode).content);
    }
    if (node.type !== "OperatorNode" && node.type !== "FunctionNode") {
      return undefined;
    }
    const operation = node as OperatorNode | FunctionNode;
    const name =
      typeof operation.fn === "string" ? operation.fn : operation.fn.name;
    const args = operation.args.map(visit);
    if (
      !args.length ||
      args.some(
        (argument) =>
          !argument ||
          interval.isEmpty(argument) ||
          !Number.isFinite(argument.lo) ||
          !Number.isFinite(argument.hi),
      )
    ) {
      return undefined;
    }
    const [a, b] = args as interval.Interval[];
    const unary = {
      sin: interval.sin,
      cos: interval.cos,
      tan: interval.tan,
      atan: interval.atan,
      sinh: interval.sinh,
      cosh: interval.cosh,
      tanh: interval.tanh,
      exp: interval.exp,
      abs: interval.abs,
    };
    if (name in unary) {
      return unary[name as keyof typeof unary](a);
    }
    switch (name) {
      case "add":
        return b && interval.add(a, b);
      case "subtract":
        return b && interval.subtract(a, b);
      case "unaryPlus":
        return a;
      case "unaryMinus":
        return interval.negative(a);
      case "multiply":
        return b && interval.multiply(a, b);
      case "divide":
        return b && !interval.zeroIn(b) ? interval.divide(a, b) : undefined;
      case "pow":
        return !b
          ? undefined
          : interval.isSingleton(b) && Number.isInteger(b.lo)
          ? interval.pow(a, b.lo)
          : a.lo > 0
          ? interval.exp(interval.multiply(b, interval.log(a)))
          : undefined;
      case "sqrt":
        return a.lo >= 0 ? interval.sqrt(a) : undefined;
      case "cbrt":
        return interval.nthRoot(a, 3);
      case "nthRoot":
        return b &&
          interval.isSingleton(b) &&
          Number.isInteger(b.lo) &&
          b.lo > 0 &&
          (a.lo >= 0 || b.lo % 2 === 1)
          ? interval.nthRoot(a, b.lo)
          : undefined;
      case "asin":
      case "acos":
        return a.lo >= -1 && a.hi <= 1 ? interval[name](a) : undefined;
      case "log":
        return a.lo > 0
          ? !b
            ? interval.log(a)
            : b.lo > 0 && !interval.hasValue(b, 1)
            ? interval.divide(interval.log(a), interval.log(b))
            : undefined
          : undefined;
      case "log2":
      case "log10":
        return a.lo > 0 ? interval[name](a) : undefined;
      case "floor":
      case "ceil":
      case "round":
      case "sign":
        return Math[name](a.lo) === Math[name](a.hi)
          ? new interval.Interval(Math[name](a.lo))
          : undefined;
      case "min":
      case "max":
        return (args as interval.Interval[]).reduce(interval[name]);
      default:
        return undefined;
    }
  };
  try {
    const result = visit(node);
    return result &&
      !interval.isEmpty(result) &&
      Number.isFinite(result.lo) &&
      Number.isFinite(result.hi)
      ? [result.lo, result.hi]
      : undefined;
  } catch {
    return undefined;
  }
};
