import { MaterialSelect } from "@excalidraw/excalidraw/components/MaterialSelect";
import { t, useI18n, getLanguage } from "@excalidraw/excalidraw/i18n";
import { useEffect, useRef, useState } from "react";
import CircularProgress from "@mui/material/CircularProgress";

import {
  CloseIcon,
  playerPlayIcon,
} from "@excalidraw/excalidraw/components/icons";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { TransientMessage } from "./TransientMessage";
import { InkQuestion } from "./InkQuestion";

import { useAnchoredPanel } from "./floating";

import { boardContext, chat, parseJSON, visualMessage } from "./ai";
import { agentContext, runBoardCommands } from "./agent";
import { classroomCommands } from "./commands";
import { LESSON_FORMAT, LESSON_TOOLS_FORMAT, validateLesson } from "./lesson";
import { searchMaterials } from "./materials";
import { lessonSessions, saveLessonSession, TeachingEngine } from "./teaching";
import { questionPosition } from "./questionInk";
import { observeLesson } from "./lessonObserver";

import type { Lens, TeachingSession } from "./teaching";
import type { Message } from "./ai";
import type { BoardAgentAction } from "./agent";

const preferences = () => {
  try {
    return JSON.parse(localStorage.getItem("fcboard-teaching") || "{}") as {
      lens?: Lens;
      speed?: number;
    };
  } catch {
    return {};
  }
};
export const LearningSettings = () => {
  useI18n();
  const [value, setValue] = useState(preferences);
  useEffect(() => {
    const refresh = () => setValue(preferences());
    window.addEventListener("fcboard-teaching-settings", refresh);
    return () =>
      window.removeEventListener("fcboard-teaching-settings", refresh);
  }, []);
  const update = (next: typeof value) => {
    setValue(next);
    localStorage.setItem("fcboard-teaching", JSON.stringify(next));
    window.dispatchEvent(new Event("fcboard-teaching-settings"));
  };
  return (
    <>
      <label>
        {t("fcboard.teaching_mode")}
        <MaterialSelect
          aria-label={t("fcboard.teaching_mode")}
          value={value.lens || "standard"}
          onChange={(event) =>
            update({ ...value, lens: event.target.value as Lens })
          }
        >
          <option value="standard">{t("fcboard.visuals_and_voice")}</option>
          <option value="audio">
            {t("fcboard.describe_visuals_aloud_low_vision")}
          </option>
          <option value="captions">
            {t("fcboard.captions_first_no_audio_needed")}
          </option>
          <option value="reading">
            {t("fcboard.easy_reading_synchronized_highlight")}
          </option>
          <option value="focus">
            {t("fcboard.short_steps_pause_after_each_step")}
          </option>
        </MaterialSelect>
      </label>
      <label>
        {t("fcboard.teaching_speed")}
        <input
          type="range"
          min="0.5"
          max="2"
          step="0.1"
          value={value.speed || 1}
          onChange={(event) =>
            update({ ...value, speed: Number(event.target.value) })
          }
        />
      </label>
    </>
  );
};

