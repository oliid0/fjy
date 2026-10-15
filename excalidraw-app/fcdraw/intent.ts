import {
  calculate,
  compileExpression,
  normalizeExpression,
  plotExpression,
} from "./math";

const spokenExpression = (text: string) =>
  normalizeExpression(
    text
      .replace(/等于/g, "=")
      .replace(/加上?|减去?|乘以?|除以/g, (word) =>
        word.startsWith("加")
          ? "+"
          : word.startsWith("减")
          ? "-"
          : word.startsWith("乘")
          ? "*"
          : "/",
      )
      .replace(/的平方|平方/g, "^2")
      .replace(/的立方|立方/g, "^3")
      .replace(/[零一二三四五六七八九]/g, (word) =>
        String("零一二三四五六七八九".indexOf(word)),
      )
      .replace(/(?:的)?(?:函数)?(?:图像|图象|曲线|曲面)[。！!？?]*$/, "")
      .replace(/[。！!？?]+$/, "")
      .replace(/\s+/g, "")
      .trim(),
  );

/** Only deterministic expressions take the local route; ambiguous requests go to visual AI. */
export const localMathIntent = (
  text: string,
):
  | { action: "plot"; expression: string; surface: boolean }
  | { action: "calculate"; expression: string }
  | null => {
  const functionMatch = text.match(/([yz])\s*(?:=|等于)\s*(.+)/i);
  try {
    if (functionMatch) {
      const expression = plotExpression(spokenExpression(functionMatch[2]));
      compileExpression(expression);
      return {
        action: "plot",
        expression,
        surface: functionMatch[1].toLowerCase() === "z",
      };
    }
    const calculation = text.match(/(?:计算|求值)(?:一下)?\s*[:：]?\s*(.+)/);
    if (calculation) {
      const expression = spokenExpression(calculation[1]);
      calculate(expression);
      return { action: "calculate", expression };
    }
  } catch {
    /* The configured model can interpret natural or handwritten mathematics. */
  }
  return null;
};

/** Selection is an implicit math request; ordinary prose and lone labels stay untouched. */
export const selectionMathIntent = (text: string) => {
  const normalized = normalizeExpression(text).trim();
  const intent = localMathIntent(normalized);
  if (intent) {
    return intent;
  }
  const fn = normalized.match(/^f\(x(,\s*y)?\)\s*=\s*(.+)$/i);
  if (fn) {
    try {
      compileExpression(fn[2]);
      return { action: "plot" as const, expression: fn[2], surface: !!fn[1] };
    } catch {
      return null;
    }
  }
  if (!/[+*/^=()-]/.test(normalized) || /[\u3400-\u9fff]/.test(normalized)) {
    return null;
  }
  try {
    calculate(normalized);
    return { action: "calculate" as const, expression: normalized };
  } catch {
    return null;
  }
};
