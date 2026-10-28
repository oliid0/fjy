import { getLanguage, t } from "@excalidraw/excalidraw/i18n";

import { chat, parseJSON, visualMessage } from "./ai";
import { recognizeHandwriting } from "./ocr";
import { localMathResult, recognizeMath } from "./mathRecognition";
import { prepareCalculation } from "./math";
import { currentSettings } from "./settings";
import { mathNotation } from "./mathNotation";
import { explainLanguage } from "./languageStudy";
import { columnCalculation } from "./columnCalculation";

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
  | {
      kind: "shape";
      shape: "rectangle" | "ellipse" | "line" | "arrow" | "triangle";
    }
  | { kind: "magic"; prompt: string; image?: string }
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
              '辨别魔法笔墨迹是文字要求还是绘画。只返回 {"version":1,"kind":"text","text":"逐字转录的完整要求"} 或 {"version":1,"kind":"drawing"}。完整可读的词句是 text；人物、动物、物体草图是 drawing。不能把绘画猜成文字，不能补写未写完的句子。混合且无法确定返回 {"none":true}。',
          },
          visualMessage(
            "辨别已经停笔的墨迹，不生成图片、不回答文字内容。",
            image,
          ),
        ],
        signal,
        currentSettings(),
        { maxTokens: 500, timeoutMs: 6000 },
      ),
    ) as Record<string, unknown>;
    signal.throwIfAborted();
    if (
      intent?.version !== 1 ||
      !["text", "drawing"].includes(String(intent.kind)) ||
      (intent.kind === "text" &&
        (typeof intent.text !== "string" ||
          !intent.text.trim() ||
          intent.text.length > 2000))
    ) {
      throw new Error(t("fcboard.no_content_recognized_select_the_area_again"));
    }
    const isolation =
      "仅绘制主体，透明背景，无文字、水印、画框、地面、场景、投影或纸张纹理。若格式无法输出透明通道，使用完全纯白 #FFFFFF 背景以便去除，主体不接触图像边缘。画面应像直接绘制在白板上。";
    return {
      kind: "magic",
      ...(intent.kind === "drawing" ? { image } : {}),
      prompt:
        intent.kind === "text"
          ? `根据以下文字绘制精细的铅笔素描 / 手绘图标：${intent.text}。${isolation}`
          : `将参考手绘可辨认的主体制作成精致有色彩的 3D 风格手绘图。保留主体数量、姿态、比例和构图。${isolation}`,
    };
  }
  const instruction =
    '识别手绘几何，只返回 {"shape":"rectangle|ellipse|line|arrow|triangle"} 中最接近的一种。不确定返回 {"none":true}。';
  const result = parseJSON(
    await chat([visualMessage(instruction, image)], signal),
  ) as Record<string, unknown>;
  signal.throwIfAborted();
  if (
    mode === "shape" &&
    ["rectangle", "ellipse", "line", "arrow", "triangle"].includes(
      String(result?.shape),
    )
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
