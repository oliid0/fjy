import { getLanguage, t } from "@fcboard/fcboard/i18n";

import { chat, parseJSON, visualMessage } from "./ai";
import { recognizeHandwriting } from "./ocr";
import { localMathResult, recognizeMath } from "./mathRecognition";
import { prepareCalculation } from "./math";
import { currentSettings } from "./settings";
import { mathNotation } from "./mathNotation";
import { explainLanguage } from "./languageStudy";
import { columnCalculation } from "./columnCalculation";
import { fitInkShape, isShapeClosed } from "./shapeRecognition";
import {
  hasDigitalInk,
  digitalInkEngine,
  currentTextInkLanguage,
} from "./digitalInk";
import { recognizeLocalHandwriting } from "./localOcr";
import { preferredRace } from "./preferredRace";
import { requireImageLayers, supportsImageLayers } from "./imageGeneration";

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

/** Start math recognition early, but preserve the existing whole-expression pause. */
export const settleInkRecognition = async (
  mode: InkAssistMode,
  since: number,
  signal: AbortSignal,
) => {
  signal.throwIfAborted();
  const remaining =
    mode === "function" || mode === "calculation"
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

/** Both visible surfaces submit raw ink first and receive validated objects, never a rendered math image. */
export const recognizeInkContent = async (
  mode: InkAssistMode,
  capture: () => Promise<string>,
  strokes: InkInput,
  signal: AbortSignal,
  languageHint?: "en-US",
  chooseCandidate?: (candidates: readonly string[]) => Promise<string>,
): Promise<InkRecognitionResult> => {
  if (
    mode === "language" &&
    currentSettings().ocr !== "local" &&
    currentSettings().apiKey.trim()
  ) {
    const targetLanguage = getLanguage().code;
    let raster: Promise<string> | undefined;
    const image = () =>
      (raster ||= capture().then((value) => {
        if (!value.startsWith("data:image/")) {
          throw new Error(
            t("fcboard.no_content_recognized_select_the_area_again"),
          );
        }
        return value;
      }));
    const study = await preferredRace(
      async (request) =>
        explainLanguage("", request, targetLanguage, await image()),
      async (request) => {
        const text =
          hasDigitalInk() && strokes.length
            ? (
                await digitalInkEngine.recognize({
                  strokes,
                  language: languageHint || currentTextInkLanguage(),
                })
              ).candidates.find(
                (candidate) =>
                  typeof candidate === "string" && candidate.trim(),
              )
            : await recognizeLocalHandwriting(await image(), request, () => {});
        request.throwIfAborted();
        if (!text?.trim() || text.length > 4000) {
          throw new Error(
            t("fcboard.no_content_recognized_select_the_area_again"),
          );
        }
        // The source image lets vision correct a local recognizer's language/script guess.
        return explainLanguage(text, request, targetLanguage, await image());
      },
      signal,
    );
    signal.throwIfAborted();
    if (targetLanguage !== getLanguage().code) {
      throw new DOMException("Language changed", "AbortError");
    }
    return { kind: "language", text: study.term, study, targetLanguage };
  }
  if (
    mode === "text" ||
    mode === "language" ||
    mode === "function" ||
    mode === "calculation"
  ) {
    const targetLanguage = getLanguage().code;
    const recognitionOptions: [
      language?: "en-US",
      choose?: (candidates: readonly string[]) => Promise<string>,
    ] = chooseCandidate
      ? [languageHint, chooseCandidate]
      : languageHint ||
        (mode === "language" && currentSettings().inkLanguage === "auto")
      ? [languageHint || "en-US"]
      : [];
    const text = await recognizeHandwriting(
      capture,
      signal,
      () => {},
      mode === "text" || mode === "language" ? "text" : "math",
      mode === "text" || mode === "language"
        ? undefined
        : (candidate) => {
            try {
              if (mode === "calculation") {
                const parsed = prepareCalculation(mathNotation(candidate));
                // A partial or truncated numeral is not a complete automatic
                // calculation. Let OCR try its configured fallback instead of
                // confidently writing that same numeral as the answer.
                if (
                  parsed.node?.type === "ConstantNode" &&
                  !/[=＝]/.test(candidate)
                ) {
                  return false;
                }
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
      const study = await explainLanguage(text, signal, targetLanguage);
      signal.throwIfAborted();
      if (targetLanguage !== getLanguage().code) {
        throw new DOMException("Language changed", "AbortError");
      }
      return { kind: "language", text, study, targetLanguage };
    }
    return {
      ...(await recognizeMath(text, mode, signal)),
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
        const result = await digitalInkEngine.recognize({
          strokes,
          language: "zxx-Zsym-x-shapes",
        });
        signal.throwIfAborted();
        const shape = result.candidates[0]?.toLowerCase();
        if (["rectangle", "ellipse", "triangle", "arrow"].includes(shape)) {
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
  const image = await capture();
  signal.throwIfAborted();
  if (!image.startsWith("data:image/")) {
    throw new Error(t("fcboard.no_content_recognized_select_the_area_again"));
  }
  if (mode === "magic") {
    const intent = parseJSON(
      await chat(
        [
          {
            role: "system",
            content:
              '辨别魔法笔墨迹是文字要求还是绘画。只返回 {"version":1,"kind":"text","text":"逐字转录的完整要求","transparent":false} 或 {"version":1,"kind":"drawing","transparent":false}。完整可读的词句是 text，逐字保留原语种的主体、风格和背景要求，例如“一个二次元女孩”；用户明确要求透明、去背景或同义要求时 transparent=true，未要求则false。人物、动物、物体草图是 drawing，例如手绘小狗。不能把绘画猜成文字，不能补写未写完的句子；“一个二次”等未完成描述返回 {"none":true}。混合且无法确定也返回 {"none":true}。',
          },
          visualMessage(
            "辨别已经停笔的墨迹，不生成图片、不回答文字内容。",
            image,
          ),
        ],
        signal,
        currentSettings(),
        { maxTokens: 500, timeoutMs: 15000 },
      ),
    ) as Record<string, unknown>;
    signal.throwIfAborted();
    if (
      intent?.version !== 1 ||
      !["text", "drawing"].includes(String(intent.kind)) ||
      (intent.transparent !== undefined &&
        typeof intent.transparent !== "boolean") ||
      (intent.kind === "text" &&
        (typeof intent.text !== "string" ||
          !intent.text.trim() ||
          intent.text.length > 2000))
    ) {
      throw new Error(t("fcboard.no_content_recognized_select_the_area_again"));
    }
    const transparent = supportsImageLayers(currentSettings().imageModel);
    if (
      intent.transparent === true ||
      (intent.kind === "text" &&
        /透明|无背景|不要背景|去(?:掉|除)?背景|transparent|backgroundless|(?:without|no)\s+(?:a\s+)?background|remove\s+(?:the\s+)?background/i.test(
          String(intent.text),
        ))
    ) {
      requireImageLayers(currentSettings().imageModel);
    }
    const background = transparent
      ? "主体完整、轮廓清晰，保留主体自身的颜色与白色细节。后续会拆出主体透明图层放到白板上，背景保持简洁，不要纸张、边框、投影或额外装饰。"
      : "主体完整、轮廓清晰，保留主体自身的颜色与白色细节，背景简洁，不要纸张、边框或额外装饰。";
    return {
      kind: "magic",
      ...(intent.kind === "drawing" ? { image } : {}),
      transparent,
      prompt:
        intent.kind === "text"
          ? `严格按手写描述中的主体、画风、颜色、动作与背景要求生成图片。用户原文：${intent.text}。${background}不要把描述文字本身画成图片中的文字。`
          : `根据参考草图生成完整、精致的图片。草图只用于识别主体和构图，保留主体、数量、姿态与主要比例，按合理结构补全断开的轮廓，使头部、身体与四肢自然连接；清除草稿辅助线，不生成悬浮碎片，不逐线复制未完成笔画。${background}`,
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
};
