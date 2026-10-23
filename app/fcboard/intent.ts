import { mathNotation } from "./mathNotation";

import {
  prepareCalculation,
  compileExpression,
  normalizeExpression,
  plotExpression,
} from "./math";

/** A selected heading remains ink; an explicit question or instruction can act on the board. */
export const selectionRequest = (text: string) =>
  /[?？]\s*$/.test(text.trim()) ||
  /^(?:(?:请|帮我|麻烦)\s*)?(?:讲解|解释|教我|演示|画(?!布|笔|册)|绘制|生成|插入|计算|总结|概括|标注|录制|开始录制|停止录制|新建白板|切换白板|撤销|撤回|重做|删除选中|清空白板|为什么|如何|怎么)/.test(
    text.trim(),
  );

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
      prepareCalculation(expression);
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
  if (/^f\s*\(?x\)?\s*=\s*y$/i.test(normalized)) {
    return { action: "axes" as const };
  }
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
    prepareCalculation(normalized);
    return { action: "calculate" as const, expression: normalized };
  } catch {
    return null;
  }
};

/** One selection action: classify validated notation before considering prose. */
export const selectionAIAction = (
  text: string,
): "calculate" | "image" | "question" => {
  const intent = selectionMathIntent(text);
  if (intent?.action === "axes" || intent?.action === "plot") {
    return "image";
  }
  if (intent?.action === "calculate") {
    return "calculate";
  }
  const normalized = mathNotation(text);
  // An invalid explicit function must reach the strict math parser, never image generation.
  if (/^(?:[yz]|f\(x(?:,\s*y)?\))\s*[=<>]/i.test(normalized)) {
    return "image";
  }
  try {
    if (/\bx\b/.test(normalized) && /[+*/^(-]/.test(normalized)) {
      compileExpression(normalized);
      return "image";
    }
    if (/[+*/^%=!([\]-]/.test(normalized)) {
      prepareCalculation(normalized);
      return "calculate";
    }
  } catch {
    /* Ambiguous prose is handled as a question, without changing the source. */
  }
  return "question";
};
