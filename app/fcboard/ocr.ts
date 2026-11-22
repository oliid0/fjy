import { t } from "@fcboard/fcboard/i18n";

import { chat, visualMessage } from "./ai";
import { recognizeLocalMath } from "./localMathOcr";
import { mathNotation, unwrapMathColumn } from "./mathNotation";
import { currentSettings } from "./settings";
import {
  calculationInk,
  columnInkRows,
  divisionOperands,
  divisionSlashInk,
  hasStructuredMathInk,
  preservesMathInkStructure,
  trailingPowerInk,
  standaloneRadicand,
} from "./calculationInk";
import { hasDigitalInk, recognizeDigitalInk } from "./digitalInk";

import type { InkInput } from "./digitalInk";

const columnOperand = (text: string, index: number) => {
  if (/[=＝\r\n]/.test(text)) {
    return;
  }
  try {
    const value = mathNotation(text);
    const pattern = index
      ? /^[+*/xX-]\s*\d+(?:\.\d+)?$/
      : /^[+-]?\d+(?:\.\d+)?$/;
    return pattern.test(value) ? value : undefined;
  } catch {}
};

/** A caller action owns recognition; the two backends never read or mutate the board. */
export const recognizeHandwriting = async (
  image: string | (() => Promise<string>),
  signal: AbortSignal,
  progress: (message: string) => void,
  kind: "math" | "text" = "text",
  accept: (text: string) => boolean | Promise<boolean> = (text) =>
    !!text.trim(),
  strokes?: InkInput,
  languageHint?: string,
  chooseCandidate?: (candidates: readonly string[]) => Promise<string>,
  localOnly = false,
) => {
  signal.throwIfAborted();
  const settings = currentSettings();
  const structured =
    kind === "math" && !!strokes?.length && hasStructuredMathInk(strokes);
  const ending =
    kind === "math" && strokes ? calculationInk(strokes) : undefined;
  const equals = ending?.complete && ending.strokes === strokes;
  const recognitionStrokes = equals ? strokes!.slice(0, -2) : strokes;
  const columnRows =
    kind === "math" && strokes ? columnInkRows(strokes) : undefined;
  const accepted = (text: string) => {
    if (columnRows) {
      const rows = unwrapMathColumn(text)
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (/^[-_=─━]{2,}$/.test(rows.at(-1) || "")) {
        rows.pop();
      }
      if (rows.length !== columnRows.length) {
        return false;
      }
      return (
        rows.every(
          (row, index) =>
            columnOperand(row, index) !== undefined &&
            preservesMathInkStructure(columnRows[index], row),
        ) && accept(text)
      );
    }
    return (
      (!structured || preservesMathInkStructure(strokes!, text)) && accept(text)
    );
  };
  const selectCandidate = async (candidates: readonly string[]) => {
    const valid: string[] = [];
    for (const raw of candidates) {
      signal.throwIfAborted();
      const candidate = equals ? `${raw}=` : raw;
      if (await accepted(candidate)) {
        if (!chooseCandidate) {
          return candidate;
        }
        valid.push(candidate);
      }
    }
    if (valid.length && chooseCandidate) {
      return chooseCandidate(valid);
    }
  };
  let raster: Promise<string> | undefined;
  const capture = () =>
    (raster ||= Promise.resolve(typeof image === "string" ? image : image()));
  const cloud = async (request: AbortSignal) => {
    const text = (
      await chat(
        [
          {
            role: "system",
            content: `Transcribe only the selected handwriting, without solving, adding or guessing. Preserve line breaks, equals signs and variables. Return an empty string when unreadable.${
              languageHint === "en-US" && kind === "text"
                ? " The writing surface is for English letters and words."
                : kind === "math"
                ? " For a simple horizontal arithmetic expression return plain digits and + - * / =. For complex or two-dimensional mathematics return standard LaTeX, not flattened prose: use \\frac{numerator}{denominator}, braced superscripts/subscripts, \\sqrt[n]{...}, \\log_{base}, explicit \\sin/\\cos/etc., degree markers ^\\circ only if written, complete integral/sum/product bounds and differentials, and matrix environments with exact rows/columns. Identify fraction bars by operands above AND below, distinguish minus from fraction bars and variable x from multiplication. Do not add parentheses, degrees, multiplication signs, missing terms, or change a function's scope without visual evidence. Keep leading signs, decimal points, nested fractions and parentheses. Handwritten ÷ is division: preserve both dots and transcribe it as / or \\div, never as minus. Preserve complete definitions such as f(x)=1/x^2+x. For vertical arithmetic preserve operand line breaks and the final horizontal bar as ----; do not confuse it with a minus or equals sign, and never drop the written operator. Long division is divisor)dividend. Return only the exact transcription without Markdown, explanation, inferred correction or answer. If any essential symbol or scope is ambiguous return an empty string."
                : ""
            }`,
          },
          visualMessage("Transcribe this selection.", await capture()),
        ],
        request,
        { ...settings, model: settings.ocrModel || settings.model },
        { maxTokens: 1024, timeoutMs: 6000 },
      )
    ).trim();
    if (!(await accepted(text))) {
      throw new Error(t("fcboard.no_content_recognized_select_the_area_again"));
    }
    return text;
  };
  const local = async (request: AbortSignal) => {
    if (import.meta.env.VITE_NATIVE_INFERENCE !== "true") {
      if (!hasDigitalInk()) {
        const { recognizeLocalHandwriting } = await import("./localOcr");
        const text = await recognizeLocalHandwriting(
          await capture(),
          request,
          progress,
        );
        if (!(await accepted(text))) {
          throw new Error(
            t("fcboard.no_content_recognized_select_the_area_again"),
          );
        }
        return text;
      }
    }
    throw new Error("Native handwriting could not recognize this ink");
  };
  const useCloud =
    !localOnly && settings.ocr !== "local" && !!settings.apiKey.trim();
  const cloudFirst = settings.ocr === "cloud" && useCloud;
  if (cloudFirst) {
    try {
      const value = await cloud(signal);
      signal.throwIfAborted();
      return chooseCandidate ? chooseCandidate([value]) : value;
    } catch {
      signal.throwIfAborted();
    }
  }
  if (columnRows) {
    progress(t("fcboard.recognizing_handwriting_locally"));
    try {
      const rows: string[] = [];
      for (const [index, row] of columnRows.entries()) {
        const operand = (candidates: string[]) =>
          candidates
            .filter((candidate) => preservesMathInkStructure(row, candidate))
            .map((candidate) => columnOperand(candidate, index))
            .find(Boolean);
        let value: string | undefined;
        if (hasDigitalInk()) {
          const candidates = await recognizeDigitalInk(
            row,
            signal,
            "math",
            languageHint,
          ).catch(() => {
            signal.throwIfAborted();
            return [];
          });
          value = operand(candidates);
        }
        if (!value) {
          value = operand(await recognizeLocalMath(row, signal));
        }
        if (!value) {
          break;
        }
        rows.push(value);
      }
      const text = rows.join("\n");
      if (await accepted(text)) {
        signal.throwIfAborted();
        return chooseCandidate ? chooseCandidate([text]) : text;
      }
    } catch {
      signal.throwIfAborted();
    }
  }
  let mathFailure: unknown;
  if (kind === "math" && recognitionStrokes?.length) {
    progress(t("fcboard.recognizing_handwriting_locally"));
    try {
      const candidates = await recognizeLocalMath(recognitionStrokes, signal);
      const value = await selectCandidate(candidates);
      signal.throwIfAborted();
      if (value) {
        return value;
      }
      mathFailure = new Error(
        t("fcboard.no_content_recognized_select_the_area_again"),
      );
    } catch (error) {
      signal.throwIfAborted();
      mathFailure = error;
    }
  }
  if (!structured && hasDigitalInk() && recognitionStrokes?.length) {
    progress(t("fcboard.recognizing_handwriting_locally"));
    try {
      const candidates = await recognizeDigitalInk(
        recognitionStrokes,
        signal,
        kind,
        languageHint,
      );
      const text = await selectCandidate(candidates);
      signal.throwIfAborted();
      if (text) {
        return text;
      }
      throw new Error(t("fcboard.no_content_recognized_select_the_area_again"));
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "HANDWRITING_MODEL_REQUIRED" &&
        kind !== "math"
      ) {
        throw error;
      }
      if (localOnly) {
        throw error;
      }
      // A missing explicitly selected text pack is actionable; other native
      // failures can use the separately bundled local raster model.
    }
  }
  if (structured && !columnRows && recognitionStrokes) {
    const radicand = standaloneRadicand(recognitionStrokes);
    if (radicand) {
      try {
        const [operand] = await recognizeLocalMath(radicand, signal);
        if (/^(?:[xyz]|[+-]?\d+(?:\.\d+)?)$/i.test(operand)) {
          const value = await selectCandidate([String.raw`\sqrt{${operand}}`]);
          if (value) {
            return value;
          }
        }
      } catch {
        signal.throwIfAborted();
      }
    }
    const power = trailingPowerInk(recognitionStrokes);
    if (power) {
      try {
        const base = (await recognizeLocalMath(power.base, signal))[0].trim();
        const exponent = (
          await recognizeLocalMath(power.exponent, signal)
        )[0].trim();
        // Only recombine an atomic base with an independently read raised operand.
        if (
          /^(?:(?:y|[fgh]\s*\(\s*x\s*\))\s*=\s*)?(?:[exyz]|\d+(?:\.\d+)?)$/i.test(
            base,
          ) &&
          /^(?:[1-9]\d*|[xyz])$/i.test(exponent)
        ) {
          const text = `${base}^{${exponent}}${equals ? "=" : ""}`;
          if (await accepted(text)) {
            return chooseCandidate ? chooseCandidate([text]) : text;
          }
        }
      } catch {
        signal.throwIfAborted();
      }
    }
  }
  const slashInk =
    structured && recognitionStrokes && divisionSlashInk(recognitionStrokes);
  if (slashInk) {
    try {
      const candidates =
        hasDigitalInk() && !hasStructuredMathInk(slashInk)
          ? await recognizeDigitalInk(slashInk, signal, "math", languageHint)
          : await recognizeLocalMath(slashInk, signal);
      const text = await selectCandidate(candidates);
      if (text) {
        return text;
      }
    } catch {
      signal.throwIfAborted();
    }
  }
  if (slashInk && hasDigitalInk() && recognitionStrokes) {
    const operands = divisionOperands(recognitionStrokes);
    if (operands && !operands.some(hasStructuredMathInk)) {
      const numeric = /^[+−-]?\d+(?:\.\d+)?$/;
      try {
        const [dividend, divisor] = await Promise.all(
          operands.map((operand) =>
            recognizeDigitalInk(operand, signal, "math", languageHint).then(
              (candidates) => candidates[0]?.trim() || "",
            ),
          ),
        );
        // A trailing equality on the right belongs to the written expression.
        // Only use the highest-ranked transcription of each complete operand.
        if (
          numeric.test(dividend) &&
          numeric.test(divisor.replace(/[=＝]$/, "").trim())
        ) {
          const text = `${dividend}/${divisor}${equals ? "=" : ""}`;
          signal.throwIfAborted();
          if (await accepted(text)) {
            return chooseCandidate ? chooseCandidate([text]) : text;
          }
        }
      } catch {
        signal.throwIfAborted();
      }
    }
  }
  try {
    if (
      (import.meta.env.VITE_NATIVE_INFERENCE === "true" || hasDigitalInk()) &&
      mathFailure
    ) {
      throw mathFailure;
    }
    if (structured) {
      throw new Error(t("fcboard.no_content_recognized_select_the_area_again"));
    }
    const value = await local(signal);
    signal.throwIfAborted();
    return chooseCandidate ? chooseCandidate([value]) : value;
  } catch (failure) {
    signal.throwIfAborted();
    if (!useCloud || cloudFirst) {
      throw failure;
    }
    // Automatic routing is sequential: a successful local task never starts
    // a cloud competitor, and cloud cancellation cannot cancel local inference.
    progress(t("fcboard.recognizing_handwriting"));
    const value = await cloud(signal);
    signal.throwIfAborted();
    return chooseCandidate ? chooseCandidate([value]) : value;
  }
};
