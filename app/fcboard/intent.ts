import {
  recognitionPattern,
  recognitionVocabulary,
} from "./recognitionVocabulary";
import { mathNotation } from "./mathNotation";

import {
  prepareCalculation,
  compileExpression,
  normalizeExpression,
  plotExpression,
} from "./math";

/** Both resource topics and spoken requests use the same visualization vocabulary. */
export const visualizationTopic = (text: string) =>
  recognitionPattern("intent_0").test(text);

/** Explicit chart requests bypass command planning and the single-function route. */
export const visualizationRequest = (text: string) => {
  if (recognitionPattern("intent_1").test(text)) {
    return null;
  }
  return visualizationTopic(text) &&
    recognitionPattern("intent_2").test(text.trim())
    ? text.trim()
    : null;
};

/** A selected heading remains ink; an explicit question or instruction can act on the board. */
export const selectionRequest = (text: string) =>
  /[?？]\s*$/.test(text.trim()) ||
  recognitionPattern("intent_3").test(text.trim());

const spokenExpression = (text: string) =>
  normalizeExpression(
    recognitionVocabulary.spokenMath
      .reduce(
        (value, token) =>
          value.replace(new RegExp(token.pattern, "gi"), token.value),
        text,
      )
      .replace(/[.!?\u3002\uFF01\uFF1F]+$/, "")
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
  const functionMatch = text.match(recognitionPattern("intent_4"));
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
    const calculation = text.match(recognitionPattern("intent_5"));
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
