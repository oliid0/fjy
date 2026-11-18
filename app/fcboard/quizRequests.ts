import { getLanguage, t } from "@fcboard/fcboard/i18n";

import { chat, parseJSON, visualMessage } from "./ai";
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

/** The generated picture is checked against this question's actual data before
 * it becomes visible. A failed check is explicit, never a missing figure. */
export const generateQuizImage = (
  question: QuizQuestion,
  signal: AbortSignal,
) =>
  quizRequest(
    signal,
    async () => {
      const settings = currentSettings();
      let feedback = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        signal.throwIfAborted();
        let dataURL: string;
        try {
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
                    previousFailure: feedback,
                  }),
                },
              ],
              signal,
              { ...settings, model: settings.textModel || settings.model },
              { maxTokens: 12000 },
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
              }\n${feedback}`,
              signal,
            );
            dataURL = image.dataURL;
          } else {
            throw new Error(t("fcboard.quizForm.imageSpecification"));
          }
          signal.throwIfAborted();
          const check = parseJSON(
            await chat(
              [
                {
                  role: "system",
                  content:
                    'Check an actual generated educational illustration against the supplied question and answer. Check object counts, topology, labels, values, directions, units, ambiguity and accidental answer disclosure. Return only JSON {"valid":true|false,"issues":"specific mismatches, or empty"}. Accept only when the question can be answered consistently from this picture.',
                },
                visualMessage(
                  JSON.stringify({
                    question: question.question,
                    options: question.options,
                    answer: question.answer,
                    explanation: question.explanation,
                    specification: question.image!.prompt,
                    caption: question.image!.caption,
                  }),
                  dataURL,
                ),
              ],
              signal,
              settings,
              { maxTokens: 1500 },
            ),
          ) as { valid?: unknown; issues?: unknown };
          signal.throwIfAborted();
          if (
            check?.valid === true &&
            typeof check.issues === "string" &&
            !check.issues.trim()
          ) {
            return dataURL;
          }
          feedback =
            typeof check?.issues === "string" && check.issues.trim()
              ? check.issues.slice(0, 3000)
              : t("fcboard.quizForm.imageInvalid");
        } catch (failure) {
          signal.throwIfAborted();
          feedback =
            failure instanceof Error ? failure.message : String(failure);
        }
      }
      throw new Error(feedback);
    },
    1,
  );
