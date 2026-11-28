import { getLanguage, t } from "@fcboard/fcboard/i18n";

import { chat } from "./ai";
import { currentSettings } from "./settings";
import {
  assertResourceEngines,
  quizGraphicInstructions,
} from "./teachingResourcePrompt";

import type { QuizQuestion } from "./quiz";

type Work = { priority: number; start: () => void };
const waiting: Work[] = [];
let active = 0;
const pump = () => {
  while (active < 10 && waiting.length) {
    const next = waiting.findIndex((work) => work.priority === 0);
    waiting.splice(next < 0 ? 0 : next, 1)[0].start();
  }
};

/** Text has priority over illustrations. A running native request keeps its
 * slot until it actually ends, even when its UI owner has been cancelled. */
export const quizRequest = <T>(
  signal: AbortSignal,
  run: () => Promise<T>,
  priority = 0,
): Promise<T> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const cancel = () => {
      const index = waiting.indexOf(work);
      if (index >= 0) {
        waiting.splice(index, 1);
        reject(signal.reason);
      }
    };
    const work: Work = {
      priority,
      start: () => {
        signal.removeEventListener("abort", cancel);
        active++;
        Promise.resolve()
          .then(() => {
            signal.throwIfAborted();
            return run();
          })
          .then(resolve, reject)
          .finally(() => {
            active--;
            pump();
          });
      },
    };
    waiting.push(work);
    signal.addEventListener("abort", cancel, { once: true });
    pump();
  });

/** Generate once and publish immediately; errors remain available for manual retry. */
export const generateQuizImage = (
  question: QuizQuestion,
  signal: AbortSignal,
) =>
  quizRequest(
    signal,
    async () => {
      signal.throwIfAborted();
      const settings = currentSettings();
      let dataURL: string;
      if (question.image!.method === "draw") {
        const [{ parseGeneratedResource }, { renderQuizGraphic }] =
          await Promise.all([
            import("./generatedResources"),
            import("./quizGraphic"),
          ]);
        const engines = question.image!.engines || {
          required: [],
          excluded: [],
        };
        const response = await chat(
          [
            { role: "system", content: quizGraphicInstructions() },
            {
              role: "user",
              content: JSON.stringify({
                question: question.question,
                options: question.options,
                specification: question.image!.prompt,
                caption: question.image!.caption,
                language: getLanguage().code,
                engines,
              }),
            },
          ],
          signal,
          { ...settings, model: settings.textModel || settings.model },
          { maxTokens: 12000, quickVision: true },
        );
        signal.throwIfAborted();
        const resource = await parseGeneratedResource(
          response,
          question.image!.caption,
        );
        assertResourceEngines(resource, engines);
        dataURL = await renderQuizGraphic(resource, signal);
      } else if (question.image!.method === "generate") {
        const { generateImage } = await import("./imageGeneration");
        const image = await generateImage(
          `Create ONLY the textbook illustration for this question, not a screenshot of the question or its solution. All counts, labels, quantities, units, geometry, circuit connections and directions must exactly match the supplied data. Do not invent values or reveal the answer. Plain white background, clear legible labels.\nQuestion: ${
            question.question
          }\nOptions: ${JSON.stringify(
            question.options || [],
          )}\nDrawing specification: ${question.image!.prompt}\nCaption: ${
            question.image!.caption
          }`,
          signal,
        );
        dataURL = image.dataURL;
      } else {
        throw new Error(t("fcboard.quizForm.imageSpecification"));
      }
      signal.throwIfAborted();
      return dataURL;
    },
    1,
  );
