import { t } from "@fcboard/fcboard/i18n";

import { validateLesson } from "./lesson";

import type { Lesson } from "./lesson";
import type { LessonToolResult } from "./lessonTools";

export type LessonObservation = {
  lesson: Lesson;
  step: number;
  toolIndex: number;
  results: LessonToolResult[];
  correct: number;
  attempts: number;
  error?: string;
};
export type LessonObserver = (
  input: LessonObservation,
  signal: AbortSignal,
) => Promise<Lesson | undefined>;

/** Only the unfinished suffix may change. Successful tools retain their durable cursor. */
export const mergeLessonContinuation = (
  input: LessonObservation,
  tail: Lesson,
): Lesson => {
  const active = input.lesson.steps[input.step];
  if (
    !active ||
    !Number.isInteger(input.toolIndex) ||
    input.toolIndex < 0 ||
    input.toolIndex > (active.tools?.length || 0)
  ) {
    throw new Error(t("fcboard.invalid_lesson_content"));
  }
  const remaining = validateLesson(tail);
  return validateLesson({
    ...input.lesson,
    steps: [
      ...input.lesson.steps.slice(0, input.step),
      {
        ...remaining.steps[0],
        tools: [
          ...(active.tools || []).slice(0, input.toolIndex),
          ...(remaining.steps[0].tools || []),
        ],
      },
      ...remaining.steps.slice(1),
    ],
    quiz: remaining.quiz,
  });
};
