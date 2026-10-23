import { t } from "@excalidraw/excalidraw/i18n";

import { chat, visualMessage } from "./ai";
import { recognizeLocalHandwriting } from "./localOcr";
import { preferredRace } from "./preferredRace";
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
) => {
  signal.throwIfAborted();
  const settings = currentSettings();
  let raster: Promise<string> | undefined;
  const capture = () =>
    (raster ||= Promise.resolve(typeof image === "string" ? image : image()));
  if (settings.ocr !== "cloud" && hasDigitalInk() && strokes?.length) {
    progress(t("fcboard.正在本地识别手写…"));
    try {
      const candidates = await recognizeDigitalInk(strokes, signal, kind);
      const text = candidates[0];
      if (text && accept(text)) {
        return text;
      }
      throw new Error(t("fcboard.未识别到内容，请重新圈选"));
    } catch (error) {
      signal.throwIfAborted();
      // Explicit local mode reports the real native failure. Auto can use the
      // separately configured raster/cloud fallback; never call it Digital Ink.
      if (settings.ocr === "local") {
        throw error;
      }
    }
  }
  const cloud = async (request: AbortSignal) => {
    const text = (
      await chat(
        [
          {
            role: "system",
            content: `Transcribe only the selected handwriting, without solving, adding or guessing. Preserve line breaks, equals signs and variables. Return an empty string when unreadable.${
              kind === "math"
                ? " Use calculable math syntax: ^ for powers, * for multiplication, integrate(expr,x), defint(expr,a,b,x), diff(expr,x), limit(expr,x,a), solve(expr,x). Preserve values and structure; do not calculate the answer."
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
      throw new Error(t("fcboard.未识别到内容，请重新圈选"));
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
      throw new Error(t("fcboard.未识别到内容，请重新圈选"));
    }
    return text;
  };
  if (settings.ocr === "local" || !settings.apiKey) {
    return local(signal);
  }
  progress(t("fcboard.正在识别手写…"));
  if (settings.ocr === "cloud") {
    return cloud(signal);
  }
  return preferredRace(cloud, local, signal);
};
