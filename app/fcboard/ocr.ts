import { t } from "@fcboard/fcboard/i18n";

import { chat, visualMessage } from "./ai";
import { recognizeLocalHandwriting } from "./localOcr";
import { recognizeLocalMath } from "./localMathOcr";
import { currentSettings } from "./settings";
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
  if (hasDigitalInk()) {
    return prepareDigitalInk();
  }
  const { warmHandwriting } = await import("./localOcr");
  return warmHandwriting();
};

/** A caller action owns recognition; the two backends never read or mutate the board. */
export const recognizeHandwriting = async (
  image: string | (() => Promise<string>),
  signal: AbortSignal,
  progress: (message: string) => void,
  kind: "math" | "text" = "text",
  accept: (text: string) => boolean = (text) => !!text.trim(),
  strokes?: InkInput,
  languageHint?: "en-US",
  chooseCandidate?: (candidates: readonly string[]) => Promise<string>,
) => {
  signal.throwIfAborted();
  const settings = currentSettings();
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
                ? " Use calculable math syntax: ^ for powers, * for multiplication, integrate(expr,x), defint(expr,a,b,x), diff(expr,x), limit(expr,x,a), solve(expr,x). Preserve complete function definitions such as fx=1/x^2+x, denominators, superscripts, and distinguish variable x from multiplication. Preserve operand rows and horizontal bars in vertical arithmetic; long division is divisor)dividend. Preserve values and structure; do not calculate the answer."
                : ""
            }`,
          },
          visualMessage("Transcribe this selection.", await capture()),
        ],
        request,
        { ...settings, model: settings.ocrModel || settings.model },
        { maxTokens: kind === "math" ? 256 : 1024, timeoutMs: 6000 },
      )
    ).trim();
    if (!accept(text)) {
      throw new Error(t("fcboard.no_content_recognized_select_the_area_again"));
    }
    return text;
  };
  const local = async (request: AbortSignal) => {
    const text = await recognizeLocalHandwriting(
      await capture(),
      request,
      progress,
    );
    if (!accept(text)) {
      throw new Error(t("fcboard.no_content_recognized_select_the_area_again"));
    }
    return text;
  };
  const useCloud = settings.ocr !== "local" && !!settings.apiKey.trim();
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
  if (kind === "math" && strokes?.length) {
    progress(t("fcboard.recognizing_handwriting_locally"));
    try {
      const value = await recognizeLocalMath(strokes, signal);
      signal.throwIfAborted();
      if (accept(value)) {
        return chooseCandidate ? chooseCandidate([value]) : value;
      }
    } catch {
      signal.throwIfAborted();
    }
  }
  if (hasDigitalInk() && strokes?.length) {
    progress(t("fcboard.recognizing_handwriting_locally"));
    try {
      const candidates = await recognizeDigitalInk(
        strokes,
        signal,
        kind,
        languageHint,
      );
      const text = candidates[0];
      if (text && accept(text)) {
        const chosen = chooseCandidate
          ? await chooseCandidate(candidates.filter(accept))
          : text;
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
      // A missing explicitly selected text pack is actionable; other native
      // failures can use the separately bundled local raster model.
    }
  }
  try {
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