export const Teacher = ({
  api,
  onCommand,
}: {
  api: ExcalidrawImperativeAPI;
  onCommand: (
    text: string,
    signal: AbortSignal,
    sourceIds?: string[],
    whole?: boolean,
  ) => Promise<void>;
}) => {
  useI18n();
  const engine = useRef<TeachingEngine | null>(null);
  if (!engine.current) {
    engine.current = new TeachingEngine(api, observeLesson);
  }
  const controller = engine.current;
  const [state, setState] = useState(controller.state);
  const [asking, setAsking] = useState(false);
  const [questionWhole, setQuestionWhole] = useState(false);
  const [questionId, setQuestionId] = useState(0);
  const [questionPlacement, setQuestionPlacement] =
    useState<ReturnType<typeof questionPosition>>();
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const session = useRef<string>("");
  const active = state.mode !== "idle";
  const surface = useRef<HTMLElement>(null);
  const floatingStyle = useAnchoredPanel(
    surface,
    "[data-testid='main-menu-trigger']",
    active || !!error,
  );

  useEffect(() => {
    const configure = () => {
      const saved = preferences();
      controller.configure(saved.speed || 1, saved.lens || "standard");
    };
    configure();
    let alive = true;
    let savedProgress = "";
    let savedPlan = controller.state.lesson;
    const stop = controller.subscribe((next) => {
      setState(next);
      if (!next.lesson || !controller.canvas) {
        return;
      }
      const snapshot = classroomCommands.read("boards") as
        | { active?: string }
        | undefined;
      const value: TeachingSession = {
        id: session.current || (session.current = crypto.randomUUID()),
        board: snapshot?.active || "",
        lesson: next.lesson,
        step: next.step,
        toolIndex: next.toolIndex,
        correct: next.correct,
        attempts: next.attempts,
        updated: Date.now(),
        canvas: controller.canvas,
      };
      const progress = JSON.stringify([
        value.id,
        value.board,
        value.step,
        value.toolIndex,
        value.correct,
        value.attempts,
        value.canvas.id,
        next.mode === "complete",
      ]);
      if (progress === savedProgress && next.lesson === savedPlan) {
        return;
      }
      savedProgress = progress;
      savedPlan = next.lesson;
      void saveLessonSession(value).catch(() => {
        if (savedProgress === progress && savedPlan === next.lesson) {
          savedProgress = "";
        }
        if (alive) {
          setError(
            t(
              "fcboard.could_not_save_the_lesson_record_your_board_content_is_preserved",
            ),
          );
        }
      });
    });
    const invalidate = classroomCommands.onInvalidate(() => {
      request.current?.abort();
      controller.cancel();
      setAsking(false);
    });
    const pointer = api.onPointerDown(() => {
      if (["teaching", "question"].includes(controller.state.mode)) {
        controller.pause();
      }
    });
    window.addEventListener("fcboard-teaching-settings", configure);
    return () => {
      alive = false;
      stop();
      request.current?.abort();
      controller.cancel();
      invalidate();
      pointer();
      window.removeEventListener("fcboard-teaching-settings", configure);
    };
  }, [api, controller]);
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(""), 4500);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const fail = (failure: unknown) => {
    if (failure instanceof DOMException && failure.name === "AbortError") {
      return;
    }
    setError(failure instanceof Error ? failure.message : String(failure));
    if (controller.state.lesson) {
      controller.pause();
    } else {
      controller.cancel();
    }
  };
  const teach = async (
    question: string,
    branch: boolean,
    signal?: AbortSignal,
    sourceIds?: string[],
  ) => {
    if (!question.trim()) {
      throw new Error(
        t(
          "fcboard.say_what_you_want_to_learn_or_select_a_question_to_ask_about_it",
        ),
      );
    }
    request.current?.abort();
    const abort = new AbortController();
    request.current = abort;
    const cancel = () => abort.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) {
      cancel();
    }
    try {
      const revision = classroomCommands.revision;
      setError("");
      if (branch) {
        controller.interrupt();
      } else {
        controller.generating();
      }
      const sources = await searchMaterials(question);
      const document = (
        classroomCommands.has("document.snapshot")
          ? await classroomCommands.execute({ name: "document.snapshot" })
          : undefined
      ) as
        | {
            text: string;
            name: string;
            page: number;
            image?: string;
            ink?: unknown;
          }
        | undefined;
      const context = document
        ? { elements: [], text: document.text, image: document.image }
        : await boardContext(
            api,
            false,
            sourceIds?.length
              ? api
                  .getSceneElements()
                  .filter((element) => sourceIds.includes(element.id))
              : undefined,
          );
      const pageSource = document
        ? (classroomCommands.read("document") as
            | { selection?: string[]; ink?: { id: string; lesson?: string }[] }
            | undefined)
        : undefined;
      const writingSourceIds =
        sourceIds ||
        (document
          ? pageSource?.selection?.length
            ? pageSource.selection
            : pageSource?.ink
                ?.filter((stroke) => !stroke.lesson)
                .map((stroke) => stroke.id)
          : context.elements
              .filter(
                (element) =>
                  (element.type === "text" || element.type === "freedraw") &&
                  !element.customData?.fcLessonId,
              )
              .map((element) => element.id));
      if (abort.signal.aborted || revision !== classroomCommands.revision) {
        return;
      }
      const lens = controller.state.lens;
      const documentText = document
        ? {
            text: document.text,
            name: document.name,
            page: document.page,
            ink: document.ink,
          }
        : undefined;
      const messages: Message[] = [
        {
          role: "system",
          content: `你是方成教育的现场教师。默认用当前界面语言 ${
            getLanguage().code
          } 讲述和板书，用户明确要求的语言优先。${LESSON_FORMAT}\n${LESSON_TOOLS_FORMAT}\n如需先观察或准备工具，返回 {"action":"commands","commands":[{"name":"已注册命令","args":{}}],"continue":true}，系统执行后返回真实结果和最新状态，你再决定下一步。可用 canvas.inspect 读取当前可见画布，math.evaluate 本地核算而不写板，其余工具按需要使用；不得编造结果、对象id或能力。准备完成返回 {"action":"lesson","lesson":上述课程JSON}，也可直接返回课程JSON。讲解准备阶段禁止递归调用 lesson.ask、lesson.teach 或另开 assistant.open；只有用户明确要求才删除、清空、录制或退出。已注册工具：\n${classroomCommands.describe()}\n${
            document
              ? "当前在课件透明板书层，坐标相对课件左上角，范围0..900宽、0..480高。优先用圈线和箭头解释现有课件，板书简短并避开原文；不可擦除原课件。"
              : ""
          }\n${
            branch
              ? "这是对当前讲解的追问：围绕学生圈中的位置解答，换例子、分解推理或纠正误解，只写2到4个短步骤，quiz 留空。不要重新开始整节课。"
              : "先观察学生已写的步骤，循序渐进地引导，结束给2道理解测验；先问学生关键一步，不直接跳到答案。"
          }\n教学模式=${lens}。${
            lens === "audio"
              ? "每个图形和方向都在 say 中完整描述，避免只说看这里。"
              : lens === "reading"
              ? "句子短，术语分开解释，避免大段文字。"
              : lens === "focus"
              ? "每步只讲一个概念，say 少于80字。"
              : "语音、字幕和绘图互相配合。"
          } 不推断学生残障或能力。${
            controller.state.attempts > controller.state.correct ||
            controller.state.interruptions > 1
              ? "学生已经反复提问或答错，改用具体类比，降低步幅。"
              : ""
          }`,
        },
        visualMessage(
          `${question}\n白板文字：${context.text}\n选中对象：${JSON.stringify(
            context.elements.map((el) => ({
              id: el.id,
              type: el.type,
              x: el.x,
              y: el.y,
              text: el.type === "text" ? el.text : undefined,
            })),
          )}\n当前课件：${JSON.stringify(
            documentText,
          )}\n用户资料原文与页码（仅引用这里真实存在的来源）：${JSON.stringify(
            sources,
          )}\n当前工具与画布状态：${agentContext(
            classroomCommands.snapshot(),
          )}\n正在讲解的步骤：${JSON.stringify(
            controller.state.lesson?.steps[controller.state.step],
          )}`,
          document?.image || context.image,
        ),
      ];
      const result = await chat(messages, abort.signal, undefined, {
        maxTokens: 8192,
      });
      if (abort.signal.aborted || revision !== classroomCommands.revision) {
        return;
      }
      let response = parseJSON(result) as BoardAgentAction;
      if (response?.action === "commands") {
        response = await runBoardCommands(
          response,
          messages,
          abort.signal,
          () =>
            request.current === abort &&
            revision === classroomCommands.revision,
          {
            completion:
              '准备完成后返回 {"action":"lesson","lesson":课程JSON}；仍需工具时继续返回 commands。课程必须遵循原系统提示的步骤 / 绘图 / 语音格式，禁止用 done 或聊天文本代替课程。',
            exclude: ["lesson.ask", "lesson.teach", "assistant.open"],
            maxTokens: 8192,
          },
        );
      }
      if (
        abort.signal.aborted ||
        revision !== classroomCommands.revision ||
        request.current !== abort
      ) {
        return;
      }
      const lesson = validateLesson(
        response?.action === "lesson" ? response.lesson : response,
      );
      lesson.instruction = question;
      setAsking(false);
      if (branch) {
        void controller.branch(lesson, writingSourceIds).catch(fail);
      } else {
        session.current = crypto.randomUUID();
        void controller
          .start(lesson, 0, undefined, undefined, writingSourceIds)
          .catch(fail);
      }
    } finally {
      signal?.removeEventListener("abort", cancel);
      if (
        abort.signal.aborted &&
        request.current === abort &&
        controller.state.mode === "generating"
      ) {
        controller.cancel();
      }
    }
  };
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
          controller.pause();
          setQuestionWhole(args.whole === true);
          setQuestionPlacement(placement);
          setQuestionId((value) => value + 1);
          setAsking(true);
        },
      ),
      classroomCommands.register("assistant.close", "@internal", () =>
        setAsking(false),
      ),
      classroomCommands.register(
        "lesson.configure",
        "设置教学方式与速度，args.lens=standard|audio|captions|reading|focus，args.speed=0.5..2",
        (args) => {
          const saved = preferences();
          if (
            args.lens !== undefined &&
            !["standard", "audio", "captions", "reading", "focus"].includes(
              String(args.lens),
            )
          ) {
            throw new Error(t("fcboard.invalid_teaching_mode"));
          }
          if (
            args.speed !== undefined &&
            (typeof args.speed !== "number" ||
              !Number.isFinite(args.speed) ||
              args.speed < 0.5 ||
              args.speed > 2)
          ) {
            throw new Error(t("fcboard.teaching_speed_out_of_range"));
          }
          const next = {
            lens: (args.lens || saved.lens || "standard") as Lens,
            speed: Number(args.speed || saved.speed || 1),
          };
          localStorage.setItem("fcboard-teaching", JSON.stringify(next));
          window.dispatchEvent(new Event("fcboard-teaching-settings"));
        },
      ),
      classroomCommands.register(
        "lesson.teach",
        "逐步讲课并画图，args.prompt 为主题或问题；不要用于单纯操作界面",
        (args) =>
          teach(
            String(args.prompt || "请讲解当前选中的题目"),
            false,
            args.signal instanceof AbortSignal ? args.signal : undefined,
            Array.isArray(args.sourceIds) &&
              args.sourceIds.every((id) => typeof id === "string")
              ? args.sourceIds
              : undefined,
          ),
      ),
      classroomCommands.register(
        "lesson.ask",
        "结合圈选、白板与当前课件追问、引导或换个例子，args.prompt",
        (args) =>
          teach(
            String(args.prompt || "请讲解我圈出的内容"),
            !!controller.state.lesson && controller.state.mode !== "complete",
            args.signal instanceof AbortSignal ? args.signal : undefined,
            Array.isArray(args.sourceIds) &&
              args.sourceIds.every((id) => typeof id === "string")
              ? args.sourceIds
              : undefined,
          ),
      ),
      classroomCommands.register(
        "lesson.pause",
        "暂停教师语音和板书，保留位置",
        () => {
          if (controller.state.mode === "generating") {
            request.current?.abort();
          }
          controller.pause();
        },
      ),
      classroomCommands.register("lesson.resume", "从暂停的位置继续课堂", () =>
        controller.resume(),
      ),
      classroomCommands.register(
        "lesson.stop",
        "结束当前讲解，保留板面",
        () => {
          request.current?.abort();
          controller.cancel();
        },
      ),
      classroomCommands.register(
        "lesson.answer",
        "回答当前测验，args.index 从0开始，或 args.choice 为选项文本",
        (args) => {
          const index =
            args.index === undefined
              ? controller.state.question?.choices.findIndex(
                  (choice) => choice === args.choice,
                )
              : Number(args.index);
          return controller.answer(index ?? -1);
        },
      ),
      classroomCommands.register(
        "lesson.reopen",
        "继续之前保存的课程，args.id 可省略为最近一课",
        async (args) => {
          const saved = (await lessonSessions()).find(
            (item) => !args.id || item.id === args.id,
          );
          if (!saved) {
            throw new Error(t("fcboard.no_saved_lessons_yet"));
          }
          if (
            saved.board &&
            (
              classroomCommands.read("boards") as
                | { active?: string }
                | undefined
            )?.active !== saved.board
          ) {
            await classroomCommands.execute({
              name: "board.switch",
              args: { id: saved.board },
            });
          }
          const target = saved.canvas.document;
          if (target) {
            if (
              (
                classroomCommands.read("document") as
                  | { name?: string }
                  | undefined
              )?.name !== target.name
            ) {
              await classroomCommands.execute({
                name: "files.open",
                args: { name: target.name },
              });
            }
            await classroomCommands.execute({
              name: "document.page",
              args: { page: target.page },
            });
          } else if (classroomCommands.has("document.close")) {
            await classroomCommands.execute({
              name: "document.close",
              args: { next: false },
            });
          }
          session.current = saved.id;
          void controller
            .start(saved.lesson, saved.step, saved.canvas, saved)
            .catch(fail);
        },
      ),
      classroomCommands.context("teacher", () => ({
        mode: state.mode,
        title: state.lesson?.title,
        step: state.step + 1,
        caption: state.caption,
        question: state.question
          ? {
              question: state.question.question,
              choices: state.question.choices,
            }
          : undefined,
        correct: state.correct,
        attempts: state.attempts,
        tool: state.tool,
        toolError: state.toolError || undefined,
        toolResults: state.toolResults,
        toolIndex: state.toolIndex,
        observing: state.observing,
      })),
    ];
    return () => registrations.forEach((stop) => stop());
  });

  return (
    <>
      {asking && questionPlacement && (
        <InkQuestion
          key={questionId}
          api={api}
          placement={questionPlacement}
          onSubmit={(text, signal, sourceIds) =>
            onCommand(text, signal, sourceIds, questionWhole)
          }
          onClose={() => setAsking(false)}
        />
      )}
      {(active || error) && (
        <section
          ref={surface}
          style={floatingStyle}
          className={`fc-teacher fc-surface fc-lens-${state.lens}`}
          aria-label={t("fcboard.ai_teacher")}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              setAsking(false);
            }
          }}
        >
          {active && (
            <div className="fc-teacher-heading">
              {(state.tool || state.observing) &&
                ["teaching", "question"].includes(state.mode) && (
                  <CircularProgress
                    size={14}
                    aria-label={t("fcboard.processing")}
                  />
                )}
              <small>
                {state.lesson?.title || t("fcboard.preparing_lesson")}
                {state.lesson &&
                  ` · ${state.step + 1}/${state.lesson.steps.length}`}
              </small>
              <button
                aria-label={
                  state.mode === "complete"
                    ? t("fcboard.replay_lesson")
                    : ["teaching", "question"].includes(state.mode)
                    ? t("fcboard.pause_lesson")
                    : t("fcboard.resume_lesson")
                }
                disabled={state.mode === "generating" || state.mode === "quiz"}
                onClick={() =>
                  state.mode === "complete"
                    ? void controller
                        .start(state.lesson!, 0, controller.canvas)
                        .catch(fail)
                    : ["teaching", "question"].includes(state.mode)
                    ? controller.pause()
                    : controller.resume()
                }
              >
                {["teaching", "question"].includes(state.mode)
                  ? "Ⅱ"
                  : playerPlayIcon}
              </button>
              <button
                aria-label={t("fcboard.end_lesson")}
                onClick={() => {
                  request.current?.abort();
                  controller.cancel();
                }}
              >
                {CloseIcon}
              </button>
            </div>
          )}
          <TransientMessage message={error || state.toolError} role="alert" />
          {active && (
            <div className="fc-live-caption" role="status" aria-live="polite">
              {state.lens === "reading" && state.spoken > 0 ? (
                <>
                  <mark>{state.caption.slice(0, state.spoken)}</mark>
                  {state.caption.slice(state.spoken)}
                </>
              ) : state.mode === "generating" ? (
                t("fcboard.reading_the_board_and_preparing_your_lesson")
              ) : (
                state.caption
              )}
            </div>
          )}
          {state.question && (
            <div
              className="fc-quiz"
              role="group"
              aria-label={state.question.question}
            >
              {state.question.choices.map((choice, index) => (
                <button
                  key={index}
                  disabled={state.mode !== "quiz"}
                  onClick={() => {
                    try {
                      controller.answer(index);
                    } catch (failure) {
                      fail(failure);
                    }
                  }}
                >
                  {String.fromCharCode(65 + index)} · {choice}
                </button>
              ))}
            </div>
          )}
          {state.feedback && <p role="status">{state.feedback}</p>}
          {state.audioError && (
            <small title={state.audioError}>
              {t(
                "fcboard.teaching_with_captions_voice_playback_is_unavailable",
              )}
            </small>
          )}
        </section>
      )}
    </>
  );
};
