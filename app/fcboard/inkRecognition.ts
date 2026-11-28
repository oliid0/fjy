import { getLanguage, t } from "@fcboard/fcboard/i18n";

import { chat, parseJSON, visualMessage } from "./ai";
import { recognizeHandwriting } from "./ocr";
import { localFunctionResult, recognizeMath } from "./mathRecognition";
import { prepareCalculation } from "./math";
import { currentSettings } from "./settings";
import { mathNotation } from "./mathNotation";
import { explainLanguage, translateLanguageImage } from "./languageStudy";
import { columnCalculation } from "./columnCalculation";
import {
  calculationInk,
  columnInkRows,
  numericSumCandidate,
} from "./calculationInk";
import { calculateAsync } from "./mathComputation";
import { fitInkShape, isShapeClosed } from "./shapeRecognition";
import { hasDigitalInk, recognizeNativeInk } from "./digitalInk";
import { selectionImagePrompt } from "./selectionImagePrompt";

import type { RecognizedShape } from "./shapeRecognition";

import type { LanguageStudy } from "./languageStudy";

import type { InkInput } from "./digitalInk";
import type { MathResult } from "./mathRecognition";

export type InkAssistMode =
  | "text"
  | "shape"
  | "magic"
  | "function"
  | "language"
  | "calculation";
export const inkAssistMode = (value: unknown): InkAssistMode | undefined =>
  ["text", "shape", "magic", "function", "calculation", "language"].includes(
    String(value),
  )
    ? (value as InkAssistMode)
    : undefined;
export type InkRecognitionResult =
  | { kind: "text"; text: string }
  | {
      kind: "language";
      text?: string;
      study?: LanguageStudy;
      translation: string;
      targetLanguage: string;
    }
  | RecognizedShape
  | { kind: "magic"; prompt: string; image?: string; transparent?: boolean }
  | (Extract<MathResult, { kind: "function" }> & { text: string; cloud?: true })
  | (Omit<Extract<MathResult, { kind: "calculation" }>, "expression"> & {
      expression?: string;
      text?: string;
      hasEquals?: boolean;
    });

export const calculationAnswerText = (
  result: Extract<InkRecognitionResult, { kind: "calculation" }>,
) =>
  `${
    result.layout ||
    (result.hasEquals ?? /=\s*$/.test(result.text || "")) ||
    (result.hasEquals === undefined
      ? /^[xyz] =/.test(result.answer)
      : /^[a-z]\s*=/.test(result.answer))
      ? ""
      : "= "
  }${result.answer}`;

export const inkRecognitionDelay = (mode: InkAssistMode, strokes: InkInput) => {
  if (mode === "calculation" && calculationInk(strokes).complete) {
    return 0;
  }
  const settings = currentSettings();
  if (
    ((mode === "function" || mode === "calculation") &&
      settings.mathTranscription === "cloud") ||
    (mode === "language" && settings.translationProvider === "cloud")
  ) {
    // Briefly coalesce the last character's strokes, then send one request.
    return 250;
  }
  return mode === "function" || mode === "calculation"
    ? 350
    : mode === "magic"
    ? 1600
    : mode === "shape"
    ? 450
    : mode === "language"
    ? 350
    : 700;
};

/** Let local inference use the first half of the whole-expression pause. */
export const settleInkRecognition = async (
  mode: InkAssistMode,
  since: number,
  signal: AbortSignal,
  strokes: InkInput = [],
) => {
  signal.throwIfAborted();
  const remaining =
    (mode === "function" || mode === "calculation") &&
    currentSettings().mathTranscription === "local" &&
    !(mode === "calculation" && calculationInk(strokes).complete)
      ? 700 - (Date.now() - since)
      : 0;
  if (remaining <= 0) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Handwriting changed", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, remaining);
    signal.addEventListener("abort", abort, { once: true });
  });
};

type InkRecognitionOptions = [
  capture: () => Promise<string>,
  strokes: InkInput,
  signal: AbortSignal,
  languageHint?: string,
  chooseCandidate?: (candidates: readonly string[]) => Promise<string>,
];

