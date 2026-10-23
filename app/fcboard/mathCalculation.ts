import { all, create } from "mathjs";
import nerdamer from "nerdamer/all";

import { allowedFunctions } from "./mathFunctions";
import { mathNotation } from "./mathNotation";
import { solveEquations } from "./equations";
import { continuousMathRange } from "./mathDomain";

const calculator = create(all, {
  number: "BigNumber",
  precision: 64,
  relTol: 1e-60,
  absTol: 1e-63,
});

export const prepareCalculation = (input: string) => {
  const expression = mathNotation(input);
  if (
    !expression ||
    expression.length > 500 ||
    !/^[\w\s+\-*/^%().,!;=[\]]+$/.test(expression)
  ) {
    throw new Error("fcboard.无法识别算式，请检查输入或使用 AI 识别手写");
  }
  if (expression.includes("=")) {
    if (!/\b[xyz]\b/.test(expression)) {
      throw new Error(
        "A completed numeric equality is not a calculation request",
      );
    }
    return { expression, symbolic: false, node: undefined };
  }
  const symbolic = /^(integrate|defint|diff|limit|solve|sum|product)\(/.test(
    expression,
  );
  const functions = new Set([
    ...allowedFunctions,
    "det",
    "inv",
    "transpose",
    "trace",
    "cross",
    "dot",
    ...(symbolic
      ? ["integrate", "defint", "diff", "limit", "solve", "sum", "product"]
      : []),
  ]);
  const node = calculator.parse(expression);
  let count = 0;
  node.traverse((child) => {
    if (
      ++count > 150 ||
      ![
        "ConstantNode",
        "SymbolNode",
        "FunctionNode",
        "OperatorNode",
        "ParenthesisNode",
        "ArrayNode",
      ].includes(child.type)
    ) {
      throw new Error("fcboard.该表达式包含不支持的操作");
    }
    if (child.type === "SymbolNode") {
      const name = (child as import("mathjs").SymbolNode).name;
      if (
        !functions.has(name) &&
        !(symbolic ? /^(x|y|z|a|b|c|k|n|e|pi|i|Infinity)$/ : /^(e|pi|i)$/).test(
          name,
        )
      ) {
        throw new Error("fcboard.该算式没有可用结果");
      }
    }
    if (
      child.type === "FunctionNode" &&
      !functions.has((child as import("mathjs").FunctionNode).fn.name)
    ) {
      throw new Error("fcboard.该表达式包含不支持的操作");
    }
    if (
      child.type === "FunctionNode" &&
      ["sum", "product"].includes(
        (child as import("mathjs").FunctionNode).fn.name,
      )
    ) {
      const args = (child as import("mathjs").FunctionNode).args;
      const bound = args[3]?.toString() || "";
      if (/^[\d.e+-]+$/i.test(bound) && Math.abs(Number(bound)) > 1000) {
        throw new Error("fcboard.该表达式包含不支持的操作");
      }
    }
    if (
      child.type === "ConstantNode" &&
      (!/^[\d.e+-]+$/i.test(
        String((child as import("mathjs").ConstantNode).value),
      ) ||
        String((child as import("mathjs").ConstantNode).value).replace(
          /[^\d]/g,
          "",
        ).length > 50)
    ) {
      throw new Error("fcboard.该表达式包含不支持的操作");
    }
    if (child.type === "ConstantNode") {
      const exponent = String(
        (child as import("mathjs").ConstantNode).value,
      ).match(/e([+-]?\d+)$/i);
      if (exponent && Math.abs(Number(exponent[1])) > 1000) {
        throw new Error("fcboard.该表达式包含不支持的操作");
      }
    }
    if (child.type === "OperatorNode" || child.type === "FunctionNode") {
      const operation = child as
        | import("mathjs").OperatorNode
        | import("mathjs").FunctionNode;
      const name =
        typeof operation.fn === "string" ? operation.fn : operation.fn.name;
      if (["pow", "factorial", "gamma"].includes(name)) {
        const argument = operation.args[name === "pow" ? 1 : 0];
        const notation = argument?.toString() || "";
        const literal =
          /^[\d\s.+\-()/]+$/.test(notation) && notation.length < 100
            ? Number(calculator.evaluate(notation))
            : NaN;
        if (symbolic && name === "pow") {
          return;
        }
        if (
          !Number.isFinite(literal) ||
          Math.abs(literal) > (name === "pow" ? 1000 : 200)
        ) {
          throw new Error("fcboard.该表达式包含不支持的操作");
        }
      }
    }
  });
  if (symbolic && node.type !== "FunctionNode") {
    throw new Error("Unsupported symbolic expression");
  }
  if (
    symbolic &&
    (node as import("mathjs").FunctionNode).fn.name === "limit" &&
    /\b(?:abs|floor|ceil|round|sign|min|max)\(/.test(expression)
  ) {
    throw new Error("Unsupported nonsmooth limit");
  }
  return { expression, symbolic, node };
};

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
      const left = Number(calculator.evaluate(low.toString()));
      const right = Number(calculator.evaluate(high.toString()));
      if (
        !Number.isFinite(left) ||
        !Number.isFinite(right) ||
        !/^[xyz]$/.test(variable.toString()) ||
        !continuousMathRange(body, {
          [variable.toString()]: [Math.min(left, right), Math.max(left, right)],
        })
      ) {
        throw new Error("fcboard.该算式没有可用结果");
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
      throw new Error("fcboard.该算式没有可用结果");
    }
    if (
      fn.fn.name === "integrate" &&
      fn.args.length === 2 &&
      nerdamer(
        `diff(${result},${fn.args[1].toString()})-(${fn.args[0].toString()})`,
      ).toString() !== "0"
    ) {
      throw new Error("fcboard.该算式没有可用结果");
    }
    return expression.startsWith("integrate(") ? `${result} + C` : result;
  }
  const result = calculator.format(node.compile().evaluate(), {
    precision: 32,
  });
  if (
    !result ||
    result.length > 4000 ||
    /NaN|Infinity|undefined/.test(result)
  ) {
    throw new Error("fcboard.该算式没有可用结果");
  }
  return result;
};
