import { t, useI18n } from "@fcboard/fcboard/i18n";
import { useEffect, useRef, useState } from "react";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { InkQuestion } from "./InkQuestion";
import { QuizPanel } from "./QuizPanel";
import { selectionMathIntent, selectionRequest } from "./intent";
import { generateQuiz } from "./quiz";

import { boardContext } from "./ai";
import { classroomCommands, directCommand } from "./commands";
import { questionPosition } from "./questionInk";

import type { Quiz } from "./quiz";

export const Teacher = ({
  api,
  onCommand,
}: {
  api: FcboardImperativeAPI;
  onCommand: (
    text: string,
    signal: AbortSignal,
    sourceIds?: string[],
    whole?: boolean,
  ) => Promise<void>;
}) => {
  useI18n();
  const [asking, setAsking] = useState(false);
  const [questionWhole, setQuestionWhole] = useState(false);

  const [questionId, setQuestionId] = useState(0);
  const [questionPlacement, setQuestionPlacement] =
    useState<ReturnType<typeof questionPosition>>();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const quizValue = useRef<Quiz | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [quizBusy, setQuizBusy] = useState(false);
  const [quizError, setQuizError] = useState("");
  const quizRequest = useRef<AbortController | null>(null);
  const quizRequests = useRef(new Set<AbortController>());
  useEffect(() => {
    const requests = quizRequests.current;
    return () => requests.forEach((request) => request.abort());
  }, []);
  const createQuiz = async (
    text: string,
    signal: AbortSignal,
    sourceIds?: string[],
    forceQuiz = false,
    sourceContext?: { text: string; image?: string },
  ) => {
    const quizRequirement =
      /(?:出|生成|设计|编写|创建|给我).*(?:题|卷)|\b(?:quiz|questions|exam|test)\b/i.test(
        text,
      );
    // Preserve the existing deterministic math and explicit tool routes.
    // Ordinary prompts in this entry generate quiz cards instead of board answers.
    if (
      !forceQuiz &&
      !quizRequirement &&
      (selectionMathIntent(text) ||
        directCommand(text) ||
        selectionRequest(text))
    ) {
      return onCommand(text, signal, sourceIds, questionWhole);
    }
    const request = new AbortController();
    quizRequests.current.add(request);
    quizRequest.current = request;
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
      );
      request.signal.throwIfAborted();
      if (quizRequest.current === request) {
        quizValue.current = result;
        setQuiz(result);
      }
      return result;
    } catch (failure) {
      if (!request.signal.aborted && quizRequest.current === request) {
        if (forceQuiz) {
          console.error("[quiz-agent]", failure);
          setQuizOpen(false);
        } else {
          setQuizError((failure as Error).message);
        }
      }
      throw failure;
    } finally {
      releaseOwner();
      signal.removeEventListener("abort", cancel);
      quizRequests.current.delete(request);
      if (quizRequest.current === request) {
        quizRequest.current = null;
        setQuizBusy(false);
      }
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
        setQuizOpen(false);
        setAsking(false);
      }),
    [api],
  );
  useEffect(() => {
    const registrations = [
      classroomCommands.register(
        "assistant.open",
        "Open the handwriting question frame on the visible canvas. Optional args.whole=true analyzes the entire visible surface on submission; otherwise preserve the current selection context. Supports handwriting and dictation through the existing command router.",
        (args) => {
          if (args.whole !== undefined && typeof args.whole !== "boolean") {
            throw new Error(t("fcboard.invalid_ai_command_please_try_again"));
          }
          const placement = questionPosition(api);
          setQuestionWhole(args.whole === true);
          setQuestionPlacement(placement);
          setQuestionId((value) => value + 1);
          setAsking(true);
        },
      ),
      classroomCommands.register("assistant.close", "@internal", async () => {
        setAsking(false);
        if (classroomCommands.has("question.cancel")) {
          await classroomCommands.execute({ name: "question.cancel" });
        }
      }),
      classroomCommands.register(
        "quiz.generate",
        "根据args.prompt联网核实资料并生成可作答卡片测验，支持任意学科与题型，例：出10道高一数学选择题。完成后返回真实标题/题数。无需打开手写输入框；可选args.context={text,image}只基于已经圈选的截图/文字出题，未传则读取当前白板。该命令会等待生成完成。",
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
            undefined,
            true,
            context as { text: string; image?: string } | undefined,
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
        "读取最近生成测验的真实标题/题数；传args.index（从0开始）读取该题题干、选项、答案与解析，用于继续讲解，不编造题目。",
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
        "重新显示最近生成的答题卡，保留已有作答和卡片位置。",
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
      <InkQuestion
        key={questionId}
        api={api}
        placement={asking ? questionPlacement : undefined}
        onSubmit={async (text, signal, ids, context) => {
          await createQuiz(text, signal, ids, false, context);
        }}
      />
      {(quizOpen || quiz) && (
        <QuizPanel
          open={quizOpen}
          quiz={quiz}
          busy={quizBusy}
          error={quizError}
          onClose={() => {
            quizRequest.current?.abort();
            setQuizOpen(false);
          }}
        />
      )}
    </>
  );
};
