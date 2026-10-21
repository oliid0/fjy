import { t } from "@excalidraw/excalidraw/i18n";
import { all, create } from "mathjs";
import nerdamer from "nerdamer/all";

const math = create(all);
const allowedFunctions = new Set([
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sinh",
  "cosh",
  "tanh",
  "sqrt",
  "cbrt",
  "abs",
  "log",
  "log10",
  "log2",
  "exp",
  "pow",
  "floor",
  "ceil",
  "round",
  "sign",
  "min",
  "max",
  "factorial",
  "gamma",
  "conj",
  "re",
  "im",
  "arg",
  "complex",
]);

export const normalizeExpression = (text: string) =>
  text
    .trim()
    .replace(/[＝]/g, "=")
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–]/g, "-")
    .replace(/π/g, "pi")
    .replace(/\s*=\s*$/, "");

export const compileExpression = (expression: string) => {
  if (!expression || expression.length > 500) {
    throw new Error(t("fcboard.请输入 500 字以内的数学表达式"));
  }
  const node = math.parse(normalizeExpression(expression));
  let count = 0;
  node.traverse((child) => {
    count++;
    if (
      count > 150 ||
      ![
        "OperatorNode",
        "ConstantNode",
        "SymbolNode",
        "FunctionNode",
        "ParenthesisNode",
      ].includes(child.type)
    ) {
      throw new Error(t("fcboard.该表达式包含不支持的操作"));
    }
    if (
      child.type === "FunctionNode" &&
      !allowedFunctions.has((child as import("mathjs").FunctionNode).fn.name)
    ) {
      throw new Error(t("fcboard.该函数不支持数值绘图，请使用计算功能"));
    }
    if (
      child.type === "SymbolNode" &&
      !/^(x|y|z|a|b|c|e|pi|i|Infinity|NaN)$/.test(
        (child as import("mathjs").SymbolNode).name,
      ) &&
      !allowedFunctions.has((child as import("mathjs").SymbolNode).name)
    ) {
      throw new Error(t("fcboard.未知变量；支持 x、y、z、a、b、c"));
    }
  });
  return node.compile();
};

export const calculate = (input: string): string => {
  const expression = normalizeExpression(input);
  if (expression.length > 500 || !/^[\w\s+\-*/^().,!=[\]]+$/.test(expression)) {
    throw new Error(t("fcboard.无法识别算式，请检查输入或使用 AI 识别手写"));
  }
  // Nerdamer supplies symbolic integration, differentiation, limits and equation solving.
  if (/^(integrate|defint|diff|limit|solve|sum|product)\(/.test(expression)) {
    const result = nerdamer(expression).toString();
    if (!result || result === "undefined") {
      throw new Error(t("fcboard.该算式没有可用结果"));
    }
    return result;
  }
  const result = compileExpression(expression).evaluate();
  return math.format(result, { precision: 14 });
};

export type Plot = {
  expression: string;
  surface: boolean;
  x: number;
  y: number;
  z: number;
  a: number;
  b: number;
  c: number;
  range: number;
};
export const defaultPlot: Plot = {
  expression: "x+1",
  surface: false,
  x: 0,
  y: 0,
  z: 0,
  a: 1,
  b: 1,
  c: 0,
  range: 10,
};

export const plotExpression = (input: string) =>
  normalizeExpression(input).replace(/^\s*(?:[yz]|f\(x(?:,y)?\))\s*=\s*/i, "");

export const project3D = (x: number, y: number, z: number) => [
  (x - y) * 0.7,
  (x + y) * 0.3 - z,
];

export const samplePlot = (plot: Plot): number[][][] => {
  const compiled = compileExpression(plotExpression(plot.expression));
  const lines: number[][][] = [];
  const value = (x: number, y: number) => {
    try {
      const result = compiled.evaluate({ ...plot, x, y });
      return typeof result === "number" && Number.isFinite(result)
        ? result
        : NaN;
    } catch {
      return NaN;
    }
  };
  if (!Number.isFinite(plot.range) || plot.range <= 0 || plot.range > 1000) {
    throw new Error(t("fcboard.坐标范围必须在 0 到 1000 之间"));
  }
  for (let grid = 0; grid < (plot.surface ? 22 : 1); grid++) {
    let line: number[][] = [];
    const flush = () => {
      if (line.length > 1) {
        lines.push(line);
      }
      line = [];
    };
    for (let i = 0; i <= 240; i++) {
      const u = -plot.range + (2 * plot.range * i) / 240;
      const v = -plot.range + (2 * plot.range * (grid % 11)) / 10;
      const x = (plot.surface && grid >= 11 ? v : u) + plot.x;
      const y = plot.surface ? (grid >= 11 ? u : v) + plot.y : plot.y;
      const result = value(x, y) + plot.z;
      if (
        !Number.isFinite(result) ||
        Math.abs(result) > plot.range ||
        (line.length &&
          Math.abs(
            (plot.surface ? project3D(x, y, result)[1] : -result) -
              line[line.length - 1][1],
          ) > plot.range)
      ) {
        flush();
        continue;
      }
      line.push(plot.surface ? project3D(x, y, result) : [x, -result]);
    }
    flush();
  }
  if (!lines.length) {
    throw new Error(t("fcboard.当前范围内没有可绘制的实数图像"));
  }
  return lines;
};
