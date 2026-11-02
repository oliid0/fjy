import { useCallback, useEffect, useRef, useState } from "react";

import { MaterialPanel } from "./MaterialPanel";
import { classroomCommands } from "./commands";
import { generateQuiz, gradeChoice } from "./quiz";
import "./QuizPanel.scss";

import type { Quiz } from "./quiz";

const labels = {
  single: "单选题",
  multiple: "多选题",
  boolean: "判断题",
  short: "简答题",
  blank: "填空题",
  calculation: "计算题",
  analysis: "分析题",
  challenge: "压轴题",
};

export const QuizPanel = () => {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [quiz, setQuiz] = useState<Quiz>();
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | undefined>(undefined);
  const state = useRef({ quiz, answers, revealed });
  state.current = { quiz, answers, revealed };
  const close = () => {
    request.current?.abort();
    setOpen(false);
  };
  const generate = useCallback(
    async (instruction: string, signal?: AbortSignal) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      const cancel = () => controller.abort(signal?.reason);
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) {
        cancel();
      }
      setOpen(true);
      setPrompt(instruction);
      setBusy(true);
      setError("");
      try {
        const next = await generateQuiz(instruction, controller.signal);
        controller.signal.throwIfAborted();
        setQuiz(next);
        setAnswers({});
        setRevealed(false);
        return { title: next.title, count: next.questions.length };
      } catch (failure) {
        if (!controller.signal.aborted) {
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
        }
        throw failure;
      } finally {
        signal?.removeEventListener("abort", cancel);
        if (request.current === controller) {
          request.current = undefined;
          setBusy(false);
        }
      }
    },
    [],
  );
  useEffect(() => {
    const stops = [
      classroomCommands.register("quiz.open", "打开AI出题和答题面板。", () => {
        setOpen(true);
        return { opened: true };
      }),
      classroomCommands.register(
        "quiz.generate",
        "联网生成任意学科试题：args.prompt完整出题要求，含题型/数量/年级。",
        (args) => {
          if (typeof args.prompt !== "string") {
            throw new Error("请输入出题要求");
          }
          return generate(args.prompt, args.signal as AbortSignal | undefined);
        },
      ),
      classroomCommands.register(
        "quiz.inspect",
        "读取当前试题和用户作答状态；答案只在已交卷后公开。",
        () => {
          const value = state.current;
          return {
            ...value,
            quiz: value.quiz && {
              ...value.quiz,
              questions: value.quiz.questions.map((q) =>
                value.revealed
                  ? q
                  : {
                      id: q.id,
                      type: q.type,
                      prompt: q.prompt,
                      options: q.options,
                    },
              ),
            },
          };
        },
      ),
    ];
    return () => {
      stops.forEach((stop) => stop());
      request.current?.abort();
    };
  }, [generate]);
  if (!open) {
    return null;
  }
  const scored =
    quiz?.questions.filter((q) => gradeChoice(q, answers[q.id] || []) === true)
      .length || 0;
  const choiceCount = quiz?.questions.filter((q) => !!q.options).length || 0;
  return (
    <MaterialPanel
      centered
      role="dialog"
      aria-label="AI出题"
      className="fc-quiz-panel fc-surface"
      onDismiss={close}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <header>
        <strong>AI出题</strong>
        <button onClick={close}>关闭</button>
      </header>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void generate(prompt).catch(() => {});
        }}
      >
        <label>
          出题要求
          <input
            value={prompt}
            maxLength={4000}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例如：出10道高一数学选择题"
          />
        </label>
        <button disabled={busy || !prompt.trim()}>联网出题</button>
        {busy && (
          <button type="button" onClick={() => request.current?.abort()}>
            取消
          </button>
        )}
      </form>
      {busy && <p role="status">正在联网核对知识并生成试题…</p>}
      {error && <p role="alert">{error}</p>}
      {!quiz && !busy && (
        <p>
          支持各学科、专业的单选、多选、判断、简答、填空、计算、分析和压轴题。
        </p>
      )}
      {quiz && (
        <>
          <h2>{quiz.title}</h2>
          <div className="fc-quiz-questions">
            {quiz.questions.map((q, i) => (
              <fieldset key={q.id} disabled={busy || revealed}>
                <legend>
                  {i + 1}. {labels[q.type]}
                </legend>
                <p>{q.prompt}</p>
                {q.options ? (
                  q.options.map((option, index) => (
                    <label key={option}>
                      <input
                        type={q.type === "multiple" ? "checkbox" : "radio"}
                        name={q.id}
                        checked={(answers[q.id] || []).includes(option)}
                        onChange={(e) =>
                          setAnswers((current) => ({
                            ...current,
                            [q.id]:
                              q.type === "multiple"
                                ? e.target.checked
                                  ? [...(current[q.id] || []), option]
                                  : (current[q.id] || []).filter(
                                      (a) => a !== option,
                                    )
                                : [option],
                          }))
                        }
                      />
                      {String.fromCharCode(65 + index)}. {option}
                    </label>
                  ))
                ) : q.type === "blank" ? (
                  q.answer.map((_, index) => (
                    <label key={index}>
                      第{index + 1}空
                      <input
                        aria-label={`第${i + 1}题第${index + 1}空`}
                        value={answers[q.id]?.[index] || ""}
                        onChange={(e) =>
                          setAnswers((current) => {
                            const values = [...(current[q.id] || [])];
                            values[index] = e.target.value;
                            return { ...current, [q.id]: values };
                          })
                        }
                      />
                    </label>
                  ))
                ) : (
                  <textarea
                    aria-label={`第${i + 1}题作答`}
                    value={answers[q.id]?.[0] || ""}
                    onChange={(e) =>
                      setAnswers((current) => ({
                        ...current,
                        [q.id]: [e.target.value],
                      }))
                    }
                  />
                )}
                {revealed && (
                  <div className="fc-quiz-solution">
                    <strong>
                      {q.options
                        ? gradeChoice(q, answers[q.id] || [])
                          ? "回答正确"
                          : "回答错误或未答"
                        : "参考答案（主观题请对照解析自评）"}
                    </strong>
                    <p>{q.answer.join("；")}</p>
                    <p>{q.explanation}</p>
                  </div>
                )}
              </fieldset>
            ))}
          </div>
          <footer>
            <button disabled={busy} onClick={() => setRevealed(!revealed)}>
              {revealed ? "继续作答" : "交卷 / 显示答案"}
            </button>
            {revealed && (
              <output>
                客观题 {scored} / {choiceCount} 正确
              </output>
            )}
            <button
              disabled={busy}
              onClick={() => {
                setAnswers({});
                setRevealed(false);
              }}
            >
              重新作答
            </button>
          </footer>
          <aside>
            参考资料：
            {quiz.sources.map((source) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noreferrer"
              >
                {source.title}
              </a>
            ))}
          </aside>
        </>
      )}
    </MaterialPanel>
  );
};
