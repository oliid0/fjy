import { chat, parseJSON, visualMessage } from "./ai";
import { recognizeHandwriting } from "./ocr";
import { localMathResult, recognizeMath } from "./mathRecognition";
import { prepareCalculation } from "./math";
import { currentSettings } from "./settings";
import { mathNotation } from "./mathNotation";

import type { InkInput } from "./digitalInk";
import type { MathResult } from "./mathRecognition";

export type InkAssistMode =
  | "text"
  | "shape"
  | "magic"
  | "function"
  | "calculation";
export const inkAssistMode = (value: unknown): InkAssistMode | undefined =>
  ["text", "shape", "magic", "function", "calculation"].includes(String(value))
    ? (value as InkAssistMode)
    : undefined;
export type InkRecognitionResult =
  | { kind: "text"; text: string }
  | {
      kind: "shape";
      shape: "rectangle" | "ellipse" | "line" | "arrow" | "triangle";
    }
  | { kind: "magic"; prompt: string }
  | (MathResult & { text: string });

/** Both visible surfaces submit raw ink first and receive validated objects, never a rendered math image. */
export const recognizeInkContent = async (
  mode: InkAssistMode,
  capture: () => Promise<string>,
  strokes: InkInput,
  signal: AbortSignal,
): Promise<InkRecognitionResult> => {
  if (mode === "text" || mode === "function" || mode === "calculation") {
    const text = await recognizeHandwriting(
      capture,
      signal,
      () => {},
      mode === "text" ? "text" : "math",
      mode === "text"
        ? undefined
        : (candidate) => {
            try {
              if (mode === "calculation") {
                prepareCalculation(mathNotation(candidate));
              } else {
                localMathResult(candidate, "function");
              }
              return true;
            } catch {
              return false;
            }
          },
      strokes,
    );
    signal.throwIfAborted();
    if (!text.trim() || text.length > 4000) {
      throw new Error("Invalid handwriting result");
    }
    if (mode === "text") {
      return { kind: "text", text };
    }
    return { ...(await recognizeMath(text, mode, signal)), text };
  }
  if (mode === "magic" && !currentSettings().imageModel.trim()) {
    throw new Error("No image generation model configured");
  }
  const instruction =
    mode === "shape"
      ? '识别手绘几何，只返回 {"shape":"rectangle|ellipse|line|arrow|triangle"} 中最接近的一种。不确定返回 {"none":true}。'
      : '描述这幅手绘中可辨认的主体、数量、姿态和构图，仅返回 {"description":"简短准确的中文描述"}。例如手画一只狗应描述为狗及其姿态，不局限于教学素材。不能辨认时返回 {"none":true}，不要猜测。';
  const result = parseJSON(
    await chat([visualMessage(instruction, await capture())], signal),
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
  if (
    mode === "magic" &&
    typeof result?.description === "string" &&
    result.description.trim().length > 0 &&
    result.description.length <= 800
  ) {
    return {
      kind: "magic",
      prompt: `将以下手绘主体绘制成精美、清晰的手绘插画，保留主体数量、姿态和构图，白色背景，无文字、无边框、无水印：${result.description.trim()}`,
    };
  }
  throw new Error("No recognized ink object");
};
