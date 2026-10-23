import { t } from "@excalidraw/excalidraw/i18n";
import { all, create } from "mathjs";

import { mathNotation } from "./mathNotation";
import { allowedFunctions } from "./mathFunctions";
import { continuousMathRange } from "./mathDomain";

const math = create(all);

export const normalizeExpression = (text: string) =>
  text
    .trim()
    .replace(/＝/g, "=")
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–]/g, "-")
    .replace(/π/g, "pi")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/\s*=\s*$/, "");

export const compileExpression = (expression: string) => {
  if (!expression || expression.length > 500) {
    throw new Error(t("fcboard.请输入 500 字以内的数学表达式"));
  }
  const node = math.parse(mathNotation(expression));
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

export {
  calculateLocal as calculate,
  prepareCalculation,
} from "./mathCalculation";

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
  relation?: ">" | ">=" | "<" | "<=";
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
  const domain = math.parse(mathNotation(plotExpression(plot.expression)));
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
    let previousValue: number | undefined;
    for (let i = 0; i <= 240; i++) {
      const u = -plot.range + (2 * plot.range * i) / 240;
      const v = -plot.range + (2 * plot.range * (grid % 11)) / 10;
      const x = (plot.surface && grid >= 11 ? v : u) + plot.x;
      const y = plot.surface ? (grid >= 11 ? u : v) + plot.y : plot.y;
      const result = value(x, y) + plot.z;
      const midX = x - (plot.surface && grid >= 11 ? 0 : plot.range / 240);
      const midY = y - (plot.surface && grid >= 11 ? plot.range / 240 : 0);
      const midpoint = value(midX, midY) + plot.z;
      const continuous = continuousMathRange(domain, {
        x: [x - (plot.surface && grid >= 11 ? 0 : (2 * plot.range) / 240), x],
        y: [y - (plot.surface && grid >= 11 ? (2 * plot.range) / 240 : 0), y],
        a: [plot.a, plot.a],
        b: [plot.b, plot.b],
        c: [plot.c, plot.c],
      });
      const discontinuous =
        previousValue !== undefined &&
        (!continuous ||
          !Number.isFinite(midpoint) ||
          Math.abs(midpoint - (previousValue + result) / 2) > plot.range / 4);
      if (
        !Number.isFinite(result) ||
        discontinuous ||
        Math.abs(result) > plot.range ||
        (line.length &&
          Math.abs(
            (plot.surface ? project3D(x, y, result)[1] : -result) -
              line[line.length - 1][1],
          ) > plot.range)
      ) {
        flush();
        previousValue = result;
        continue;
      }
      line.push(plot.surface ? project3D(x, y, result) : [x, -result]);
      previousValue = result;
    }
    flush();
  }
  if (!lines.length && !plot.relation) {
    throw new Error(t("fcboard.当前范围内没有可绘制的实数图像"));
  }
  return lines;
};

/** Locally clipped inequality regions. Undefined domains and discontinuities split polygons. */
export const sampleInequality = (plot: Plot): number[][][] => {
  if (!plot.relation || plot.surface) {
    return [];
  }
  const compiled = compileExpression(plot.expression);
  const domain = math.parse(mathNotation(plot.expression));
  const polygons: number[][][] = [];
  let boundary: number[][] = [];
  const edge = plot.relation.startsWith(">") ? -plot.range : plot.range;
  const flush = () => {
    if (boundary.length > 1 && boundary.some(([, y]) => y !== edge)) {
      polygons.push([
        ...boundary,
        [boundary[boundary.length - 1][0], edge],
        [boundary[0][0], edge],
        boundary[0],
      ]);
    }
    boundary = [];
  };
  let previous: number | undefined;
  for (let i = 0; i <= 480; i++) {
    const x = -plot.range + (i * plot.range) / 240;
    try {
      const value = compiled.evaluate({ ...plot, x, y: plot.y });
      const middle = compiled.evaluate({
        ...plot,
        x: x - plot.range / 480,
        y: plot.y,
      });
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        typeof middle !== "number" ||
        !Number.isFinite(middle) ||
        (previous !== undefined &&
          (!continuousMathRange(domain, {
            x: [x - plot.range / 240, x],
            y: [plot.y, plot.y],
            a: [plot.a, plot.a],
            b: [plot.b, plot.b],
            c: [plot.c, plot.c],
          }) ||
            Math.abs(middle - (previous + value) / 2) > plot.range / 4))
      ) {
        flush();
        previous = undefined;
        continue;
      }
      boundary.push([
        x,
        -Math.max(-plot.range, Math.min(plot.range, value + plot.z)),
      ]);
      previous = value;
    } catch {
      flush();
      previous = undefined;
    }
  }
  flush();
  return polygons;
};
