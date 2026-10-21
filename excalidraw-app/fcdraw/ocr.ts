import { t } from "@excalidraw/excalidraw/i18n";

import { chat, visualMessage } from "./ai";
import { recognizeLocalHandwriting } from "./localOcr";
import { preferredRace } from "./preferredRace";
import { currentSettings } from "./settings";

export { warmHandwriting } from "./localOcr";

/** A caller action owns recognition; the two backends never read or mutate the board. */
export const recognizeHandwriting = async (
  image: string,
  signal: AbortSignal,
  progress: (message: string) => void,
  kind: "math" | "text" = "text",
  accept: (text: string) => boolean = (text) => !!text.trim(),
) => {
  signal.throwIfAborted();
  const settings = currentSettings();
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
          visualMessage("Transcribe this selection.", image),
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
    const text = await recognizeLocalHandwriting(image, request, progress);
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
