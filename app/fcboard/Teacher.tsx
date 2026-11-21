import { t, useI18n } from "@fcboard/fcboard/i18n";
import { useCallback, useEffect, useRef, useState } from "react";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { QuizComposer } from "./QuizComposer";
import { QuizPanel } from "./QuizPanel";
import { generateQuiz } from "./quiz";
import { generateQuizImage } from "./quizRequests";

import { boardContext } from "./ai";
import { classroomCommands } from "./commands";

import type { Quiz, QuizQuestion } from "./quiz";

export const Teacher = ({ api }: { api: FcboardImperativeAPI }) => {
  useI18n();
  const [asking, setAsking] = useState(false);
  const [questionWhole, setQuestionWhole] = useState(false);

  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const quizValue = useRef<Quiz | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [quizBusy, setQuizBusy] = useState(false);
  const [quizError, setQuizError] = useState("");
  const quizRequest = useRef<AbortController | null>(null);
  const quizRequests = useRef(new Set<AbortController>());
  const imageRequests = useRef(new Map<string, AbortController>());
  const stopVisibleQuiz = useCallback(() => {
    setQuizBusy(false);
    if (!quizValue.current) {
      return;
    }
    const stopped = {
      ...quizValue.current,
      generating: false,
      questions: quizValue.current.questions.map((question) =>
        question.image?.status === "pending"
          ? {
              ...question,
              image: {
                ...question.image,
                status: "error" as const,
                error: t("fcboard.quizForm.cancelled"),
              },
            }
          : question,
      ),
    };
    quizValue.current = stopped;
    setQuiz(stopped);
  }, []);
  useEffect(() => {
    const requests = quizRequests.current;
    return () => requests.forEach((request) => request.abort());
  }, []);
  const createQuiz = async (
    text: string,
    signal: AbortSignal,
    sourceContext?: { text: string; image?: string },
    quietFailure = false,
    questionType?: QuizQuestion["type"],
  ) => {
    const request = new AbortController();
    quizRequests.current.add(request);
    quizRequest.current = request;
    const stopped = () => {
      if (quizRequest.current === request) {
        stopVisibleQuiz();
      }
    };
    request.signal.addEventListener("abort", stopped, { once: true });
    const releaseOwner = classroomCommands.registerOwner(
      request.signal,
      signal,
    );
    const cancel = () => request.abort(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) {
      cancel();
    }
    quizValue.current = null;
    setQuiz(null);
    setQuizError("");
    setQuizBusy(true);
    setQuizOpen(true);
    try {
      const visible =
        sourceContext ||
        (classroomCommands.has("canvas.snapshot")
          ? ((await classroomCommands.execute({
              name: "canvas.snapshot",
              args: { signal: request.signal },
            })) as { text?: string; image?: string })
          : classroomCommands.has("document.snapshot")
          ? ((await classroomCommands.execute({
              name: "document.snapshot",
            })) as {
              text?: string;
              image?: string;
            })
          : await boardContext(api, questionWhole));
      const context = visible.text || "";
      request.signal.throwIfAborted();
      const result = await generateQuiz(
        text,
        request.signal,
        context,
        visible.image,
        questionType,
        (progress) => {
          if (!request.signal.aborted && quizRequest.current === request) {
            quizValue.current = progress;
            setQuiz(progress);
          }
        },
      );
      request.signal.throwIfAborted();
      if (quizRequest.current === request) {
        quizValue.current = result;
        setQuiz(result);
      }
      return result;
    } catch (failure) {
      if (!request.signal.aborted && quizRequest.current === request) {
        if (quietFailure) {
          console.error("[quiz-agent]", failure);
          setQuizOpen(false);
        } else {
          setQuizError(
            failure instanceof Error ? failure.message : String(failure),
          );
        }
      }
      throw failure;
    } finally {
      releaseOwner();
      signal.removeEventListener("abort", cancel);
      request.signal.removeEventListener("abort", stopped);
      quizRequests.current.delete(request);
      if (quizRequest.current === request) {
        quizRequest.current = null;
        setQuizBusy(false);
      }
    }
  };

  const retryImage = async (id: string) => {
    const source = quizValue.current;
    const question = source?.questions.find((item) => item.id === id);
    if (
      !source ||
      source.generating ||
      !question?.image ||
      question.image.status !== "error" ||
      imageRequests.current.has(id)
    ) {
      return;
    }
    const request = new AbortController();
    imageRequests.current.set(id, request);
    quizRequests.current.add(request);
    const publish = (
      image: NonNullable<QuizQuestion["image"]>,
      cancelled = false,
    ) => {
      const current = quizValue.current;
      if (
        !current ||
        current.id !== source.id ||
        (request.signal.aborted && !cancelled)
      ) {
        return;
      }
      const next = {
        ...current,
        questions: current.questions.map((item) =>
          item.id === id ? { ...item, image } : item,
        ),
      };
      quizValue.current = next;
      setQuiz(next);
    };
    publish({ ...question.image, status: "pending", error: undefined });
    try {
      const dataURL = await generateQuizImage(question, request.signal);
      publish({
        ...question.image,
        status: "ready",
        dataURL,
        error: undefined,
      });
    } catch (failure) {
      publish(
        {
          ...question.image,
          status: "error",
          error: request.signal.aborted
            ? t("fcboard.quizForm.cancelled")
            : failure instanceof Error
            ? failure.message
            : String(failure),
        },
        request.signal.aborted,
      );
    } finally {
      quizRequests.current.delete(request);
      imageRequests.current.delete(id);
    }
  };

  useEffect(
    () =>
      classroomCommands.onInvalidate((source) => {
        const owned = [...quizRequests.current].some((request) =>
          classroomCommands.isOwnedBy(source, request.signal),
        );
        if (owned && source && classroomCommands.isExpectedTransition(source)) {
          return;
        }
        quizRequests.current.forEach((request) => request.abort());
        stopVisibleQuiz();
        setQuizOpen(false);
        setAsking(false);
      }),
    [api, stopVisibleQuiz],
  );
  useEffect(() => {
    const registrations = [
      classroomCommands.register(
        "assistant.open",
        "Open the quiz builder to choose grade, question type, difficulty and supplementary subject/knowledge requirements. Optional args.whole=true supplies the visible surface as context. Submission uses the same quiz generation and cards as selection Quiz.",
        (args) => {
          if (args.whole !== undefined && typeof args.whole !== "boolean") {
            throw new Error(t("fcboard.invalid_ai_command_please_try_again"));
          }
          setQuestionWhole(args.whole === true);
          setAsking(true);
        },
      ),
      classroomCommands.register("assistant.close", "@internal", () => {
        setAsking(false);
        quizRequest.current?.abort();
        imageRequests.current.forEach((request) => request.abort());
        stopVisibleQuiz();
        setQuizOpen(false);
      }),
      classroomCommands.register(
        "quiz.generate",
        "Research args.prompt using actual web search and generate original answerable quiz cards for any subject/question type. Wait for completion and return the real title/count. No handwriting input panel is required. Optional args.context={text,image} restricts the source to the selected text/screenshot; otherwise inspect the current board.",
        async (args) => {
          if (typeof args.prompt !== "string" || !args.prompt.trim()) {
            throw new Error(t("fcboard.invalid_ai_command_please_try_again"));
          }
          const signal =
            args.signal instanceof AbortSignal
              ? args.signal
              : new AbortController().signal;
          const context = args.context as
            | { text?: unknown; image?: unknown }
            | undefined;
          if (
            context !== undefined &&
            (!context ||
              typeof context !== "object" ||
              Array.isArray(context) ||
              Object.keys(context).some(
                (key) => !["text", "image"].includes(key),
              ) ||
              typeof context.text !== "string" ||
              context.text.length > 12000 ||
              (context.image !== undefined &&
                (typeof context.image !== "string" ||
                  !context.image.startsWith("data:image/") ||
                  context.image.length > 12000000)) ||
              (!context.text.trim() && !context.image))
          ) {
            throw new Error(t("fcboard.invalid_ai_command_please_try_again"));
          }
          const result = await createQuiz(
            args.prompt,
            signal,
            context as { text: string; image?: string } | undefined,
            true,
          );
          signal.throwIfAborted();
          if (!result) {
            throw new Error(t("fcboard.generate_a_quiz_first"));
          }
          return { title: result.title, count: result.questions.length };
        },
      ),
      classroomCommands.register(
        "quiz.inspect",
        "Inspect the actual most recent quiz title/count. Pass zero-based args.index to read its question, options, answers and explanation before teaching; never invent questions.",
        (args) => {
          const value = quizValue.current;
          if (!value) {
            throw new Error(t("fcboard.generate_a_quiz_first"));
          }
          if (args.index === undefined) {
            return {
              title: value.title,
              count: value.questions.length,
              sources: value.sources,
            };
          }
          if (
            typeof args.index !== "number" ||
            !Number.isInteger(args.index) ||
            args.index < 0 ||
            args.index >= value.questions.length
          ) {
            throw new Error(t("fcboard.invalid_quiz_count"));
          }
          return value.questions[args.index];
        },
      ),
      classroomCommands.register(
        "quiz.open",
        "Reopen the latest quiz cards, preserving answers and card positions.",
        () => {
          if (!quizValue.current) {
            throw new Error(t("fcboard.generate_a_quiz_first"));
          }
          setQuizOpen(true);
          return {
            title: quizValue.current.title,
            count: quizValue.current.questions.length,
          };
        },
      ),
      classroomCommands.context("quiz", () => ({
        open: quizOpen,
        generating: quizBusy,
        title: quiz?.title,
        count: quiz?.questions.length,
        error: quizError || undefined,
      })),
    ];
    return () => registrations.forEach((stop) => stop());
  });

  return (
    <>
      <QuizComposer
        open={asking}
        onClose={() => setAsking(false)}
        onSubmit={(prompt, type) => {
          setAsking(false);
          void createQuiz(
            prompt,
            new AbortController().signal,
            undefined,
            false,
            type,
          ).catch(() => {});
        }}
      />
      {(quizOpen || quiz) && (
        <QuizPanel
          open={quizOpen}
          quiz={quiz}
          busy={quizBusy}
          error={quizError}
          onRetryImage={(id) => {
            void retryImage(id);
          }}
          onClose={() => {
            quizRequest.current?.abort();
            imageRequests.current.forEach((request) => request.abort());
            stopVisibleQuiz();
            setQuizOpen(false);
          }}
        />
      )}
    </>
  );
};
