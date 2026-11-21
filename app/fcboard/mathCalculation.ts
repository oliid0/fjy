import nerdamer from "nerdamer/all";

import {
  prepareCalculation,
  calculationEngine as engine,
  evaluateNumericCalculation,
} from "./calculationSyntax";
import { solveEquations } from "./equations";
import { continuousMathRange } from "./mathDomain";

export { prepareCalculation } from "./calculationSyntax";

export const calculateLocal = (input: string): string => {
  const { expression, symbolic, node } = prepareCalculation(input);
  if (!node) {
    return solveEquations(expression);
  }
  // Nerdamer supplies symbolic integration, differentiation, limits and equation solving.
  if (symbolic) {
    const fn = node as import("mathjs").FunctionNode;
    if (
      fn.fn.name === "solve" &&
      fn.args.length === 2 &&
      /^[xyz]$/.test(fn.args[1].toString())
    ) {
      return solveEquations(`${fn.args[0].toString()}=0`);
    }
    if (fn.fn.name === "defint") {
      const [body, low, high, variable] = fn.args;
      const left = Number(engine().evaluate(low.toString()));
      const right = Number(engine().evaluate(high.toString()));
      if (
        !Number.isFinite(left) ||
        !Number.isFinite(right) ||
        !/^[xyz]$/.test(variable.toString()) ||
        !continuousMathRange(body, {
          [variable.toString()]: [Math.min(left, right), Math.max(left, right)],
        })
      ) {
        throw new Error("fcboard.this_expression_has_no_available_result");
      }
    }
    const result = nerdamer(expression).toString();
    if (
      !result ||
      result.length > 4000 ||
      (fn.fn.name === "limit" && result.startsWith("[")) ||
      /undefined|NaN|Infinity|integrate\(|defint\(|limit\(|sum\(|product\(/.test(
        result,
      )
    ) {
      throw new Error("fcboard.this_expression_has_no_available_result");
    }
    if (
      fn.fn.name === "integrate" &&
      fn.args.length === 2 &&
      nerdamer(
        `diff(${result},${fn.args[1].toString()})-(${fn.args[0].toString()})`,
      ).toString() !== "0"
    ) {
      throw new Error("fcboard.this_expression_has_no_available_result");
    }
    return expression.startsWith("integrate(") ? `${result} + C` : result;
  }
  return evaluateNumericCalculation(node);
};
