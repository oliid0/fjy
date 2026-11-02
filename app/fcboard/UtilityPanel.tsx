import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";

import { QRCode } from "../share/QRCode";

import { classroomCommands } from "./commands";
import { Classroom } from "./native";
import { calculateAsync } from "./mathComputation";
import { MaterialPanel } from "./MaterialPanel";

import type { CalculatorState } from "./native";

type Poll = Awaited<ReturnType<typeof Classroom.pollStatus>>;

export const UtilityPanel = () => {
  const [panel, setPanel] = useState<"calculator" | "vote" | null>(null);
  const [expression, setExpression] = useState("");
  const [answer, setAnswer] = useState("");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState("赞成\n反对");
  const [poll, setPoll] = useState<Poll>();
  const [urls, setUrls] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const calculation = useRef<AbortController | undefined>(undefined);
  const calculator = useRef<CalculatorState>({ open: false, supported: true });
  useEffect(() => {
    let alive = true;
    const updateCalculator = (state: CalculatorState) => {
      if (alive) {
        calculator.current = state;
        classroomCommands.changed("calculator");
      }
      return state;
    };
    const listener = Capacitor.isNativePlatform()
      ? Classroom.addListener("calculatorState", updateCalculator)
      : undefined;
    const stops = [
      classroomCommands.register(
        "tools.calculator",
        "打开内置计算器，无需AI或token；Android9+运行原APK的布局/DEX，打开后calculator.inspect读取原按钮，再calculator.press操作。浏览器用本地计算器和ui.inspect/interact。",
        async () => {
          if (Capacitor.isNativePlatform()) {
            const state = updateCalculator(
              await Classroom.openBundledCalculator(),
            );
            if (state.supported) {
              setPanel(null);
              return state;
            }
          }
          setPanel("calculator");
          return { opened: true };
        },
      ),
      classroomCommands.register(
        "tools.vote",
        "打开内置局域网投票面板，手机扫码参与并实时统计。",
        () => {
          setPanel("vote");
          return { opened: true };
        },
      ),
      ...(Capacitor.isNativePlatform()
        ? [
            classroomCommands.context("calculator", () => calculator.current),
            classroomCommands.register(
              "calculator.inspect",
              "读取内置原版计算器真实表达式/结果/version和可点按钮ID；只读，先tools.calculator打开。",
              async () =>
                updateCalculator(
                  await Classroom.bundledCalculatorAction({ action: "read" }),
                ),
            ),
            classroomCommands.register(
              "calculator.press",
              "点击原版计算器真实按钮，与人工同一监听器；args.version必须来自最近calculator.inspect，args.controls为已发现的按钮ID顺序数组（最多64），返回真实结果和新version。不得用猜测ID。",
              async (args) => {
                if (
                  typeof args.version !== "string" ||
                  !Array.isArray(args.controls) ||
                  !args.controls.every((id) => typeof id === "string")
                ) {
                  throw new Error("请先读取实际计算器按钮和version");
                }
                return updateCalculator(
                  await Classroom.bundledCalculatorAction({
                    action: "press",
                    version: args.version,
                    controls: args.controls,
                  }),
                );
              },
            ),
            classroomCommands.register(
              "calculator.close",
              "关闭当前原版计算器，args.version来自最近calculator.inspect。",
              async (args) => {
                if (typeof args.version !== "string") {
                  throw new Error("请先读取计算器version");
                }
                return updateCalculator(
                  await Classroom.bundledCalculatorAction({
                    action: "close",
                    version: args.version,
                  }),
                );
              },
            ),
          ]
        : []),
    ];
    return () => {
      alive = false;
      void listener?.then((handle) => handle.remove()).catch(() => {});
      stops.forEach((stop) => stop());
      calculation.current?.abort();
      if (Capacitor.isNativePlatform()) {
        void Classroom.stopPoll().catch(() => {});
      }
    };
  }, []);
  useEffect(() => {
    if (!urls.length) {
      return;
    }
    let alive = true;
    let pending = false;
    const timer = setInterval(() => {
      if (pending) {
        return;
      }
      pending = true;
      void Classroom.pollStatus()
        .then((value) => {
          if (alive) {
            setPoll(value);
          }
        })
        .catch((failure) => {
          if (alive) {
            setError(String(failure));
          }
        })
        .finally(() => {
          pending = false;
        });
    }, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [urls]);
  const compute = async () => {
    calculation.current?.abort();
    const request = new AbortController();
    calculation.current = request;
    setBusy(true);
    setError("");
    try {
      const value = await calculateAsync(expression, request.signal);
      request.signal.throwIfAborted();
      setAnswer(value);
    } catch (failure) {
      if (!request.signal.aborted) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      if (calculation.current === request) {
        calculation.current = undefined;
        setBusy(false);
      }
    }
  };
  const start = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await Classroom.startPoll({
        question,
        options: options
          .split("\n")
          .map((value) => value.trim())
          .filter(Boolean),
      });
      setUrls(result.urls);
      setPoll(await Classroom.pollStatus());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  if (!panel) {
    return null;
  }
  return (
    <MaterialPanel
      centered
      role="dialog"
      aria-label={panel === "calculator" ? "计算器" : "投票"}
      className="fc-utility-panel fc-surface"
      onDismiss={() => setPanel(null)}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header>
        <strong>{panel === "calculator" ? "计算器" : "课堂投票"}</strong>
        <button
          onClick={() => {
            calculation.current?.abort();
            setPanel(null);
          }}
        >
          关闭
        </button>
      </header>
      {panel === "calculator" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void compute();
          }}
        >
          <label>
            算式
            <input
              aria-label="计算器算式"
              value={expression}
              onChange={(event) => setExpression(event.target.value)}
              maxLength={4000}
              placeholder="例如：0.1+0.2、sqrt(81)、sin(pi/2)"
            />
          </label>
          <div className="fc-calculator-keys">
            {[
              "7",
              "8",
              "9",
              "/",
              "4",
              "5",
              "6",
              "*",
              "1",
              "2",
              "3",
              "-",
              "0",
              ".",
              "(",
              ")",
              "^",
              "%",
              "!",
              "+",
            ].map((key) => (
              <button
                type="button"
                key={key}
                onClick={() => setExpression((current) => current + key)}
              >
                {key}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setExpression((current) => current.slice(0, -1))}
          >
            退格
          </button>
          <button
            type="button"
            onClick={() => {
              setExpression("");
              setAnswer("");
            }}
          >
            清空
          </button>
          <button disabled={busy || !expression.trim()}>计算</button>
          <output aria-live="polite">{answer}</output>
        </form>
      ) : (
        <>
          <label>
            投票问题
            <input
              value={question}
              maxLength={500}
              onChange={(event) => setQuestion(event.target.value)}
            />
          </label>
          <label>
            选项（每行一个，2至10项）
            <textarea
              value={options}
              onChange={(event) => setOptions(event.target.value)}
              maxLength={2000}
            />
          </label>
          <button
            disabled={busy || !question.trim() || !Capacitor.isNativePlatform()}
            onClick={() => void start()}
          >
            {poll ? "创建新投票" : "开始投票"}
          </button>
          {!Capacitor.isNativePlatform() && (
            <p>请在Android应用开启局域网投票。</p>
          )}
          {poll && (
            <>
              <h3>{poll.question}</h3>
              {urls[0] && <QRCode value={urls[0]} />}
              <p>
                {poll.closed ? "投票已结束" : "手机连接同一局域网后扫码投票"} ·
                已投 {poll.total} 人
              </p>
              {poll.options.map((option, index) => (
                <div key={index}>
                  {option}
                  <progress
                    max={Math.max(1, poll.total)}
                    value={poll.counts[index]}
                  />
                  {poll.counts[index]}票
                </div>
              ))}
              <button
                disabled={poll.closed || busy}
                onClick={() => {
                  setBusy(true);
                  void Classroom.pollStatus({ close: true })
                    .then(setPoll)
                    .catch((failure) => setError(String(failure)))
                    .finally(() => setBusy(false));
                }}
              >
                结束投票
              </button>
            </>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </MaterialPanel>
  );
};
