import { chat, parseJSON } from "./ai";
import { currentSettings } from "./settings";
import {
  calculate,
  compileExpression,
  defaultPlot,
  plotExpression,
  samplePlot,
} from "./math";
import { mathNotation } from "./mathNotation";
import { calculateAsync } from "./mathComputation";

import type { Plot } from "./math";

export type MathPenMode = "function" | "calculation";
export type MathResult =
  | { kind: "function"; plot: Plot }
  | {
      kind: "calculation";
      expression: string;
      answer: string;
      layout?: { mode: "column"; lines: number };
    };

/** This is the only function schema accepted from a model or command. No image/point data. */
export const validatedPlot = (value: Record<string, unknown>): Plot => {
  if (
    typeof value.expression !== "string" ||
    (value.surface !== undefined && typeof value.surface !== "boolean")
  ) {
    throw new Error("Invalid function expression");
  }
  const expression = plotExpression(mathNotation(value.expression));
  const surface = value.surface === true;
  const relation = value.relation;
  if (
    relation !== undefined &&
    (![">", ">=", "<", "<="].includes(String(relation)) || surface)
  ) {
    throw new Error("Unsupported inequality");
  }
  // A 2D graph has one independent variable. Never silently set y/z to zero.
  if (surface ? /\bz\b/.test(expression) : /\b[yz]\b/.test(expression)) {
    throw new Error("Unsupported independent variable");
  }
  compileExpression(expression);
  const plot: Plot = {
    ...defaultPlot,
    expression,
    surface,
    ...(relation ? { relation: relation as Plot["relation"] } : {}),
  };
  for (const key of ["x", "y", "z", "a", "b", "c", "range"] as const) {
    if (value[key] !== undefined) {
      const number = value[key];
      if (
        typeof number !== "number" ||
        !Number.isFinite(number) ||
        Math.abs(number) > 1000 ||
        (key === "range" && number <= 0)
      ) {
        throw new Error("Invalid function parameter");
      }
      plot[key] = number;
    }
  }
  samplePlot(plot);
  return plot;
};

export const localMathResult = (
  text: string,
  mode: MathPenMode,
): MathResult => {
  const input = mathNotation(text);
  if (mode === "calculation") {
    return { kind: mode, expression: input, answer: calculate(input) };
  }
  const definition = input.match(
    /^(y|z|f\s*x|f\s*\(\s*x(?:,\s*y)?\s*\))\s*(>=|<=|>|<|=)\s*(.+)$/i,
  );
  const expression = definition ? definition[3] : input;
  if (!definition && !/\bx\b/.test(expression)) {
    throw new Error("No explicit function");
  }
  return {
    kind: mode,
    plot: validatedPlot({
      expression,
      surface: !!definition && /^(z|f\(x,)/i.test(definition[1]),
      ...(definition && definition[2] !== "="
        ? { relation: definition[2] }
        : {}),
    }),
  };
};

const numbers = (input: string) =>
  input.match(/\d+(?:\.\d+)?/g)?.join(",") || "";

/** AI may transcribe notation; the local engine alone supplies values and plot geometry. */
export const recognizeMath = async (
  text: string,
  mode: MathPenMode,
  signal: AbortSignal,
): Promise<MathResult> => {
  signal.throwIfAborted();
  try {
    if (mode === "calculation") {
      const expression = mathNotation(text);
      return {
        kind: mode,
        expression,
        answer: await calculateAsync(expression, signal),
      };
    }
    return localMathResult(text, mode);
  } catch (failure) {
    const settings = currentSettings();
    if (
      !settings.apiKey ||
      !settings.model.trim() ||
      (mode === "function" && !/\bx\b/.test(text))
    ) {
      throw failure;
    }
  }
  const result = parseJSON(
    await chat(
      [
        {
          role: "system",
          content: `Transcribe mathematical notation, never solve or draw. Return only JSON {"version":1,"kind":"${mode}","source":"the exact input","expression":"mathjs expression"${
            mode === "function" ? ',"surface":false' : ""
          }} or {"none":true} when ambiguous, incomplete or unreadable. Preserve every number, sign, operation, variable, bound, row and column. Do not correct the question or infer missing terms. For functions return the RHS only; surface true only for explicit z=f(x,y). Inequalities require an additional "relation":">|>=|<|<=" copied exactly from the source; never replace an inequality with equality. For matrices use [a,b;c,d]. For calculus use integrate(expr,x), defint(expr,lo,hi,x), diff(expr,x), limit(expr,x,a). No answers, coordinates, images, code or tool calls.`,
        },
        { role: "user", content: text },
      ],
      signal,
      currentSettings(),
      { maxTokens: 800, timeoutMs: 6000 },
    ),
  ) as Record<string, unknown>;
  signal.throwIfAborted();
  const relation = text
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .match(/>=|<=|>|</)?.[0];
  const surface = /^(?:z\s*=|f\(x,\s*y\)\s*=)/i.test(text.trim());
  if (
    mode === "function" &&
    (result?.relation !== relation || result?.surface !== surface)
  ) {
    throw new Error("Function relationship changed during transcription");
  }
  if (
    !result ||
    result.version !== 1 ||
    result.kind !== mode ||
    result.source !== text ||
    typeof result.expression !== "string" ||
    Object.keys(result).some(
      (key) =>
        ![
          "version",
          "kind",
          "source",
          "expression",
          "surface",
          "relation",
        ].includes(key),
    ) ||
    numbers(result.expression) !==
      numbers(text.replace(/²/g, "2").replace(/³/g, "3"))
  ) {
    throw new Error("Ambiguous mathematical transcription");
  }
  if (mode === "function") {
    return { kind: mode, plot: validatedPlot(result) };
  }
  return {
    kind: mode,
    expression: result.expression,
    answer: await calculateAsync(result.expression, signal),
  };
};
