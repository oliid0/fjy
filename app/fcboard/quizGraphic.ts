import { resourceHtml } from "@fcboard/fcboard/resourceHtml";
import { t } from "@fcboard/fcboard/i18n";

import type { InteractiveResource } from "@fcboard/fcboard/interactiveHtml";

import runtime from "./quizGraphicRuntime.js?raw";

/** A transient figure uses the existing no-network/no-eval sandbox. It exports
 * actual drawn pixels, then releases its frame, engines and backing canvases. */
export const renderQuizGraphic = (
  resource: InteractiveResource,
  signal: AbortSignal,
): Promise<string> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const channel = crypto.randomUUID();
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.title = resource.title;
    frame.style.cssText =
      "position:fixed;left:-100000px;top:0;width:720px;height:460px;border:0;pointer-events:none";
    let settled = false;
    const finish = (error?: unknown, dataURL?: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      window.removeEventListener("message", receive);
      frame.remove();
      frame.srcdoc = "";
      if (dataURL) {
        resolve(dataURL);
      } else {
        reject(error);
      }
    };
    const abort = () => finish(signal.reason);
    const timer = setTimeout(
      () => finish(new Error(t("fcboard.quizForm.imageInvalid"))),
      12000,
    );
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.contentWindow ||
        event.data?.channel !== channel ||
        event.data.type !== "quiz-graphic"
      ) {
        return;
      }
      const { error, dataURL } = event.data;
      if (typeof error === "string" && error.trim()) {
        finish(new Error(error.slice(0, 2000)));
      } else if (
        typeof dataURL === "string" &&
        dataURL.length <= 8 * 1024 * 1024 &&
        /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataURL)
      ) {
        finish(undefined, dataURL);
      } else {
        finish(new Error(t("fcboard.quizForm.imageInvalid")));
      }
    };
    window.addEventListener("message", receive);
    signal.addEventListener("abort", abort, { once: true });
    void resourceHtml(resource, [
      { name: `quiz-snapshot:${channel}`, code: runtime },
    ]).then(
      (html) => {
        if (!settled) {
          frame.srcdoc = html;
          document.body.append(frame);
        }
      },
      (error) => finish(error),
    );
  });
