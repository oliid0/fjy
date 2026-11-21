import { calculateLocal, prepareCalculation } from "./mathCalculation";

const scientific = async (expression: string) => {
  const prepared = prepareCalculation(expression);
  if (prepared.symbolic || !prepared.node) {
    return calculateLocal(expression);
  }
  // These mathjs LaTeX serializers have been checked against the pinned CE.
  // Other installed calculator operations (statistics, matrices, etc.) retain
  // mathjs evaluation, also inside this terminable worker.
  const supported = new Set([
    "sin",
    "cos",
    "tan",
    "asin",
    "acos",
    "atan",
    "sinh",
    "cosh",
    "tanh",
    "asinh",
    "acosh",
    "atanh",
    "cot",
    "sec",
    "csc",
    "sqrt",
    "cbrt",
    "abs",
    "log",
    "log2",
    "log10",
    "exp",
    "factorial",
    "combinations",
  ]);
  let compatible = true;
  prepared.node.traverse((node) => {
    if (
      node.type === "FunctionNode" &&
      !supported.has((node as import("mathjs").FunctionNode).fn.name)
    ) {
      compatible = false;
    }
  });
  return compatible
    ? (await import("./latexCalculation")).calculateLatex(prepared.node.toTex())
    : calculateLocal(expression);
};

self.onmessage = async (
  event: MessageEvent<{ expression?: string; latex?: string }>,
) => {
  try {
    const answer =
      typeof event.data.latex === "string"
        ? (await import("./latexCalculation")).calculateLatex(event.data.latex)
        : await scientific(event.data.expression || "");
    self.postMessage({ answer });
  } catch (failure) {
    self.postMessage({
      error: failure instanceof Error ? failure.message : String(failure),
    });
  }
};
