import { t, useI18n } from "@excalidraw/excalidraw/i18n";
import { useEffect, useRef, useState } from "react";

import {
  CloseIcon,
  playerPlayIcon,
} from "@excalidraw/excalidraw/components/icons";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { TransientMessage } from "./TransientMessage";

import { useAnchoredPanel } from "./floating";

import { boardContext, chat, parseJSON, visualMessage } from "./ai";
import { classroomCommands } from "./commands";
import { LESSON_FORMAT, validateLesson } from "./lesson";
import { searchMaterials } from "./materials";
import { lessonSessions, saveLessonSession, TeachingEngine } from "./teaching";

import type { Lens, TeachingSession } from "./teaching";

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
        {t("fcboard.讲解方式")}
        <select
          value={value.lens || "standard"}
          onChange={(event) =>
            update({ ...value, lens: event.target.value as Lens })
          }
        >
          <option value="standard">{t("fcboard.图文与语音")}</option>
          <option value="audio">
            {t("fcboard.语音描述图形 · 适合低视力")}
          </option>
          <option value="captions">{t("fcboard.字幕优先 · 无需声音")}</option>
          <option value="reading">{t("fcboard.易读文字 · 同步高亮")}</option>
          <option value="focus">{t("fcboard.短步骤 · 每步停顿")}</option>
        </select>
      </label>
      <label>
        {t("fcboard.讲课速度")}
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
  onCommand: (text: string) => Promise<void>;
}) => {
  useI18n();
  const engine = useRef<TeachingEngine | null>(null);
  if (!engine.current) {
    engine.current = new TeachingEngine(api);
  }
  const controller = engine.current;
  const [state, setState] = useState(controller.state);
  const [asking, setAsking] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const session = useRef<string>("");
  const active = state.mode !== "idle";
  const surface = useRef<HTMLElement>(null);
  const floatingStyle = useAnchoredPanel(
    surface,
    "[data-testid='main-menu-trigger']",
    active || asking || !!error,
  );

  useEffect(() => {
    const configure = () => {
      const saved = preferences();
      controller.configure(saved.speed || 1, saved.lens || "standard");
    };
    configure();
    let timer: ReturnType<typeof setTimeout>;
    let write: Promise<unknown> = Promise.resolve();
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
        correct: next.correct,
        attempts: next.attempts,
        updated: Date.now(),
        canvas: controller.canvas,
      };
      clearTimeout(timer);
      timer = setTimeout(() => {
        write = write
          .catch(() => {})
          .then(() => saveLessonSession(value))
          .catch(() =>
            setError(t("fcboard.讲解记录保存失败，白板内容仍在当前板上")),
          );
      }, 400);
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
      request.current?.abort();
      controller.cancel();
      clearTimeout(timer);
      stop();
      invalidate();
      pointer();
      window.removeEventListener("fcboard-teaching-settings", configure);
    };
  }, [api, controller]);
  useEffect(() => {
    if (asking) {
      input.current?.focus();
    }
  }, [asking]);

  const fail = (failure: unknown) => {
    if (failure instanceof DOMException && failure.name === "AbortError") {
      return;
    }
    setError(failure instanceof Error ? failure.message : String(failure));
    if (controller.state.lesson) {
      controller.pause();
    } else {
      controller.cancel();
      setAsking(true);
    }
  };
  const teach = async (
    question: string,
    branch: boolean,
    signal?: AbortSignal,
  ) => {
    if (!question.trim()) {
      throw new Error(t("fcboard.请说出想学的内容，或选中题目后提问"));
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
      const context = await boardContext(api);
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
      const result = await chat(
        [
          {
            role: "system",
            content: `你是方成教育的现场教师。${LESSON_FORMAT}\n${
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
            )}\n正在讲解的步骤：${JSON.stringify(
              controller.state.lesson?.steps[controller.state.step],
            )}`,
            document?.image || context.image,
          ),
        ],
        abort.signal,
        undefined,
        { maxTokens: 8192 },
      );
      if (abort.signal.aborted || revision !== classroomCommands.revision) {
        return;
      }
      const lesson = validateLesson(parseJSON(result));
      setAsking(false);
      setPrompt("");
      if (branch) {
        void controller.branch(lesson).catch(fail);
      } else {
        session.current = crypto.randomUUID();
        void controller.start(lesson).catch(fail);
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
        "打开输入框，可提出问题或操作所有当前组件",
        () => {
          controller.pause();
          setAsking(true);
        },
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
            throw new Error(t("fcboard.讲解方式无效"));
          }
          if (
            args.speed !== undefined &&
            (typeof args.speed !== "number" ||
              !Number.isFinite(args.speed) ||
              args.speed < 0.5 ||
              args.speed > 2)
          ) {
            throw new Error(t("fcboard.讲课速度超出范围"));
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
            throw new Error(t("fcboard.还没有保存的课程"));
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
      })),
    ];
    return () => registrations.forEach((stop) => stop());
  });

  return (
    <>
      {(active || asking || error) && (
        <section
          ref={surface}
          style={floatingStyle}
          className={`fc-teacher fc-surface fc-lens-${state.lens}`}
          aria-label={t("fcboard.AI 教师")}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              setAsking(false);
            }
          }}
        >
          {active && (
            <div className="fc-teacher-heading">
              <small>
                {state.lesson?.title || t("fcboard.正在备课")}
                {state.lesson &&
                  ` · ${state.step + 1}/${state.lesson.steps.length}`}
              </small>
              <button
                aria-label={
                  state.mode === "complete"
                    ? t("fcboard.重播讲解")
                    : ["teaching", "question"].includes(state.mode)
                    ? t("fcboard.暂停讲解")
                    : t("fcboard.继续讲解")
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
                aria-label={t("fcboard.结束讲解")}
                onClick={() => {
                  request.current?.abort();
                  controller.cancel();
                }}
              >
                {CloseIcon}
              </button>
            </div>
          )}
          <TransientMessage message={error} role="alert" />
          {active && (
            <div className="fc-live-caption" role="status" aria-live="polite">
              {state.lens === "reading" && state.spoken > 0 ? (
                <>
                  <mark>{state.caption.slice(0, state.spoken)}</mark>
                  {state.caption.slice(state.spoken)}
                </>
              ) : state.mode === "generating" ? (
                t("fcboard.正在阅读白板，准备讲解…")
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
              {t("fcboard.字幕讲解中 · 语音播报暂不可用")}
            </small>
          )}
          {asking && (
            <form
              className="fc-teacher-question"
              onSubmit={(event) => {
                event.preventDefault();
                const question = prompt;
                setAsking(false);
                setPrompt("");
                void onCommand(question).catch(fail);
              }}
            >
              <input
                ref={input}
                aria-label={t("fcboard.向 AI 教师提问")}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={t("fcboard.讲讲我圈的这一步，或换个例子…")}
                required
              />
              <button
                aria-label={t("fcboard.发送问题")}
                disabled={!prompt.trim() || state.mode === "generating"}
              >
                {playerPlayIcon}
              </button>
              <button
                type="button"
                aria-label={t("fcboard.收起提问")}
                onClick={() => setAsking(false)}
              >
                {CloseIcon}
              </button>
            </form>
          )}
          {error && (
            <button
              aria-label={t("fcboard.关闭教师提示")}
              onClick={() => {
                setError("");
                setAsking(false);
              }}
            >
              {CloseIcon}
            </button>
          )}
        </section>
      )}
    </>
  );
};
