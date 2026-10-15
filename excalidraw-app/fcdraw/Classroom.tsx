import { Capacitor } from "@capacitor/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { getCommonBounds } from "@excalidraw/element";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { QRCode } from "../share/QRCode";

import { boardContext, chat, parseJSON, visualMessage } from "./ai";
import {
  drawPlot,
  insertCube,
  insertElements,
  insertionPoint,
  insertText,
  validateShapes,
} from "./board";
import { FilePreview } from "./FilePreview";
import { calculate, defaultPlot, plotExpression } from "./math";
import { Classroom as NativeClassroom } from "./native";
import {
  BoardRecorder,
  loadRecordings,
  saveRecordings,
  timestamp,
} from "./recording";
import {
  BRAND,
  currentSettings,
  saveSettings,
  validateEndpoint,
} from "./settings";
import { startSystemSpeech, transcribe } from "./speech";

import "./classroom.scss";

import type { Plot } from "./math";
import type { Upload } from "./native";
import type { Recording, RecordingMode } from "./recording";
import type { TranscriptLine } from "./speech";

type Panel = "ai" | "math" | "plot" | "record" | "files" | "settings";
const titles: Record<Panel, string> = {
  ai: "AI 助教",
  math: "数学计算",
  plot: "函数实验室",
  record: "课堂录制",
  files: "课件 / 局域网快传",
  settings: "AI 与语音设置",
};
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const RecordingPlayer = ({ recording }: { recording: Recording }) => {
  const [url, setUrl] = useState("");
  const player = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const value = URL.createObjectURL(recording.blob);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [recording.blob]);
  return (
    <>
      <h3>AI 总结</h3>
      <div className="fc-output">
        {recording.summary || "暂无总结，可在下方生成。"}
      </div>
      <video
        ref={player}
        controls
        src={url}
        aria-label="录制回放"
        className={recording.mode === "audio" ? "fc-audio" : ""}
      />
      <a
        href={url}
        download={`Fcdraw-${recording.id}.${
          recording.blob.type.includes("mp4") ? "mp4" : "webm"
        }`}
      >
        下载录制
      </a>
      <h3>时间轴文稿</h3>
      {recording.transcript.length ? (
        recording.transcript.map((line, index) => (
          <button
            className="fc-transcript"
            key={index}
            onClick={() => {
              if (player.current) {
                player.current.currentTime = line.time;
                void player.current.play().catch(() => {});
              }
            }}
          >
            <time>{timestamp(line.time)}</time>
            <span>{line.text}</span>
          </button>
        ))
      ) : (
        <p>暂无文稿。可配置自定义语音接口后转写，也可手动补充。</p>
      )}
    </>
  );
};

