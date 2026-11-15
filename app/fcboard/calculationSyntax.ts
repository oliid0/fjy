import { all, create } from "mathjs";

import { scientificFunctions } from "./mathFunctions";
import { calculationNotation } from "./mathNotation";

let calculator: ReturnType<typeof create>;
export const calculationEngine = () =>
  (calculator ||= create(all, {
    number: "BigNumber",
    precision: 64,
    relTol: 1e-60,
    absTol: 1e-63,
  }));

export const prepareCalculation = (input: string) => {
  const expression = calculationNotation(input);
  if (
    !expression ||
    expression.length > 500 ||
    !/^[\w\s+\-*/^%().,!;=[\]]+$/.test(expression)
  ) {
    throw new Error(
      "fcboard.could_not_recognize_the_expression_check_your_input_or_recognize_the_handwriting",
    );
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
    ...scientificFunctions,
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
  const node = calculationEngine().parse(expression);
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
      throw new Error(
        "fcboard.this_expression_contains_unsupported_operations",
      );
    }
    if (child.type === "SymbolNode") {
      const name = (child as import("mathjs").SymbolNode).name;
      if (
        !functions.has(name) &&
        !(symbolic ? /^(x|y|z|a|b|c|k|n|e|pi|i|Infinity)$/ : /^(e|pi|i)$/).test(
          name,
        )
      ) {
        throw new Error("fcboard.this_expression_has_no_available_result");
      }
    }
    if (
      child.type === "FunctionNode" &&
      !functions.has((child as import("mathjs").FunctionNode).fn.name)
    ) {
      throw new Error(
        "fcboard.this_expression_contains_unsupported_operations",
      );
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
        throw new Error(
          "fcboard.this_expression_contains_unsupported_operations",
        );
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
      throw new Error(
        "fcboard.this_expression_contains_unsupported_operations",
      );
    }
    if (child.type === "ConstantNode") {
      const exponent = String(
        (child as import("mathjs").ConstantNode).value,
      ).match(/e([+-]?\d+)$/i);
      if (exponent && Math.abs(Number(exponent[1])) > 1000) {
        throw new Error(
          "fcboard.this_expression_contains_unsupported_operations",
        );
      }
    }
  });
  // Validate every node before evaluating any guard. Check children first so
  // composed exponents are allowed without evaluating an unchecked huge power.
  const operations: import("mathjs").MathNode[] = [];
  node.traverse((child) => operations.push(child));
  for (const child of operations.reverse()) {
    if (child.type !== "OperatorNode" && child.type !== "FunctionNode") {
      continue;
    }
    const operation = child as
      | import("mathjs").OperatorNode
      | import("mathjs").FunctionNode;
    const name =
      typeof operation.fn === "string" ? operation.fn : operation.fn.name;
    if (
      ![
        "pow",
        "factorial",
        "gamma",
        "combinations",
        "permutations",
        "combinationsWithRep",
      ].includes(name) ||
      (symbolic && name === "pow")
    ) {
      continue;
    }
    const args = name === "pow" ? operation.args.slice(1, 2) : operation.args;
    for (const argument of args) {
      const value = argument.compile().evaluate();
      const magnitude = Number(calculationEngine().abs(value));
      if (
        !Number.isFinite(magnitude) ||
        magnitude > (name === "pow" ? 1000 : 200)
      ) {
        throw new Error(
          "fcboard.this_expression_contains_unsupported_operations",
        );
      }
    }
  }

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
