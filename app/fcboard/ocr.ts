import { t } from "@fcboard/fcboard/i18n";

import { chat, visualMessage } from "./ai";
import { recognizeLocalMath } from "./localMathOcr";
import { currentSettings } from "./settings";
import {
  calculationInk,
  hasStructuredMathInk,
  preservesMathInkStructure,
} from "./calculationInk";
import {
  hasDigitalInk,
  prepareDigitalInk,
  recognizeDigitalInk,
} from "./digitalInk";

import type { InkInput } from "./digitalInk";

export const warmHandwriting = async () => {
  if (currentSettings().ocr === "cloud") {
    return;
  }
  // Gate the imports themselves: Vite discovers worker assets before Rollup
  // removes code following an unconditional native return.
  if (import.meta.env.VITE_NATIVE_INFERENCE !== "true") {
    if (!hasDigitalInk()) {
      const { warmHandwriting } = await import("./localOcr");
      return warmHandwriting();
    }
  }
  return prepareDigitalInk();
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
  const recognitionStrokes =
    kind === "math" && strokes ? calculationInk(strokes).strokes : strokes;
  const accepted = (text: string) =>
    (!structured || preservesMathInkStructure(strokes!, text)) && accept(text);
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
              languageHint === "en-US"
                ? " The writing surface is for English letters and words."
                : kind === "math"
                ? " For a simple horizontal arithmetic expression return plain digits and + - * / =. For complex or two-dimensional mathematics return standard LaTeX, not flattened prose: use \\frac{numerator}{denominator}, braced superscripts/subscripts, \\sqrt[n]{...}, \\log_{base}, explicit \\sin/\\cos/etc., degree markers ^\\circ only if written, complete integral/sum/product bounds and differentials, and matrix environments with exact rows/columns. Identify fraction bars by operands above AND below, distinguish minus from fraction bars and variable x from multiplication. Do not add parentheses, degrees, multiplication signs, missing terms, or change a function's scope without visual evidence. Keep leading signs, decimal points, nested fractions and parentheses. Handwritten ÷ or ➗ is division: preserve both dots and transcribe it as / or \\div, never as minus. Preserve complete definitions such as f(x)=1/x^2+x. For vertical arithmetic preserve operand line breaks and the final horizontal bar as ----; do not confuse it with a minus or equals sign, and never drop the written operator. Long division is divisor)dividend. Return only the exact transcription without Markdown, explanation, inferred correction or answer. If any essential symbol or scope is ambiguous return an empty string."
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
  if (!structured && hasDigitalInk() && recognitionStrokes?.length) {
    progress(t("fcboard.recognizing_handwriting_locally"));
    try {
      const candidates = await recognizeDigitalInk(
        recognitionStrokes,
        signal,
        kind,
        languageHint,
      );
      const accepted: string[] = [];
      for (const candidate of candidates) {
        signal.throwIfAborted();
        if (await accept(candidate)) {
          accepted.push(candidate);
          if (!chooseCandidate) {
            break;
          }
        }
      }
      const text = accepted[0];
      if (text) {
        const chosen = chooseCandidate ? await chooseCandidate(accepted) : text;
        signal.throwIfAborted();
        return chosen;
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
  let mathFailure: unknown;
  if (kind === "math" && strokes?.length) {
    progress(t("fcboard.recognizing_handwriting_locally"));
    try {
      const value = await recognizeLocalMath(
        hasDigitalInk() ? strokes : recognitionStrokes!,
        signal,
      );
      signal.throwIfAborted();
      if (await accepted(value)) {
        return chooseCandidate ? chooseCandidate([value]) : value;
      }
      mathFailure = new Error(
        t("fcboard.no_content_recognized_select_the_area_again"),
      );
    } catch (error) {
      signal.throwIfAborted();
      mathFailure = error;
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
