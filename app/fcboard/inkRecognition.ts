import { chat, parseJSON, visualMessage } from "./ai";
import { recognizeHandwriting } from "./ocr";
import { recognizeMath } from "./mathRecognition";
import { teachingResources } from "./TeachingResources";

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
  | { kind: "magic"; resourceId: string }
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
      undefined,
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
  const instruction =
    mode === "shape"
      ? '识别手绘几何，只返回 {"shape":"rectangle|ellipse|line|arrow|triangle"} 中最接近的一种。不确定返回 {"none":true}。'
      : `识别手绘图示，从以下本地教学图示选择最接近的一项，仅返回 {"resourceId":"清单中的id"}；不匹配返回 {"none":true}。清单：${JSON.stringify(
          teachingResources
            .filter((item) => item.asset)
            .map(({ id, title }) => ({ id, title })),
        )}`;
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
    typeof result?.resourceId === "string" &&
    teachingResources.some(
      (item) => item.asset && item.id === result.resourceId,
    )
  ) {
    return { kind: "magic", resourceId: result.resourceId };
  }
  throw new Error("No recognized ink object");
};