export const Classroom = ({ api }: { api: ExcalidrawImperativeAPI }) => {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [settings, setSettings] = useState(currentSettings);
  const [remember, setRemember] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [wholeBoard, setWholeBoard] = useState(false);
  const [mathInput, setMathInput] = useState("");
  const [autoMath, setAutoMath] = useState(false);
  const [plot, setPlot] = useState<Plot>(defaultPlot);
  const plotRef = useRef<{
    ids: string[];
    position: { x: number; y: number };
  } | null>(null);
  const [listening, setListening] = useState(false);
  const stopSpeech = useRef<(() => void) | null>(null);
  const voiceRecorder = useRef<MediaRecorder | null>(null);
  const [mode, setMode] = useState<RecordingMode>("screen");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<BoardRecorder | null>(null);
  const transcript = useRef<TranscriptLine[]>([]);
  const recordStarted = useRef(0);
  const [records, setRecords] = useState<Recording[]>([]);
  const recordsRef = useRef<Recording[]>([]);
  const [activeId, setActiveId] = useState("");
  const [manualTranscript, setManualTranscript] = useState("");
  const [urls, setUrls] = useState<string[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [preview, setPreview] = useState<File | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const actionBusy = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const active = records.find((item) => item.id === activeId);

  const persistRecords = useCallback(async (next: Recording[]) => {
    recordsRef.current = next;
    setRecords(next);
    try {
      await saveRecordings(next);
    } catch {
      setError("设备存储不足或不可用，录制尚未保存；请立即下载保留。");
    }
  }, []);

  useEffect(() => {
    void loadRecordings()
      .then((items) => {
        setRecords(items);
        recordsRef.current = items;
        setActiveId(items[0]?.id || "");
      })
      .catch(() => setError("无法读取本地录制资料"));
    if (Capacitor.isNativePlatform()) {
      void NativeClassroom.listUploads()
        .then(({ files }) => setUploads(files))
        .catch((failure) => setError(errorMessage(failure)));
    }
    return () => {
      stopSpeech.current?.();
      recorder.current?.dispose();
      if (voiceRecorder.current?.state === "recording") {
        voiceRecorder.current.stop();
      }
      if (Capacitor.isNativePlatform()) {
        void NativeClassroom.stopReceiver();
      }
    };
  }, []);

  useEffect(() => {
    if (!recording) {
      return;
    }
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - recordStarted.current) / 1000)),
      1000,
    );
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => {
      clearInterval(timer);
      window.removeEventListener("beforeunload", prevent);
    };
  }, [recording]);

  useEffect(() => {
    if (!urls.length) {
      return;
    }
    const refresh = () => {
      void NativeClassroom.listUploads()
        .then(({ files }) => setUploads(files))
        .catch((failure) => setError(errorMessage(failure)));
    };
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [urls]);

  useEffect(() => {
    if (panel) {
      panelRef.current?.querySelector<HTMLElement>("button")?.focus();
    }
  }, [panel]);

  const close = () => {
    setPanel(null);
    returnFocus.current?.focus();
  };
  const open = (value: Panel) => {
    returnFocus.current = document.activeElement as HTMLElement;
    setPanel((previous) => (previous === value ? null : value));
    setError("");
  };

  const run = useCallback(async (operation: () => Promise<void>) => {
    if (actionBusy.current) {
      return;
    }
    actionBusy.current = true;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await operation();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      actionBusy.current = false;
      setBusy(false);
    }
  }, []);

  const recognize = useCallback(
    async (kind: "math" | "plot") => {
      const context = await boardContext(api, wholeBoard);
      if (!context.elements.length) {
        throw new Error("请先书写内容，或框选需要识别的区域");
      }
      if (
        context.text.trim() &&
        !context.elements.some((el) => el.type === "freedraw")
      ) {
        return context.text.trim();
      }
      return (
        await chat([
          visualMessage(
            kind === "math"
              ? "识别图中最后一个尚未填答案的算式（以等号结束）。只返回可计算的表达式，不输出答案或解释。积分用 integrate(expr,x) 或 defint(expr,a,b,x)，导数 diff(expr,x)，极限 limit(expr,x,a)，方程 solve(expr,x)，复数用 i。无法识别时只返回 NONE。"
              : "识别所选内容中的函数，只返回 y=expression 或 z=expression。使用 x,y,z,a,b,c 变量，幂用 ^，乘法用 *。不要解释。",
            context.image,
          ),
        ])
      ).trim();
    },
    [api, wholeBoard],
  );

  const solveMath = useCallback(
    async (input?: string, automatic = false) => {
      const expression = input || (await recognize("math"));
      if (expression === "NONE") {
        if (!automatic) {
          throw new Error("未发现待计算算式");
        }
        return;
      }
      const answer = calculate(expression);
      const elements = api.getSceneElements();
      const selected = elements.filter(
        (el) => api.getAppState().selectedElementIds[el.id],
      );
      const source = selected.length
        ? selected
        : elements.filter((el) => !el.customData?.fcGenerated);
      const position = source.length
        ? (() => {
            const lastInput = [...source]
              .reverse()
              .find((el) => el.type === "text" || el.type === "freedraw");
            const anchor = selected.length || !lastInput ? source : [lastInput];
            const [, top, right, bottom] = getCommonBounds(anchor);
            return {
              x: right + 16,
              y: anchor.length === 1 ? top : Math.max(top, bottom - 32),
            };
          })()
        : insertionPoint(api);
      insertText(api, answer, position);
      setMathInput(expression);
      setOutput(`${expression} = ${answer}`);
      setStatus("计算结果已写入白板，可撤销或擦除");
    },
    [api, recognize],
  );

  const createPlot = useCallback(
    (next: Plot, replace = false) => {
      const existing = plotRef.current;
      if (
        replace &&
        existing &&
        !existing.ids.every((id) =>
          api.getSceneElements().some((el) => el.id === id),
        )
      ) {
        plotRef.current = null;
        throw new Error("图像已被移动到历史或擦除，请重新插入函数图像");
      }
      const position =
        replace && existing ? existing.position : insertionPoint(api);
      const ids = drawPlot(
        api,
        next,
        position,
        replace ? existing?.ids : undefined,
      );
      plotRef.current = { ids, position };
      setPlot(next);
      setStatus("函数图像已插入；调节参数可观察变化");
    },
    [api],
  );

  const summarize = useCallback(
    async (whole = wholeBoard) => {
      const context = await boardContext(api, whole);
      if (!context.elements.length) {
        throw new Error("白板还没有内容");
      }
      const result = await chat([
        visualMessage(
          `你是方成教育助教。根据白板内容总结本节知识、推导过程、结论与待解决问题。看不清的内容明确说明，不编造。\n识别到的文字：${context.text}`,
          context.image,
        ),
      ]);
      setOutput(result);
      setPanel("ai");
    },
    [api, wholeBoard],
  );

  const execute = useCallback(
    async (text: string) => {
      setPrompt(text);
      if (/立方体|正方体/.test(text)) {
        insertCube(api);
        setStatus("标准线条立方体已插入，可编辑或擦除");
        return;
      }
      if (/总结|小结|概括/.test(text)) {
        await summarize(/整|全部|这一板/.test(text));
        return;
      }
      if (/^(?:帮我)?(?:计算|求值)(?:一下)?[，。!！\s]*$/.test(text)) {
        await solveMath();
        setPanel("math");
        return;
      }
      const context = await boardContext(api, wholeBoard);
      const response = parseJSON(
        await chat([
          {
            role: "system",
            content:
              '你是方成教育白板助教。将用户要求转成 JSON，不要 markdown。根据意图返回 {"action":"plot","expression":"x+1","surface":false}（三维 z=f(x,y) 时 surface=true）；或 {"action":"calculate","expression":"1+1"}（积分 integrate(expr,x)、defint(expr,a,b,x)、求导 diff(expr,x)、复数 i）；或 {"action":"shapes","shapes":[{"type":"rectangle","x":0,"y":0,"width":140,"height":80},{"type":"text","x":5,"y":15,"text":"标题"}]}（type 仅 rectangle,ellipse,diamond,line,arrow,text，所有图形必须提供 x,y,width,height，text 提供 text，坐标范围 0..1200）；或 {"action":"text","text":"回答"}。生成图像/图形用可编辑的线条与形状组合。不要生成代码或外链，不编造白板内容。',
          },
          visualMessage(`${text}\n白板文字：${context.text}`, context.image),
        ]),
      );
      if (!response || typeof response !== "object") {
        throw new Error("AI 指令格式无效，请重试");
      }
      const action = response as {
        action?: string;
        expression?: string;
        surface?: boolean;
        shapes?: unknown;
        text?: string;
      };
      if (action.action === "plot" && typeof action.expression === "string") {
        const next = {
          ...plot,
          expression: plotExpression(action.expression),
          surface: !!action.surface,
        };
        createPlot(next);
        setPanel("plot");
      } else if (
        action.action === "calculate" &&
        typeof action.expression === "string"
      ) {
        await solveMath(action.expression);
      } else if (action.action === "shapes") {
        const origin = insertionPoint(api);
        insertElements(
          api,
          validateShapes(action.shapes).map((shape) => ({
            ...shape,
            x: (shape.x || 0) + origin.x,
            y: (shape.y || 0) + origin.y,
          })),
        );
        setStatus("图形已写入白板，可编辑、撤销或擦除");
      } else if (action.action === "text" && typeof action.text === "string") {
        setOutput(action.text);
        setPanel("ai");
      } else {
        throw new Error("AI 返回了无法执行的操作，请重新描述");
      }
    },
    [api, plot, wholeBoard, summarize, solveMath, createPlot],
  );

  useEffect(() => {
    if (!autoMath) {
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    let previous = "";
    let processed = "";
    const unsubscribe = api.onChange((elements, state) => {
      if (
        state.editingTextElement ||
        state.cursorButton === "down" ||
        state.isResizing ||
        actionBusy.current
      ) {
        return;
      }
      const source = elements.filter(
        (el) =>
          !el.isDeleted &&
          !el.customData?.fcGenerated &&
          (el.type === "freedraw" || el.type === "text"),
      );
      const signature = source.map((el) => `${el.id}:${el.version}`).join(",");
      if (signature === previous) {
        return;
      }
      previous = signature;
      clearTimeout(timer);
      const last = source[source.length - 1];
      if (!last || (last.type === "text" && !/[=＝]\s*$/.test(last.text))) {
        return;
      }
      timer = setTimeout(() => {
        if (signature === processed || actionBusy.current) {
          return;
        }
        processed = signature;
        void run(async () => {
          await solveMath(last.type === "text" ? last.text : undefined, true);
          previous = api
            .getSceneElements()
            .filter(
              (el) =>
                !el.customData?.fcGenerated &&
                (el.type === "text" || el.type === "freedraw"),
            )
            .map((el) => `${el.id}:${el.version}`)
            .join(",");
        });
      }, 1800);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [api, autoMath, run, solveMath]);

  const toggleVoice = async () => {
    if (listening) {
      stopSpeech.current?.();
      stopSpeech.current = null;
      if (voiceRecorder.current?.state === "recording") {
        voiceRecorder.current.stop();
      }
      setListening(false);
      return;
    }
    if (recording) {
      throw new Error("录制中请使用文字指令，避免与录音争用麦克风");
    }
    if (currentSettings().speech === "custom") {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const recordingVoice = new MediaRecorder(stream);
      recordingVoice.ondataavailable = ({ data }) => {
        if (data.size) {
          chunks.push(data);
        }
      };
      recordingVoice.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        setListening(false);
        void run(async () => {
          const lines = await transcribe(
            new Blob(chunks, { type: recordingVoice.mimeType }),
          );
          await execute(lines.map((line) => line.text).join(""));
        });
      };
      recordingVoice.onerror = () => {
        stream.getTracks().forEach((track) => track.stop());
        setListening(false);
        setError("语音录入失败，请重试");
      };
      voiceRecorder.current = recordingVoice;
      recordingVoice.start();
      setListening(true);
      setStatus("正在听，请说出指令后再次点击语音按钮");
    } else {
      setListening(true);
      setStatus("正在听，请说出指令…");
      try {
        stopSpeech.current = await startSystemSpeech(
          (text) => {
            setListening(false);
            stopSpeech.current?.();
            stopSpeech.current = null;
            void run(() => execute(text));
          },
          (message) => {
            setListening(false);
            stopSpeech.current?.();
            stopSpeech.current = null;
            setError(message);
          },
        );
      } catch (failure) {
        setListening(false);
        throw failure;
      }
    }
  };

  const summaryFor = (item: Recording) =>
    chat([
      {
        role: "system",
        content:
          "你是方成教育课堂记录助手。仅根据提供的有时间戳文稿，用中文总结主题、核心知识、结论、行动事项及待解决问题。保留重要时间点，不编造。",
      },
      {
        role: "user",
        content: item.transcript
          .map((line) => `[${timestamp(line.time)}] ${line.text}`)
          .join("\n"),
      },
    ]);

  const startRecording = async () => {
    if (listening) {
      throw new Error("请先结束语音指令再开始录制");
    }
    transcript.current = [];
    setElapsed(0);
    const instance = new BoardRecorder();
    recorder.current = instance;
    await instance.start(mode, () => setRecording(false));
    recordStarted.current = Date.now();
    setRecording(true);
    setStatus("录制中，可关闭浮层继续书写；屏幕模式录制当前白板画面");
    if (currentSettings().speech === "system") {
      try {
        stopSpeech.current = await startSystemSpeech(
          (text) =>
            transcript.current.push({
              time: (Date.now() - recordStarted.current) / 1000,
              text,
            }),
          (message) =>
            setError(
              `录制继续，实时文稿不可用：${message}。可在录制后使用自定义接口转写。`,
            ),
          true,
        );
      } catch (failure) {
        setError(
          `录制继续，实时文稿不可用：${errorMessage(
            failure,
          )}。可在录制后转写。`,
        );
      }
    }
  };

  const stopRecording = async () => {
    stopSpeech.current?.();
    stopSpeech.current = null;
    const result = await recorder.current!.stop();
    setRecording(false);
    let item: Recording = {
      ...result,
      id: crypto.randomUUID(),
      created: Date.now(),
      mode,
      transcript: [...transcript.current],
      summary: "",
    };
    await persistRecords([item, ...recordsRef.current]);
    setActiveId(item.id);
    setPanel("record");
    setStatus("录制已保存到本机");
    if (currentSettings().speech === "custom") {
      try {
        item = { ...item, transcript: await transcribe(item.blob) };
        await persistRecords(
          recordsRef.current.map((value) =>
            value.id === item.id ? item : value,
          ),
        );
      } catch (failure) {
        setError(`录制已保存；${errorMessage(failure)}`);
      }
    }
    if (currentSettings().autoSummary && item.transcript.length) {
      try {
        const summary = await summaryFor(item);
        await persistRecords(
          recordsRef.current.map((value) =>
            value.id === item.id ? { ...value, summary } : value,
          ),
        );
      } catch (failure) {
        setError(`录制与文稿已保存；${errorMessage(failure)}`);
      }
    }
  };

  return (
    <div className="fc-classroom">
      <nav className="fc-dock" aria-label="教学与会议工具">
        <a
          href={BRAND.website}
          target="_blank"
          rel="noopener noreferrer"
          className="fc-brand"
        >
          <b>Fc</b>
          <span>方成教育</span>
        </a>
        {(Object.keys(titles) as Panel[]).map((value) => (
          <button
            key={value}
            aria-expanded={panel === value}
            aria-controls="fc-panel"
            onClick={() => open(value)}
          >
            {value === "record" && recording
              ? `● ${timestamp(elapsed)}`
              : titles[value]}
          </button>
        ))}
        <button
          aria-pressed={listening}
          disabled={busy || recording}
          onClick={() => {
            void toggleVoice().catch((failure) =>
              setError(errorMessage(failure)),
            );
          }}
        >
          {listening ? "■ 结束语音" : "语音指令"}
        </button>
        <button
          disabled={busy}
          onClick={() => {
            void run(() => summarize());
          }}
        >
          总结白板
        </button>
        {recording && (
          <button
            className="fc-stop"
            disabled={busy}
            onClick={() => {
              void run(stopRecording);
            }}
          >
            停止录制
          </button>
        )}
      </nav>
      {(error || status || busy) && (
        <div
          className={`fc-notice ${error ? "fc-error" : ""}`}
          role={error ? "alert" : "status"}
        >
          <span>{error || (busy ? "正在处理…" : status)}</span>
          <button
            aria-label="关闭提示"
            onClick={() => {
              setError("");
              setStatus("");
            }}
          >
            ×
          </button>
        </div>
      )}
      {panel && (
        <section
          id="fc-panel"
          ref={panelRef}
          className="fc-panel"
          role="dialog"
          aria-modal="false"
          aria-label={titles[panel]}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              close();
            }
          }}
        >
          <header>
            <div>
              <small>Fcdraw · 方成教育</small>
              <h2>{titles[panel]}</h2>
            </div>
            <button onClick={close} aria-label="关闭工具浮层">
              ×
            </button>
          </header>
          <div className="fc-panel-body">
            {panel === "settings" && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  try {
                    validateEndpoint(settings.endpoint);
                    if (settings.speechEndpoint) {
                      validateEndpoint(settings.speechEndpoint);
                    }
                    saveSettings(settings, remember);
                    setStatus("设置已保存");
                    setError("");
                  } catch (failure) {
                    setError(errorMessage(failure));
                  }
                }}
              >
                <label>
                  AI 接口地址
                  <input
                    type="url"
                    required
                    value={settings.endpoint}
                    onChange={(event) =>
                      setSettings({ ...settings, endpoint: event.target.value })
                    }
                  />
                </label>
                <label>
                  模型 ID / 火山方舟接入点 ID
                  <input
                    required
                    value={settings.model}
                    onChange={(event) =>
                      setSettings({ ...settings, model: event.target.value })
                    }
                    placeholder="填写支持视觉的模型 ID"
                  />
                </label>
                <label>
                  API 密钥
                  <input
                    type="password"
                    autoComplete="off"
                    value={settings.apiKey}
                    onChange={(event) =>
                      setSettings({ ...settings, apiKey: event.target.value })
                    }
                  />
                </label>
                <label>
                  语音服务
                  <select
                    value={settings.speech}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        speech: event.target.value as "system" | "custom",
                      })
                    }
                  >
                    <option value="system">安卓 / 浏览器系统语音识别</option>
                    <option value="custom">自定义语音转写接口</option>
                  </select>
                </label>
                {settings.speech === "custom" && (
                  <>
                    <label>
                      音频转写接口
                      <input
                        type="url"
                        required
                        value={settings.speechEndpoint}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            speechEndpoint: event.target.value,
                          })
                        }
                        placeholder="https://…/v1/audio/transcriptions"
                      />
                    </label>
                    <label>
                      转写模型
                      <input
                        value={settings.speechModel}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            speechModel: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      语音 API 密钥
                      <input
                        type="password"
                        autoComplete="off"
                        value={settings.speechKey}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            speechKey: event.target.value,
                          })
                        }
                      />
                    </label>
                    <p>
                      接口需支持 multipart 音频上传与 text /
                      segments（start、text）响应。浏览器版需接口允许跨域访问。
                    </p>
                  </>
                )}
                <label className="fc-check">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                  />
                  在本机记住密钥（共享教学设备建议关闭）
                </label>
                <label className="fc-check">
                  <input
                    type="checkbox"
                    checked={settings.autoSummary}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        autoSummary: event.target.checked,
                      })
                    }
                  />
                  录制文稿完成后自动生成 AI 总结
                </label>
                <p>
                  AI
                  截图、语音或录制转写会发送至你配置的服务。系统语音是否联网取决于设备语音服务。
                </p>
                <button className="fc-primary" type="submit">
                  保存设置
                </button>
              </form>
            )}
            {panel === "ai" && (
              <>
                <label className="fc-check">
                  <input
                    type="checkbox"
                    checked={wholeBoard}
                    onChange={(event) => setWholeBoard(event.target.checked)}
                  />
                  分析整个白板（关闭时优先使用框选区域）
                </label>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(() => execute(prompt));
                  }}
                >
                  <label>
                    对助教说
                    <textarea
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      placeholder="帮我画个立方体 / 画 y=x+1 / 总结这一板"
                      required
                    />
                  </label>
                  <button
                    disabled={busy || !prompt.trim()}
                    className="fc-primary"
                  >
                    执行指令
                  </button>
                </form>
                <div className="fc-actions">
                  <button
                    disabled={busy}
                    onClick={() => {
                      insertCube(api);
                      setStatus("立方体已插入白板");
                    }}
                  >
                    插入立方体
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      void run(() => summarize());
                    }}
                  >
                    总结选区 / 白板
                  </button>
                  <button
                    onClick={() =>
                      api.updateScene({
                        appState: {
                          openDialog: { name: "ttd", tab: "text-to-diagram" },
                        },
                      })
                    }
                  >
                    AI 生成图表
                  </button>
                </div>
                {output && (
                  <>
                    <div className="fc-output">{output}</div>
                    <button
                      onClick={() => {
                        insertText(api, output);
                        setStatus("内容已写入白板");
                      }}
                    >
                      将内容写入白板
                    </button>
                  </>
                )}
              </>
            )}
            {panel === "math" && (
              <>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(() => solveMath(mathInput));
                  }}
                >
                  <label>
                    数学表达式
                    <textarea
                      value={mathInput}
                      onChange={(event) => setMathInput(event.target.value)}
                      placeholder="1+1= / sqrt(-1) / diff(x^3,x) / integrate(sin(x),x)"
                    />
                  </label>
                  <button className="fc-primary" disabled={busy}>
                    计算并写入白板
                  </button>
                </form>
                <button
                  disabled={busy}
                  onClick={() => {
                    void run(() => solveMath());
                  }}
                >
                  识别框选 / 手写算式并计算
                </button>
                <label className="fc-check">
                  <input
                    type="checkbox"
                    checked={autoMath}
                    onChange={(event) => setAutoMath(event.target.checked)}
                  />
                  停笔后自动补全算式结果
                </label>
                <p>
                  自动模式识别以等号结束的文字或手写算式。手写需要视觉模型；复杂计算示例：defint(x^2,0,1,x)、limit(sin(x)/x,x,0)、solve(x^2-1,x)。
                </p>
                {output && <div className="fc-output">{output}</div>}
              </>
            )}
            {panel === "plot" && (
              <>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(async () => createPlot(plot));
                  }}
                >
                  <label>
                    函数表达式
                    <input
                      value={plot.expression}
                      onChange={(event) =>
                        setPlot({ ...plot, expression: event.target.value })
                      }
                      placeholder="x+1 或 sin(x*y)"
                    />
                  </label>
                  <label className="fc-check">
                    <input
                      type="checkbox"
                      checked={plot.surface}
                      onChange={(event) =>
                        setPlot({ ...plot, surface: event.target.checked })
                      }
                    />
                    三维曲面 z=f(x,y)
                  </label>
                  <label>
                    坐标范围 ±
                    <input
                      type="number"
                      min="0.1"
                      max="1000"
                      step="0.1"
                      value={plot.range}
                      onChange={(event) =>
                        setPlot({ ...plot, range: Number(event.target.value) })
                      }
                    />
                  </label>
                  <button className="fc-primary" disabled={busy}>
                    插入函数图像
                  </button>
                </form>
                <button
                  disabled={busy}
                  onClick={() => {
                    void run(async () => {
                      const expression = await recognize("plot");
                      const next = {
                        ...plot,
                        expression: plotExpression(expression),
                        surface: /^z\s*=/.test(expression),
                      };
                      createPlot(next);
                    });
                  }}
                >
                  识别框选函数并绘图
                </button>
                <p>
                  x、y 控制采样区间的平移，z 控制输出偏移；a、b、c
                  可用于表达式。拖动后更新当前图像。
                </p>
                {(["x", "y", "z", "a", "b", "c"] as const).map((key) => (
                  <label className="fc-slider" key={key}>
                    {key} = {plot[key].toFixed(1)}
                    <input
                      aria-label={`调节 ${key}`}
                      type="range"
                      min="-10"
                      max="10"
                      step="0.1"
                      value={plot[key]}
                      onChange={(event) => {
                        const next = {
                          ...plot,
                          [key]: Number(event.target.value),
                        };
                        setPlot(next);
                        if (plotRef.current) {
                          try {
                            createPlot(next, true);
                          } catch (failure) {
                            setError(errorMessage(failure));
                          }
                        }
                      }}
                    />
                  </label>
                ))}
              </>
            )}
            {panel === "record" && (
              <>
                <label>
                  录制模式
                  <select
                    disabled={recording}
                    value={mode}
                    onChange={(event) =>
                      setMode(event.target.value as RecordingMode)
                    }
                  >
                    <option value="audio">仅麦克风</option>
                    <option value="camera">麦克风 + 摄像头</option>
                    <option value="screen">麦克风 + 屏幕（白板）</option>
                    <option value="combined">
                      麦克风 + 摄像头 + 屏幕（白板）
                    </option>
                  </select>
                </label>
                <p>
                  录制时可关闭此浮层继续使用白板。屏幕模式采集白板画面，组合模式将摄像头叠放在右下角。
                </p>
                <button
                  className={recording ? "fc-stop" : "fc-primary"}
                  disabled={busy}
                  onClick={() => {
                    void run(recording ? stopRecording : startRecording);
                  }}
                >
                  {recording ? `停止并保存 ${timestamp(elapsed)}` : "开始录制"}
                </button>
                <label>
                  本机录制资料
                  <select
                    value={activeId}
                    onChange={(event) => setActiveId(event.target.value)}
                  >
                    <option value="">选择录制</option>
                    {records.map((item) => (
                      <option value={item.id} key={item.id}>
                        {new Date(item.created).toLocaleString()} ·{" "}
                        {timestamp(item.duration)}
                      </option>
                    ))}
                  </select>
                </label>
                {active ? (
                  <>
                    <RecordingPlayer recording={active} />
                    <div className="fc-actions">
                      <button
                        disabled={busy}
                        onClick={() => {
                          void run(async () => {
                            const lines = await transcribe(active.blob);
                            await persistRecords(
                              recordsRef.current.map((item) =>
                                item.id === active.id
                                  ? { ...item, transcript: lines, summary: "" }
                                  : item,
                              ),
                            );
                          });
                        }}
                      >
                        转写 / 重新转写
                      </button>
                      <button
                        disabled={busy || !active.transcript.length}
                        onClick={() => {
                          void run(async () => {
                            const summary = await summaryFor(active);
                            await persistRecords(
                              recordsRef.current.map((item) =>
                                item.id === active.id
                                  ? { ...item, summary }
                                  : item,
                              ),
                            );
                          });
                        }}
                      >
                        生成 AI 总结
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          void persistRecords(
                            recordsRef.current.filter(
                              (item) => item.id !== active.id,
                            ),
                          );
                          setActiveId("");
                        }}
                      >
                        删除此录制
                      </button>
                    </div>
                    <label>
                      补充文稿（每行一段，可用 00:30 文字）
                      <textarea
                        value={manualTranscript}
                        onChange={(event) =>
                          setManualTranscript(event.target.value)
                        }
                      />
                    </label>
                    <button
                      disabled={!manualTranscript.trim()}
                      onClick={() => {
                        const lines = manualTranscript
                          .split("\n")
                          .filter((line) => line.trim())
                          .map((line) => {
                            const match = line.match(/^(\d+):(\d{2})\s+(.+)$/);
                            return {
                              time: match
                                ? Number(match[1]) * 60 + Number(match[2])
                                : 0,
                              text: match ? match[3] : line,
                            };
                          });
                        void persistRecords(
                          recordsRef.current.map((item) =>
                            item.id === active.id
                              ? { ...item, transcript: lines, summary: "" }
                              : item,
                          ),
                        );
                        setManualTranscript("");
                      }}
                    >
                      保存补充文稿
                    </button>
                  </>
                ) : (
                  <p>尚未选择录制资料。录制会保存在当前设备，可回放和下载。</p>
                )}
              </>
            )}
            {panel === "files" && (
              <>
                <input
                  hidden
                  ref={uploadInput}
                  type="file"
                  accept=".pptx,.pdf,.png,.jpg,.jpeg,.webp,.gif"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      setPreview(file);
                    }
                    event.target.value = "";
                  }}
                />
                <button
                  className="fc-primary"
                  onClick={() => uploadInput.current?.click()}
                >
                  打开本机课件 / 文件
                </button>
                <h3>局域网快传</h3>
                <p>
                  安卓大屏与手机连接同一局域网，开启后使用手机浏览器打开接收地址。关闭后地址立即失效。
                </p>
                <button
                  disabled={busy || !Capacitor.isNativePlatform()}
                  onClick={() => {
                    void run(async () => {
                      if (urls.length) {
                        await NativeClassroom.stopReceiver();
                        setUrls([]);
                      } else {
                        const result = await NativeClassroom.startReceiver();
                        setUrls(result.urls);
                      }
                    });
                  }}
                >
                  {urls.length ? "关闭局域网接收" : "开启局域网接收"}
                </button>
                {!Capacitor.isNativePlatform() && (
                  <p>
                    局域网接收服务在安卓安装版提供；浏览器版可打开本机文件。
                  </p>
                )}
                {urls.length > 0 && (
                  <div className="fc-qr">
                    <QRCode value={urls[0]} />
                  </div>
                )}
                {urls.map((url) => (
                  <div className="fc-transfer-url" key={url}>
                    <code>{url}</code>
                    <button
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(url)
                          .then(() => setStatus("接收地址已复制"))
                          .catch(() =>
                            setError("复制失败，请手动抄写接收地址"),
                          );
                      }}
                    >
                      复制
                    </button>
                  </div>
                ))}
                {uploads.length ? (
                  uploads.map((file) => (
                    <div className="fc-file" key={file.id}>
                      <span>
                        {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                      <button
                        disabled={busy}
                        onClick={() => {
                          void run(async () => {
                            const response = await fetch(
                              Capacitor.convertFileSrc(file.path),
                            );
                            if (!response.ok) {
                              throw new Error("无法读取文件");
                            }
                            const blob = await response.blob();
                            setPreview(
                              new File([blob], file.name, { type: blob.type }),
                            );
                          });
                        }}
                      >
                        打开预览
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          void run(async () => {
                            await NativeClassroom.deleteUpload({ id: file.id });
                            const result = await NativeClassroom.listUploads();
                            setUploads(result.files);
                          });
                        }}
                      >
                        删除
                      </button>
                    </div>
                  ))
                ) : (
                  <p>
                    还没有收到文件。支持 PPTX 翻页播放、图片预览与
                    PDF（取决于设备 PDF 支持）。
                  </p>
                )}
              </>
            )}
          </div>
        </section>
      )}
      {preview && (
        <FilePreview
          key={`${preview.name}-${preview.lastModified}`}
          file={preview}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
};