export function recognizeInkContent(
  mode: "magic",
  ...options: InkRecognitionOptions
): Promise<Extract<InkRecognitionResult, { kind: "magic" }>>;
export function recognizeInkContent(
  mode: Exclude<InkAssistMode, "magic">,
  ...options: InkRecognitionOptions
): Promise<Exclude<InkRecognitionResult, { kind: "magic" }>>;
export function recognizeInkContent(
  mode: InkAssistMode,
  ...options: InkRecognitionOptions
): Promise<InkRecognitionResult>;
/** Both visible surfaces share the selected recognition provider and placement rules. */
export async function recognizeInkContent(
  mode: InkAssistMode,
  capture: () => Promise<string>,
  strokes: InkInput,
  signal: AbortSignal,
  languageHint?: string,
  chooseCandidate?: (candidates: readonly string[]) => Promise<string>,
): Promise<InkRecognitionResult> {
  const settings = currentSettings();
  if (
    (mode === "function" || mode === "calculation") &&
    settings.mathTranscription === "cloud"
  ) {
    if (!settings.apiKey.trim()) {
      throw new Error(
        t(
          "fcboard.set_an_api_key_and_a_vision_model_or_endpoint_id_in_ai_settings",
        ),
      );
    }
    const image = await capture();
    signal.throwIfAborted();
    if (!image.startsWith("data:image/")) {
      throw new Error(t("fcboard.no_content_recognized_select_the_area_again"));
    }
    const rows = mode === "calculation" ? columnInkRows(strokes) : undefined;
    const output = (
      await chat(
        [
          {
            role: "system",
            content:
              mode === "function"
                ? "Read every handwritten function from the image. Return only its complete LaTeX equation or inequality, one per line. Preserve the left side, relation, variables, signs, numbers, exponents, numerator, denominator, and grouping exactly as written. If any symbol is unreadable or incomplete, return only ∅. Never return a guessed character or a question-mark placeholder. Do not solve, simplify, plot, explain, or use Markdown."
                : "Read the actual handwritten calculation, including the two-dimensional layout, digit positions, operators, and grouping, and compute it. A trailing equal sign or a bar underneath a column calculation marks the answer position. A fraction bar between operands is division. Return only the final mathematical result in plain Unicode notation, with no prefix, trailing punctuation, code fences, units, or explanation. Use digits, signed fractions or decimals, √, π, and mathematical operators as needed. For an equation return the solved variable assignments. Return ∅ if a complete problem cannot be read confidently or already has an answer.",
          },
          visualMessage(
            mode === "function"
              ? "Transcribe the handwritten graph expression."
              : rows
              ? "The ink has a bottom answer bar. Read the operand rows above it and their written operators."
              : "Read the written expression and return its result.",
            image,
          ),
        ],
        signal,
        settings,
        {
          maxTokens: mode === "calculation" ? 512 : 2048,
          timeoutMs: 20000,
          useVisionModel: true,
          quickVision: true,
        },
      )
    ).trim();
    signal.throwIfAborted();
    const active = currentSettings();
    if (
      active.mathTranscription !== settings.mathTranscription ||
      active.apiKey !== settings.apiKey ||
      active.endpoint !== settings.endpoint ||
      active.ocrModel !== settings.ocrModel ||
      active.model !== settings.model
    ) {
      throw new DOMException("Math provider changed", "AbortError");
    }
    if (mode === "function") {
      return { ...localFunctionResult(output), text: output, cloud: true };
    }
    if (
      output.length > 500 ||
      !/[\dπ∞]/.test(output) ||
      !/^(?:\d|[xyzabeiπ∞√∛²³₀-₉⁰-⁹()+\-−×÷*/^=.,;:{}[\]|±∓≤≥<>% \n])*$/u.test(
        output,
      ) ||
      /[A-Za-z]{2}|[=.,;:]$/u.test(output) ||
      (output.includes("=") &&
        !output
          .split(/[,;\n]+/)
          .every((part) => /^\s*[a-z]\s*=[^=]+$/u.test(part)))
    ) {
      throw new Error(t("fcboard.no_content_recognized_select_the_area_again"));
    }
    return {
      kind: "calculation",
      answer: output,
      hasEquals: !rows && calculationInk(strokes).complete,
      ...(rows ? { layout: { mode: "column", lines: rows.length } } : {}),
    };
  }
  if (
    mode === "text" ||
    mode === "language" ||
    mode === "function" ||
    mode === "calculation"
  ) {
    const targetLanguage = getLanguage().code;
    const languageConfiguration = () => {
      const settings = currentSettings();
      return JSON.stringify([
        getLanguage().code,
        settings.inkLanguage,
        settings.translationProvider,
        ...(settings.translationProvider === "cloud"
          ? [
              settings.endpoint,
              settings.apiKey,
              settings.ocrModel,
              settings.model,
            ]
          : []),
      ]);
    };
    const languageStamp = languageConfiguration();
    const assertLanguageCurrent = () => {
      signal.throwIfAborted();
      if (languageStamp !== languageConfiguration()) {
        throw new DOMException("Language changed", "AbortError");
      }
    };
    if (
      mode === "language" &&
      currentSettings().translationProvider === "cloud"
    ) {
      if (!currentSettings().apiKey.trim()) {
        throw new Error(
          t(
            "fcboard.set_an_api_key_and_a_vision_model_or_endpoint_id_in_ai_settings",
          ),
        );
      }
      const image = await capture();
      assertLanguageCurrent();
      const translation = await translateLanguageImage(
        image,
        signal,
        targetLanguage,
      );
      assertLanguageCurrent();
      return {
        kind: "language",
        translation,
        targetLanguage,
      };
    }
    const results = new Map<string, MathResult>();
    const recognitionOptions: [
      language?: string,
      choose?: (candidates: readonly string[]) => Promise<string>,
      localOnly?: boolean,
    ] =
      mode === "language" || mode === "function" || mode === "calculation"
        ? [languageHint, chooseCandidate, true]
        : chooseCandidate
        ? [languageHint, chooseCandidate]
        : languageHint
        ? [languageHint]
        : [];
    const transcription = await recognizeHandwriting(
      capture,
      signal,
      () => {},
      mode === "text" || mode === "language" ? "text" : "math",
      mode === "text" || mode === "language"
        ? undefined
        : async (candidate) => {
            try {
              if (mode === "calculation") {
                candidate = numericSumCandidate(strokes, candidate);
                const latex = /\\[A-Za-z]+/.test(candidate);
                const parsed = latex
                  ? undefined
                  : prepareCalculation(candidate);
                // A partial or truncated numeral is not a complete automatic
                // calculation. Let OCR try its configured fallback instead of
                // confidently writing that same numeral as the answer.
                if (
                  parsed?.node?.type === "ConstantNode" &&
                  !/[=＝]/.test(candidate)
                ) {
                  return false;
                }
                results.set(candidate, {
                  kind: "calculation",
                  expression: latex ? candidate : mathNotation(candidate),
                  answer: await calculateAsync(candidate, signal),
                });
              } else {
                results.set(candidate, localFunctionResult(candidate));
              }
              return true;
            } catch {
              return false;
            }
          },
      strokes,
      ...recognitionOptions,
    );
    signal.throwIfAborted();
    const text =
      mode === "calculation"
        ? numericSumCandidate(strokes, transcription)
        : transcription;
    if (!text.trim() || text.length > 4000) {
      throw new Error("Invalid handwriting result");
    }
    if (mode === "text") {
      return { kind: "text", text };
    }
    if (mode === "language") {
      assertLanguageCurrent();
      const source = /[\u3400-\u9fff]/.test(text)
        ? "zh"
        : /^\p{ASCII}+$/u.test(text)
        ? "en"
        : undefined;
      const translationTarget =
        source === "zh" ? "en" : source === "en" ? "zh" : targetLanguage;
      const study = await explainLanguage(text, signal, translationTarget);
      assertLanguageCurrent();
      return {
        kind: "language",
        text,
        study,
        translation: study.translation,
        targetLanguage: translationTarget,
      };
    }
    return {
      ...(results.get(text) || (await recognizeMath(text, mode, signal))),
      text,
      ...(mode === "calculation"
        ? { layout: columnCalculation(strokes, text) }
        : {}),
    };
  }
  if (mode === "shape") {
    const local = fitInkShape(strokes);
    if (local) {
      return local;
    }
    if (strokes.length && !isShapeClosed(strokes)) {
      throw new Error("Shape incomplete");
    }
    if (hasDigitalInk()) {
      try {
        const result = await recognizeNativeInk(
          {
            strokes,
            language: "zxx-Zsym-x-shapes",
          },
          signal,
        );
        signal.throwIfAborted();
        const shape = result.candidates[0]?.toLowerCase();
        // This branch only handles closed contours. A four-class model can
        // still label an unsupported polygon ARROW; its nearby endpoints
        // cannot define a shaft and must never collapse into a tiny arrow.
        if (["rectangle", "ellipse", "triangle"].includes(shape)) {
          return { kind: "shape", shape: shape as RecognizedShape["shape"] };
        }
      } catch {
        signal.throwIfAborted();
      }
    }
  }
  if (mode === "magic" && !currentSettings().imageModel.trim()) {
    throw new Error(
      t(
        "fcboard.functions_can_be_plotted_directly_set_an_image_model_id_in_settings_to_generate_illustrations",
      ),
    );
  }
  if (
    mode === "shape" &&
    (currentSettings().ocr === "local" || !currentSettings().apiKey.trim())
  ) {
    throw new Error("No local shape match; keep the original ink");
  }
  const image = await capture();
  signal.throwIfAborted();
  if (!image.startsWith("data:image/")) {
    throw new Error(t("fcboard.no_content_recognized_select_the_area_again"));
  }
  if (mode === "magic") {
    return {
      kind: "magic",
      image,
      transparent: true,
      prompt: selectionImagePrompt("magic"),
    };
  }
  const instruction =
    'Recognize the hand-drawn geometry and return only {"shape":"rectangle|ellipse|line|arrow|triangle|star|diamond|pentagon|hexagon"} for the closest match. Return {"none":true} when uncertain.';
  const result = parseJSON(
    await chat([visualMessage(instruction, image)], signal),
  ) as Record<string, unknown>;
  signal.throwIfAborted();
  if (
    mode === "shape" &&
    [
      "rectangle",
      "ellipse",
      "line",
      "arrow",
      "triangle",
      "star",
      "diamond",
      "pentagon",
      "hexagon",
    ].includes(String(result?.shape))
  ) {
    return {
      kind: "shape",
      shape: result.shape as Extract<
        InkRecognitionResult,
        { kind: "shape" }
      >["shape"],
    };
  }
  throw new Error("No recognized ink object");
}
