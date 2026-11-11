import { getLanguage, t } from "@fcboard/fcboard/i18n";

import { chat, parseJSON, visualMessage } from "./ai";
import { recognizeHandwriting } from "./ocr";
import { localMathResult, recognizeMath } from "./mathRecognition";
import { prepareCalculation } from "./math";
import { currentSettings } from "./settings";
import { mathNotation } from "./mathNotation";
import { explainLanguage, translateLanguageImage } from "./languageStudy";
import { columnCalculation } from "./columnCalculation";
import { calculationInk } from "./calculationInk";
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
      text: string;
      study: LanguageStudy;
      targetLanguage: string;
    }
  | RecognizedShape
  | { kind: "magic"; prompt: string; image?: string; transparent?: boolean }
  | (MathResult & { text: string });

export const inkRecognitionDelay = (mode: InkAssistMode, strokes: InkInput) =>
  mode === "calculation" && calculationInk(strokes).complete
    ? 0
    : mode === "function" || mode === "calculation"
    ? 1200
    : mode === "magic"
    ? 1600
    : mode === "shape"
    ? 450
    : 700;

/** An explicit completion mark needs no additional whole-expression pause. */
export const settleInkRecognition = async (
  mode: InkAssistMode,
  since: number,
  signal: AbortSignal,
  strokes: InkInput = [],
) => {
  signal.throwIfAborted();
  const remaining =
    (mode === "function" || mode === "calculation") &&
    !(mode === "calculation" && calculationInk(strokes).complete)
      ? inkRecognitionDelay(mode, strokes) - (Date.now() - since)
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
/** Both visible surfaces submit raw ink first and receive validated objects, never a rendered math image. */
export async function recognizeInkContent(
  mode: InkAssistMode,
  capture: () => Promise<string>,
  strokes: InkInput,
  signal: AbortSignal,
  languageHint?: string,
  chooseCandidate?: (candidates: readonly string[]) => Promise<string>,
): Promise<InkRecognitionResult> {
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
      const study = await translateLanguageImage(image, signal, targetLanguage);
      assertLanguageCurrent();
      return { kind: "language", text: study.term, study, targetLanguage };
    }
    const calculations = new Map<
      string,
      Extract<MathResult, { kind: "calculation" }>
    >();
    const recognitionOptions: [
      language?: string,
      choose?: (candidates: readonly string[]) => Promise<string>,
      localOnly?: boolean,
    ] =
      mode === "language"
        ? [languageHint, chooseCandidate, true]
        : chooseCandidate
        ? [languageHint, chooseCandidate]
        : languageHint
        ? [languageHint]
        : [];
    const text = await recognizeHandwriting(
      capture,
      signal,
      () => {},
      mode === "text" || mode === "language" ? "text" : "math",
      mode === "text" || mode === "language"
        ? undefined
        : async (candidate) => {
            try {
              if (mode === "calculation") {
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
                calculations.set(candidate, {
                  kind: "calculation",
                  expression: latex ? candidate : mathNotation(candidate),
                  answer: await calculateAsync(candidate, signal),
                });
              } else {
                localMathResult(candidate, "function");
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
    if (!text.trim() || text.length > 4000) {
      throw new Error("Invalid handwriting result");
    }
    if (mode === "text") {
      return { kind: "text", text };
    }
    if (mode === "language") {
      assertLanguageCurrent();
      const target = targetLanguage.toLowerCase().split("-")[0];
      const source = /[\u3400-\u9fff]/.test(text)
        ? "zh"
        : /^\p{ASCII}+$/u.test(text)
        ? "en"
        : undefined;
      const translationTarget =
        source && source === target
          ? source === "zh"
            ? "en"
            : "zh"
          : targetLanguage;
      const study = await explainLanguage(text, signal, translationTarget);
      assertLanguageCurrent();
      return {
        kind: "language",
        text,
        study,
        targetLanguage: translationTarget,
      };
    }
    return {
      ...(calculations.get(text) || (await recognizeMath(text, mode, signal))),
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
    '识别手绘几何，只返回 {"shape":"rectangle|ellipse|line|arrow|triangle|star|diamond|pentagon|hexagon"} 中最接近的一种。不确定返回 {"none":true}。';
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
