import { quizFigureResource } from "./quizFigure";

import type { QuizQuestion } from "./quiz";

/** Diagram JSON arrives with the question; retry only renders the same data locally. */
export const generateQuizImage = async (
  question: QuizQuestion,
  signal: AbortSignal,
) => {
  signal.throwIfAborted();
  const { renderQuizGraphic } = await import("./quizGraphic");
  const resource = await quizFigureResource(
    question.image?.spec,
    question.image?.caption || question.question,
  );
  signal.throwIfAborted();
  return renderQuizGraphic(resource, signal);
};
