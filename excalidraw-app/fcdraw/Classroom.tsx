import { Capacitor } from "@capacitor/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { getCommonBounds } from "@excalidraw/element";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { QRCode } from "../share/QRCode";

import {
  boardContext,
  chat,
  parseJSON,
  selectedBoardElements,
  visualMessage,
} from "./ai";
import { drawPlot, insertionPoint, insertText, selectedPlot } from "./board";
import { FilePreview } from "./FilePreview";
import { BoardSwitcher } from "./BoardSwitcher";
import { LanSession } from "./LanSession";
import { classroomCommands, directCommand } from "./commands";
import { DOCUMENT_ACCEPT } from "./documents";
import { Teacher, LearningSettings } from "./Teacher";
import { TeachingTools } from "./TeachingTools";
import { registerCanvasCommands } from "./canvasCommands";
import {
  localMathIntent,
  selectionMathIntent,
  selectionRequest,
} from "./intent";
import { calculate, defaultPlot, plotExpression } from "./math";
import { Classroom as NativeClassroom } from "./native";
import { createNarrator } from "./narration";
import { startLocalSpeech } from "./localSpeech";
import {
  BoardRecorder,
  loadRecordings,
  saveRecordings,
  timestamp,
} from "./recording";
import { currentSettings, saveSettings, validateEndpoint } from "./settings";
import { observeMathSelection, selectionSignature } from "./selection";
import { placePanel, useAnchoredPanel } from "./floating";
import { startSystemSpeech, transcribe } from "./speech";

import "./classroom.scss";

import type { Plot } from "./math";
import type { Upload } from "./native";
import type { Recording, RecordingMode } from "./recording";
import type { TranscriptLine } from "./speech";
import type { LocalSpeechHandle } from "./localSpeech";
import type { Settings } from "./settings";
import type { InkStroke } from "./documents";

type Panel = "ai" | "plot" | "record" | "files" | "settings";
const titles: Record<Panel, string> = {
  ai: "AI 助教",
  plot: "函数参数",
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
        download={`Fcboard-${recording.id}.${
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
  const [autoMath, setAutoMath] = useState(() => currentSettings().autoMath);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const handledSelections = useRef(new Set<string>());
  const [plotPlacement, setPlotPlacement] = useState({ left: 16, top: 16 });
  const [capture, setCapture] = useState<string>();
  const capturedContext = useRef<Awaited<
    ReturnType<typeof boardContext>
  > | null>(null);
  const [plot, setPlot] = useState<Plot>(defaultPlot);
  const plotRef = useRef<{
    ids: string[];
    position: { x: number; y: number };
  } | null>(null);
  const [listening, setListening] = useState(false);
  const stopSpeech = useRef<(() => void) | null>(null);
  const localSpeech = useRef<LocalSpeechHandle | null>(null);
  const finishVoice = useRef<(() => Promise<void>) | null>(null);
  const voiceGeneration = useRef(0);
  const recordingVoiceCommand = useRef(false);
  const narrator = useRef<ReturnType<typeof createNarrator> | null>(null);
  if (!narrator.current) {
    narrator.current = createNarrator();
  }
  const voiceRecorder = useRef<MediaRecorder | null>(null);
  const [mode, setMode] = useState<RecordingMode>("screen");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<BoardRecorder | null>(null);
  const recordMode = useRef<RecordingMode>("audio");
  const stoppingRecording = useRef(false);
  const transcript = useRef<TranscriptLine[]>([]);
  const recordStarted = useRef(0);
  const [records, setRecords] = useState<Recording[]>([]);
  const recordsRef = useRef<Recording[]>([]);
  const [activeId, setActiveId] = useState("");
  const [manualTranscript, setManualTranscript] = useState("");
  const [urls, setUrls] = useState<string[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [preview, setPreview] = useState<File | null>(null);
  const previewRef = useRef<File | null>(null);
  const recentFiles = useRef(new Map<string, File>());
  previewRef.current = preview;
  const receivedIds = useRef(new Set<string>());
  const incoming = useRef<Upload[]>([]);
  const openingUpload = useRef(false);
  const previewReady = useRef<{
    resolve: () => void;
    reject: (error: Error) => void;
  } | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const actionBusy = useRef(false);
  const assistantGeneration = useRef(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const panelStyle = useAnchoredPanel(
    panelRef,
    "[data-testid='main-menu-trigger'], .fc-presentation-toolbar",
    !!panel && panel !== "plot",
  );
  const active = records.find((item) => item.id === activeId);
  useEffect(() => registerCanvasCommands(api), [api]);
  const showPreview = useCallback((file: File) => {
    recentFiles.current.set(file.name, file);
    if (recentFiles.current.size > 5) {
      recentFiles.current.delete(recentFiles.current.keys().next().value!);
    }
    previewReady.current?.reject(new DOMException("已切换课件", "AbortError"));
    classroomCommands.invalidate();
    previewRef.current = file;
    setPreview(file);
    setPanel(null);
    return new Promise<void>((resolve, reject) => {
      previewReady.current = { resolve, reject };
    });
  }, []);
  const openUpload = useCallback(
    async (file: Upload) => {
      openingUpload.current = true;
      try {
        const response = await fetch(Capacitor.convertFileSrc(file.path));
        if (!response.ok) {
          throw new Error("无法读取接收的课件");
        }
        const blob = await response.blob();
        const next = new File([blob], file.name, { type: blob.type });
        await showPreview(next);
      } finally {
        openingUpload.current = false;
      }
    },
    [showPreview],
  );
  const invalidateVoice = useCallback(() => {
    voiceGeneration.current++;
  }, []);

  useEffect(() => {
    let previousGraph = "";
    const refresh = () => {
      const state = api.getAppState();
      const graph = selectedPlot(api);
      if (graph) {
        const graphId = graph.ids.join(",");
        if (graphId !== previousGraph) {
          setPanel((value) => (!value || value === "plot" ? "plot" : value));
        }
        previousGraph = graphId;
        plotRef.current = graph;
        const documentRect = classroomCommands.read("document")
          ? document
              .querySelector(".fc-document-stage")
              ?.getBoundingClientRect()
          : undefined;
        const root = panelRef.current?.offsetParent?.getBoundingClientRect();
        const scale = documentRect
          ? documentRect.width / 1000
          : state.zoom.value;
        const center = {
          x: documentRect
            ? documentRect.left - (root?.left || 0) + graph.position.x * scale
            : (graph.position.x + state.scrollX) * scale,
          y: documentRect
            ? documentRect.top - (root?.top || 0) + graph.position.y * scale
            : (graph.position.y + state.scrollY) * scale,
        };
        const { left, top } = placePanel(
          {
            left: center.x - 245 * scale,
            right: center.x + 245 * scale,
            top: center.y - 245 * scale,
            bottom: center.y + 245 * scale,
          },
          { width: state.width, height: state.height - 92 },
        );
        setPlotPlacement((value) =>
          value.left === left && value.top === top ? value : { left, top },
        );
        setPlot((value) =>
          JSON.stringify(value) === JSON.stringify(graph.plot)
            ? value
            : graph.plot,
        );
      } else {
        previousGraph = "";
        setPanel((value) => (value === "plot" ? null : value));
      }
    };
    refresh();
    const stop = api.onChange(refresh);
    const pointerUp = api.onPointerUp((tool, _, event) => {
      if (
        !["selection", "lasso"].includes(tool.type) ||
        classroomCommands.read("document")
      ) {
        return;
      }
      const graph = selectedPlot(api);
      if (!graph) {
        return;
      }
      const state = api.getAppState();
      const x =
        (event.clientX - state.offsetLeft) / state.zoom.value - state.scrollX;
      const y =
        (event.clientY - state.offsetTop) / state.zoom.value - state.scrollY;
      if (
        Math.abs(x - graph.position.x) <= 245 &&
        Math.abs(y - graph.position.y) <= 245
      ) {
        setPanel("plot");
      }
    });
    const documentChanged = classroomCommands.watch("document", refresh);
    return () => {
      stop();
      pointerUp();
      documentChanged();
    };
  }, [api]);

  useEffect(() => {
    if (!panel) {
      return;
    }
    const dismiss = (event: PointerEvent) => {
      if (
        !panelRef.current?.contains(event.target as Node) &&
        !(event.target as Element).closest?.("[aria-controls='fc-panel']")
      ) {
        assistantGeneration.current++;
        setPanel(null);
      }
    };
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [panel]);

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
        .then(({ files }) => {
          setUploads(files);
          files.forEach((file) => receivedIds.current.add(file.id));
        })
        .catch((failure) => setError(errorMessage(failure)));
    }
    return () => {
      invalidateVoice();
      narrator.current?.stop();
      stopSpeech.current?.();
      void localSpeech.current?.cancel().catch(() => {});
      recorder.current?.dispose();
      if (voiceRecorder.current?.state === "recording") {
        voiceRecorder.current.stop();
      }
      if (Capacitor.isNativePlatform()) {
        void NativeClassroom.stopReceiver();
      }
    };
  }, [invalidateVoice]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    let disposed = false;
    const listener = NativeClassroom.addListener("fileReceived", (file) => {
      if (disposed || receivedIds.current.has(file.id)) {
        return;
      }
      receivedIds.current.add(file.id);
      setUploads((files) => [
        file,
        ...files.filter((item) => item.id !== file.id),
      ]);
      if (previewRef.current || openingUpload.current) {
        incoming.current.push(file);
        setStatus(`${file.name} 已接收，关闭当前课件后自动上屏`);
      } else {
        void openUpload(file).catch((failure) =>
          setError(errorMessage(failure)),
        );
      }
    });
    return () => {
      disposed = true;
      void listener.then((handle) => handle.remove());
    };
  }, [openUpload]);

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
        .then(({ files }) => {
          setUploads(files);
          const fresh = files.filter(
            (file) => !receivedIds.current.has(file.id),
          );
          fresh.forEach((file) => receivedIds.current.add(file.id));
          if (fresh.length) {
            incoming.current.push(...fresh.reverse());
            if (!previewRef.current && !openingUpload.current) {
              const first = incoming.current.shift();
              if (first) {
                void openUpload(first).catch((failure) =>
                  setError(errorMessage(failure)),
                );
              }
            }
          }
        })
        .catch((failure) => setError(errorMessage(failure)));
    };
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [urls, openUpload]);

  useEffect(() => {
    if (panel) {
      panelRef.current?.querySelector<HTMLElement>("button")?.focus();
    }
  }, [panel]);

  const close = (cancel = true) => {
    if (cancel) {
      assistantGeneration.current++;
      setStatus("");
    }
    narrator.current?.stop();
    capturedContext.current = null;
    setCapture(undefined);
    setWholeBoard(false);
    setPanel(null);
    returnFocus.current?.focus();
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
      const all = api.getSceneElements();
      const selected = selectedBoardElements(api);
      const source = selected.length
        ? selected
        : all.filter((el) => !el.customData?.fcGenerated);
      if (!source.length) {
        throw new Error("请先书写内容，或框选需要识别的区域");
      }
      const text = source
        .filter((el) => el.type === "text")
        .map((el) => (el.type === "text" ? el.text : ""))
        .join("\n")
        .trim();
      if (
        text &&
        !source.some((el) => el.type === "freedraw" || el.type === "image")
      ) {
        return text;
      }
      const context = await boardContext(api);
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
    [api],
  );

  const solveMath = useCallback(
    async (input?: string, automatic = false) => {
      const revision = classroomCommands.revision;
      const generation = assistantGeneration.current;
      if (classroomCommands.has("document.snapshot")) {
        if (automatic) {
          return;
        }
        const snapshot = (await classroomCommands.execute({
          name: "document.snapshot",
        })) as { text: string; image: string };
        const expression =
          input ||
          (
            await chat([
              visualMessage(
                `仅识别待计算算式，输出 mathjs/nerdamer 表达式；无算式返回 NONE。课件文字：${snapshot.text}`,
                snapshot.image,
              ),
            ])
          ).trim();
        if (
          revision !== classroomCommands.revision ||
          generation !== assistantGeneration.current
        ) {
          return;
        }
        if (expression === "NONE") {
          throw new Error("未发现待计算算式");
        }
        const answer = calculate(expression);
        await classroomCommands.execute({
          name: "canvas.text",
          args: { text: `${expression} = ${answer}` },
        });
        return;
      }
      const elements = api.getSceneElements();
      const selected = automatic ? [] : selectedBoardElements(api);
      const source = selected.length
        ? selected
        : elements.filter((el) => !el.customData?.fcGenerated);
      const expression = input || (await recognize("math"));
      if (
        revision !== classroomCommands.revision ||
        generation !== assistantGeneration.current
      ) {
        return;
      }
      if (
        automatic &&
        (Object.values(api.getAppState().selectedElementIds).some(Boolean) ||
          selectionSignature(source) !==
            selectionSignature(
              api
                .getSceneElements()
                .filter((el) => !el.customData?.fcGenerated),
            ))
      ) {
        return;
      }
      if (expression === "NONE") {
        if (!automatic) {
          throw new Error("未发现待计算算式");
        }
        return;
      }
      const answer = calculate(expression);
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
      const lastSource = source[source.length - 1];
      insertText(
        api,
        answer,
        position,
        lastSource
          ? {
              fcAnswerSource: lastSource.id,
              fcAnswerVersion: lastSource.version,
            }
          : undefined,
        lastSource ? [lastSource] : undefined,
      );
      setOutput(`${expression} = ${answer}`);
      setStatus("计算结果已写入白板，可撤销或擦除");
    },
    [api, recognize],
  );

  const createPlot = useCallback(
    (next: Plot, replace = false, sourceSignature?: string) => {
      const existing = plotRef.current;
      if (
        replace &&
        existing &&
        !classroomCommands.has("document.plot") &&
        !existing.ids.every((id) =>
          api.getSceneElements().some((el) => el.id === id),
        )
      ) {
        plotRef.current = null;
        throw new Error("图像已被移动到历史或擦除，请重新插入函数图像");
      }
      const origin = insertionPoint(api);
      const position =
        replace && existing
          ? existing.position
          : classroomCommands.has("document.plot")
          ? { x: 300, y: 260 }
          : { x: origin.x + 220, y: origin.y + 245 };
      const ids = drawPlot(
        api,
        next,
        position,
        replace ? existing?.ids : undefined,
        sourceSignature ||
          (replace && existing
            ? api.getSceneElements().find((el) => existing.ids.includes(el.id))
                ?.customData?.fcSelectionSource
            : undefined),
      );
      plotRef.current = { ids, position };
      if (!classroomCommands.has("document.plot")) {
        if (
          !replace &&
          !["selection", "lasso"].includes(api.getAppState().activeTool.type)
        ) {
          api.setActiveTool({ type: "selection" });
        }
        api.updateScene({
          appState: {
            selectedElementIds: Object.fromEntries(ids.map((id) => [id, true])),
          },
        });
      }
      setPlot(next);
      setStatus("函数图像已插入；调节参数可观察变化");
    },
    [api],
  );

  const summarize = useCallback(
    async (whole = false) => {
      const revision = classroomCommands.revision;
      const generation = assistantGeneration.current;
      const document = classroomCommands.has("document.snapshot")
        ? ((await classroomCommands.execute({ name: "document.snapshot" })) as {
            text: string;
            image: string;
          })
        : undefined;
      const context =
        whole && capturedContext.current
          ? capturedContext.current
          : await boardContext(api, whole);
      if (!document && !context.elements.length) {
        throw new Error("白板还没有内容");
      }
      const result = await chat([
        visualMessage(
          `你是方成教育助教。根据当前课件或白板内容总结本节知识、推导过程、结论与待解决问题。看不清的内容明确说明，不编造。\n识别到的文字：${
            document?.text || context.text
          }`,
          document?.image || context.image,
        ),
      ]);
      if (
        revision !== classroomCommands.revision ||
        generation !== assistantGeneration.current
      ) {
        return;
      }
      setOutput(result);
      await classroomCommands.execute({
        name: "canvas.text",
        args: { text: result },
      });
      setStatus("总结已写入白板，可编辑、撤销或擦除");
    },
    [api],
  );

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let previous = "";
    let disposed = false;
    const refresh = () => {
      const document = classroomCommands.read("document") as
        | { name: string; page: number; ink: InkStroke[]; selection: string[] }
        | undefined;
      const source =
        document?.ink.filter(
          (stroke) =>
            document.selection.includes(stroke.id) &&
            !stroke.lesson &&
            !stroke.widget &&
            !stroke.plot,
        ) || [];
      const signature = source.length
        ? JSON.stringify([document?.name, document?.page, source])
        : "";
      if (signature === previous) {
        return;
      }
      previous = signature;
      clearTimeout(timer);
      if (!signature) {
        return;
      }
      timer = setTimeout(() => {
        const revision = classroomCommands.revision;
        void (async () => {
          let intent = selectionMathIntent(
            source.map((stroke) => stroke.text || "").join(" "),
          );
          if (!intent) {
            if (!currentSettings().apiKey) {
              return;
            }
            const snapshot = (await classroomCommands.execute({
              name: "document.snapshot",
            })) as { image: string; text: string };
            intent = selectionMathIntent(
              (
                await chat([
                  visualMessage(
                    `识别圈选的板书（位置 ${JSON.stringify(
                      source.map((stroke) => stroke.points),
                    )}）。仅输出待求值算式或函数表达式；普通笔记、图形、已完成等式返回 NONE。课件文字：${
                      snapshot.text
                    }`,
                    snapshot.image,
                  ),
                ])
              ).trim(),
            );
          }
          if (
            disposed ||
            revision !== classroomCommands.revision ||
            signature !== previous ||
            !intent
          ) {
            return;
          }
          if (intent.action === "plot") {
            createPlot({
              ...defaultPlot,
              expression: intent.expression,
              surface: intent.surface,
            });
          } else {
            await classroomCommands.execute({
              name: "canvas.text",
              args: { text: calculate(intent.expression) },
            });
          }
        })().catch((failure) => {
          if (!disposed && signature === previous) {
            setError(errorMessage(failure));
          }
        });
      }, 450);
    };
    const stop = classroomCommands.watch("document", refresh);
    return () => {
      disposed = true;
      clearTimeout(timer);
      stop();
    };
  }, [createPlot]);

  const execute = useCallback(
    async (
      text: string,
      whole = false,
      selection?: {
        context: Awaited<ReturnType<typeof boardContext>>;
        signal: AbortSignal;
      },
    ) => {
      if (selection?.signal.aborted) {
        return;
      }
      const generation = ++assistantGeneration.current;
      setPrompt(text);
      const direct = directCommand(text);
      if (direct) {
        await classroomCommands.execute(direct);
        return;
      }
      if (
        /^(?:请|帮我|麻烦)?(?:讲解|解释|引导|教我|辅导|为什么|怎么理解|没听懂|不理解|换.*例子|演示.*动画)/.test(
          text,
        )
      ) {
        await classroomCommands.execute({
          name: "lesson.ask",
          args: { prompt: text, signal: selection?.signal },
        });
        return;
      }
      const revision = classroomCommands.revision;
      if (
        /^(?:请|帮我)?(?:画|插入|生成|创建)(?:一个|个|一|标准|线条|的|\s)*(?:立方体|正方体)[吧。！!\s]*$/.test(
          text,
        )
      ) {
        await classroomCommands.execute({
          name: "tools.insert",
          args: { kind: "cube" },
        });
        setStatus("标准线条立方体已插入，可编辑或擦除");
        return;
      }
      if (/^(?:请|帮我|麻烦)?(?:总结|小结|概括)/.test(text)) {
        await summarize(whole || /整|全部|这一板/.test(text));
        return;
      }
      const localIntent =
        /改|调|删|擦|移|设|关闭|暂停|放大|缩小|清空|保存|丢弃|切换/.test(text)
          ? null
          : localMathIntent(text);
      if (localIntent?.action === "plot") {
        createPlot({
          ...plot,
          expression: localIntent.expression,
          surface: localIntent.surface,
        });
        setPanel("plot");
        return;
      }
      if (localIntent?.action === "calculate") {
        await solveMath(localIntent.expression);
        return;
      }
      if (/^(?:帮我)?(?:计算|求值)(?:一下)?[，。!！\s]*$/.test(text)) {
        await solveMath();
        return;
      }
      const context =
        selection?.context ||
        (whole && capturedContext.current
          ? capturedContext.current
          : await boardContext(api, whole));
      const response = parseJSON(
        await chat(
          [
            {
              role: "system",
              content: `你是方成教育白板助教。将用户要求转成 JSON，不要 markdown。操作组件优先返回 {"action":"commands","commands":[{"name":"已注册命令","args":{}}]}，可组合最多20项。现有命令：\n${classroomCommands.describe()}\n只用已注册命令；不猜测对象或文件id，依据上下文。删除、丢弃、清空仅在用户明确要求时执行。要讲解或引导，使用 lesson.ask；问答也可结合课件、圈选与当前教学步骤。数学可返回 {"action":"plot","expression":"x+1","surface":false} 或 {"action":"calculate","expression":"1+1"}；图形可返回 {"action":"shapes","shapes":[{"type":"rectangle","x":0,"y":0,"width":140,"height":80}]}，type 仅 rectangle,ellipse,diamond,line,arrow,text；文本返回 {"action":"text","text":"回答"}。需要逐步动画使用 canvas.animate。不要任意代码、外链或假成功。`,
            },
            visualMessage(
              `${text}\n白板文字：${context.text}\n组件状态：${JSON.stringify(
                classroomCommands.snapshot(),
              )}`,
              context.image,
            ),
          ],
          selection?.signal,
        ),
      );
      if (
        selection?.signal.aborted ||
        revision !== classroomCommands.revision ||
        generation !== assistantGeneration.current
      ) {
        return;
      }
      if (!response || typeof response !== "object") {
        throw new Error("AI 指令格式无效，请重试");
      }
      const action = response as {
        action?: string;
        expression?: string;
        surface?: boolean;
        shapes?: unknown;
        text?: string;
        commands?: { name: string; args?: Record<string, unknown> }[];
      };
      if (action.action === "commands") {
        if (
          !Array.isArray(action.commands) ||
          action.commands.length > 20 ||
          !action.commands.every(
            (command) =>
              command &&
              typeof command.name === "string" &&
              (!command.args ||
                (typeof command.args === "object" &&
                  !Array.isArray(command.args))),
          )
        ) {
          throw new Error("AI 组件命令格式无效");
        }
        if (
          !action.commands.length ||
          !action.commands.every(
            (command) =>
              classroomCommands.has(command.name) &&
              command.name !== "ui.invoke",
          )
        ) {
          throw new Error("AI 请求了当前不可用的操作，请重新描述");
        }
        for (const command of action.commands) {
          if (generation !== assistantGeneration.current) {
            return;
          }
          await classroomCommands.execute(
            selection && ["lesson.ask", "lesson.teach"].includes(command.name)
              ? {
                  ...command,
                  args: { ...command.args, signal: selection.signal },
                }
              : command,
          );
        }
      } else if (
        action.action === "plot" &&
        typeof action.expression === "string"
      ) {
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
        await classroomCommands.execute({
          name: "canvas.shapes",
          args: { shapes: action.shapes },
        });
        setStatus("图形已写入白板，可编辑、撤销或擦除");
      } else if (action.action === "text" && typeof action.text === "string") {
        setOutput(action.text);
        await classroomCommands.execute({
          name: "canvas.text",
          args: { text: action.text },
        });
        setStatus("回答已写入白板，可编辑、撤销或擦除");
      } else {
        throw new Error("AI 返回了无法执行的操作，请重新描述");
      }
    },
    [api, plot, summarize, solveMath, createPlot],
  );

  useEffect(
    () =>
      observeMathSelection(
        api,
        async (source, signature, signal) => {
          const text = source
            .filter((el) => el.type === "text")
            .map((el) => (el.type === "text" ? el.text : ""))
            .join("\n")
            .trim();
          let intent = selectionMathIntent(text);
          const request = async (question: string) => {
            const context = await boardContext(api, false, source);
            if (!signal.aborted) {
              await execute(question, false, { context, signal });
            }
          };
          if (!intent && selectionRequest(text)) {
            await request(text);
            return;
          }
          if (
            source.some((el) => el.type === "freedraw" || el.type === "image")
          ) {
            const context = await boardContext(api, false, source);
            if (signal.aborted) {
              return;
            }
            const response = parseJSON(
              await chat(
                [
                  visualMessage(
                    '识别所选白板区域，仅返回 JSON。若是函数表达式（y=f(x)、f(x)=... 或 z=f(x,y)），返回 {"action":"plot","expression":"x+1","surface":false}；三维函数 surface=true。若是待计算算式，返回 {"action":"calculate","expression":"1+1"}。积分用 integrate(expr,x) 或 defint(expr,a,b,x)，求导 diff(expr,x)，极限 limit(expr,x,a)，方程 solve(expr,x)，复数用 i。只识别，不计算答案。若是明确的问题或操作请求（例如讲解牛顿定律、画图、总结、录制课件），返回 {"action":"request","text":"逐字识别的问题或指令"}。若仅是普通笔记、已给出答案或无法确定，返回 {"action":"none"}。不要猜测，不要输出解释。',
                    context.image,
                  ),
                ],
                signal,
              ),
            );
            if (response && typeof response === "object") {
              const value = response as {
                action?: string;
                expression?: string;
                surface?: boolean;
                text?: string;
              };
              if (
                value.action === "request" &&
                typeof value.text === "string" &&
                value.text.trim()
              ) {
                await request(value.text);
                return;
              }
              intent =
                value.action === "plot" && typeof value.expression === "string"
                  ? {
                      action: "plot",
                      expression: plotExpression(value.expression),
                      surface: !!value.surface,
                    }
                  : value.action === "calculate" &&
                    typeof value.expression === "string"
                  ? { action: "calculate", expression: value.expression }
                  : null;
            } else {
              throw new Error("选区识别返回格式无效，请重新圈选");
            }
          }
          if (!intent || signal.aborted) {
            return;
          }
          if (intent.action === "plot") {
            createPlot(
              {
                ...defaultPlot,
                expression: intent.expression,
                surface: intent.surface,
              },
              false,
              signature,
            );
          } else {
            const answer = calculate(intent.expression);
            const [, top, right, bottom] = getCommonBounds(source);
            const last = source[source.length - 1];
            insertText(
              api,
              answer,
              {
                x: right + 16,
                y: source.length === 1 ? top : Math.max(top, bottom - 32),
              },
              {
                fcSelectionSource: signature,
                fcAnswerSource: last.id,
                fcAnswerVersion: last.version,
              },
              source,
            );
            setStatus("计算结果已写入白板，可撤销或擦除");
          }
        },
        setSelectionBusy,
        (failure) => setError(errorMessage(failure)),
        handledSelections.current,
      ),
    [api, createPlot, execute],
  );

  const executeVoice = (text: string) => {
    setStatus("正在理解指令…");
    const result = execute(text);
    const generation = assistantGeneration.current;
    void result
      .then(() => {
        if (generation !== assistantGeneration.current) {
          return;
        }
        setStatus((previous) => (previous === "正在理解指令…" ? "" : previous));
      })
      .catch((failure) => {
        if (generation === assistantGeneration.current) {
          setError(errorMessage(failure));
        }
      });
  };

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
        Object.values(state.selectedElementIds).some(Boolean) ||
        actionBusy.current
      ) {
        clearTimeout(timer);
        previous = "";
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
      if (
        last.type === "freedraw" &&
        (!currentSettings().apiKey || !currentSettings().model)
      ) {
        return;
      }
      if (
        elements.some(
          (el) =>
            !el.isDeleted &&
            el.customData?.fcAnswerSource === last.id &&
            el.customData?.fcAnswerVersion === last.version,
        )
      ) {
        return;
      }
      timer = setTimeout(() => {
        if (
          signature === processed ||
          actionBusy.current ||
          Object.values(api.getAppState().selectedElementIds).some(Boolean)
        ) {
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
    if (classroomCommands.has("lesson.pause")) {
      await classroomCommands.execute({ name: "lesson.pause" });
    }
    narrator.current?.stop();
    if (recording && currentSettings().speech === "local") {
      recordingVoiceCommand.current = !recordingVoiceCommand.current;
      setListening(recordingVoiceCommand.current);
      setStatus(
        recordingVoiceCommand.current
          ? "录制继续，请说出下一条白板指令"
          : "已结束指令监听，录制与文稿继续",
      );
      return;
    }
    if (listening) {
      if (finishVoice.current) {
        await finishVoice.current();
        return;
      }
      if (voiceRecorder.current?.state !== "recording") {
        voiceGeneration.current++;
      }
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
    if (currentSettings().speech === "local") {
      const generation = ++voiceGeneration.current;
      const lines: TranscriptLine[] = [];
      let finishing = false;
      setListening(true);
      setStatus("正在准备内置中文语音…");
      try {
        const finish = async () => {
          if (finishing || generation !== voiceGeneration.current) {
            return;
          }
          finishing = true;
          const handle = localSpeech.current;
          try {
            await handle?.stop();
            setListening(false);
            localSpeech.current = null;
            finishVoice.current = null;
            if (generation !== voiceGeneration.current) {
              return;
            }
            const text = lines
              .map((line) => line.text)
              .join("")
              .trim();
            if (!text) {
              throw new Error("未识别到语音，请重试");
            }
            executeVoice(text);
          } catch (failure) {
            setListening(false);
            setError(errorMessage(failure));
          }
        };
        const handle = await startLocalSpeech(
          (line) => {
            lines.push(line);
            if (finishVoice.current) {
              void finish().catch(() => {});
            }
          },
          (message) => {
            if (generation === voiceGeneration.current) {
              setListening(false);
              setError(message);
            }
          },
        );
        if (generation !== voiceGeneration.current) {
          await handle.cancel();
          return;
        }
        localSpeech.current = handle;
        finishVoice.current = finish;
        setStatus("正在听，停顿后执行指令；也可再次点击结束语音");
      } catch (failure) {
        setListening(false);
        throw failure;
      }
    } else if (currentSettings().speech === "custom") {
      const generation = ++voiceGeneration.current;
      setListening(true);
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (failure) {
        setListening(false);
        throw failure;
      }
      if (generation !== voiceGeneration.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const chunks: Blob[] = [];
      const recordingVoice = new MediaRecorder(stream);
      recordingVoice.ondataavailable = ({ data }) => {
        if (data.size) {
          chunks.push(data);
        }
      };
      recordingVoice.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (generation !== voiceGeneration.current) {
          return;
        }
        setListening(false);
        void run(async () => {
          const lines = await transcribe(
            new Blob(chunks, { type: recordingVoice.mimeType }),
          );
          if (generation !== voiceGeneration.current) {
            return;
          }
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
      const generation = ++voiceGeneration.current;
      setListening(true);
      setStatus("正在听，请说出指令…");
      try {
        const stop = await startSystemSpeech(
          (text) => {
            if (generation !== voiceGeneration.current) {
              return;
            }
            setListening(false);
            stopSpeech.current?.();
            stopSpeech.current = null;
            executeVoice(text);
          },
          (message) => {
            setListening(false);
            stopSpeech.current?.();
            stopSpeech.current = null;
            setError(message);
          },
        );
        if (generation !== voiceGeneration.current) {
          stop();
        } else {
          stopSpeech.current = stop;
        }
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

  const startRecording = async (selectedMode: RecordingMode = mode) => {
    if (recorder.current) {
      throw new Error("当前录制正在进行或保存中");
    }
    narrator.current?.stop();
    if (
      listening &&
      (localSpeech.current ||
        stopSpeech.current ||
        voiceRecorder.current?.state === "recording")
    ) {
      throw new Error("请先结束语音指令再开始录制");
    }
    transcript.current = [];
    setElapsed(0);
    const instance = new BoardRecorder();
    recorder.current = instance;
    try {
      await instance.start(selectedMode, () => {
        setRecording(false);
        if (recorder.current === instance && !stoppingRecording.current) {
          void stopRecording().catch((failure) =>
            setError(errorMessage(failure)),
          );
        }
      });
    } catch (failure) {
      instance.dispose();
      recorder.current = null;
      throw failure;
    }
    recordMode.current = selectedMode;
    setMode(selectedMode);
    recordStarted.current = Date.now();
    setRecording(true);
    setStatus("录制中，可关闭浮层继续书写；屏幕模式录制当前白板画面");
    if (currentSettings().speech === "local") {
      try {
        let offset = 0;
        localSpeech.current = await startLocalSpeech(
          (line) => {
            transcript.current.push({ ...line, time: line.time + offset });
            if (recordingVoiceCommand.current) {
              recordingVoiceCommand.current = false;
              setListening(false);
              executeVoice(line.text);
            }
          },
          (message) => setError(`录制继续，离线文稿暂不可用：${message}`),
          instance.audioStream,
        );
        offset = (Date.now() - recordStarted.current) / 1000;
      } catch (failure) {
        setError(`录制继续，离线文稿暂不可用：${errorMessage(failure)}`);
      }
    } else if (currentSettings().speech === "system") {
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
    if (stoppingRecording.current || !recorder.current) {
      return;
    }
    stoppingRecording.current = true;
    try {
      recordingVoiceCommand.current = false;
      setListening(false);
      try {
        await localSpeech.current?.stop();
      } catch (failure) {
        setError(`录制继续保存；文稿收尾失败：${errorMessage(failure)}`);
      }
      localSpeech.current = null;
      stopSpeech.current?.();
      stopSpeech.current = null;
      const result = await recorder.current!.stop();
      recorder.current = null;
      setRecording(false);
      let item: Recording = {
        ...result,
        id: crypto.randomUUID(),
        created: Date.now(),
        mode: recordMode.current,
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
    } finally {
      stoppingRecording.current = false;
    }
  };

  useEffect(() => {
    const registrations = [
      classroomCommands.register("ui.invoke", "@internal", async (args) => {
        returnFocus.current = document.querySelector<HTMLElement>(
          "[data-testid='main-menu-trigger']",
        );
        await run(async () => {
          if (
            typeof args.command !== "string" ||
            args.command === "ui.invoke"
          ) {
            throw new Error("菜单操作无效");
          }
          await classroomCommands.execute({
            name: args.command,
            args: args.args as Record<string, unknown> | undefined,
          });
        });
      }),
      classroomCommands.register(
        "voice.toggle",
        "开始或结束语音指令",
        toggleVoice,
      ),
      classroomCommands.register(
        "canvas.capture",
        "截取当前整板用于提问",
        async () => {
          const context = await boardContext(api, true);
          if (!context.elements.length) {
            throw new Error("请先在白板书写内容");
          }
          setCapture(context.image);
          capturedContext.current = context;
          setWholeBoard(true);
          setPanel("ai");
        },
      ),
      classroomCommands.register(
        "math.calculate",
        "计算算式，args.expression 可省略以识别圈选；结果写在板上",
        async (args) =>
          solveMath(
            typeof args.expression === "string" ? args.expression : undefined,
          ),
      ),
      classroomCommands.register("math.inspect", "@internal", () => {
        if (selectedPlot(api)) {
          setPanel("plot");
        }
      }),
      classroomCommands.register(
        "math.plot",
        "插入函数图，args.expression，args.surface 选三维；可带x,y,z,a,b,c数值",
        (args) => {
          if (typeof args.expression !== "string") {
            throw new Error("缺少函数表达式");
          }
          const next = {
            ...defaultPlot,
            expression: plotExpression(args.expression),
            surface: !!args.surface,
          };
          for (const key of ["x", "y", "z", "a", "b", "c"] as const) {
            if (args[key] !== undefined) {
              if (
                typeof args[key] !== "number" ||
                !Number.isFinite(args[key])
              ) {
                throw new Error("函数参数无效");
              }
              next[key] = args[key] as number;
            }
          }
          createPlot(next);
          setPanel("plot");
        },
      ),
      classroomCommands.register(
        "math.parameters",
        "修改选中函数图的参数，args.x/y/z/a/b/c/range 为数值",
        (args) => {
          const existing = selectedPlot(api);
          if (!existing) {
            throw new Error("请先选择函数图像");
          }
          const next = { ...existing.plot };
          for (const key of ["x", "y", "z", "a", "b", "c", "range"] as const) {
            if (args[key] !== undefined) {
              if (
                typeof args[key] !== "number" ||
                !Number.isFinite(args[key])
              ) {
                throw new Error("函数参数无效");
              }
              next[key] = args[key] as number;
            }
          }
          plotRef.current = existing;
          createPlot(next, true);
        },
      ),
      classroomCommands.register("canvas.cube", "插入标准线条立方体", () =>
        classroomCommands.execute({
          name: "tools.insert",
          args: { kind: "cube" },
        }),
      ),
      classroomCommands.register(
        "canvas.summary",
        "总结圈选或白板；args.whole=true 总结整板",
        async (args) => summarize(!!args.whole),
      ),
      classroomCommands.register(
        "record.start",
        "开始录制，args.mode=audio|camera|screen|combined；录制时仍可使用白板",
        async (args) => {
          if (recorder.current) {
            throw new Error("当前已在录制");
          }
          const selectedMode =
            typeof args.mode === "string" &&
            ["audio", "camera", "screen", "combined"].includes(args.mode)
              ? (args.mode as RecordingMode)
              : mode;
          await startRecording(selectedMode);
        },
      ),
      classroomCommands.register(
        "record.stop",
        "停止并保存录制与文稿",
        async () => {
          if (!recorder.current) {
            throw new Error("当前未录制");
          }
          await stopRecording();
        },
      ),
      classroomCommands.register(
        "record.open",
        "查看录音、视频、文稿和总结，args.id 可选",
        (args) => {
          if (typeof args.id === "string") {
            setActiveId(args.id);
          }
          setPanel("record");
        },
      ),
      classroomCommands.register(
        "files.receive",
        "开启或关闭本机局域网上屏，args.enabled=false关闭",
        async (args) => {
          if (!Capacitor.isNativePlatform()) {
            throw new Error("局域网接收服务需要安卓安装版");
          }
          if (args.enabled === false) {
            await NativeClassroom.stopReceiver();
            setUrls([]);
          } else {
            const result = await NativeClassroom.startReceiver();
            setUrls(result.urls);
            setPanel("files");
          }
        },
      ),
      classroomCommands.register(
        "files.open",
        "打开已接收的课件，args.id 或 args.name；不指定则显示课件列表",
        async (args) => {
          if (!args.id && !args.name) {
            setPanel("files");
            return;
          }
          const local =
            typeof args.name === "string"
              ? recentFiles.current.get(args.name)
              : undefined;
          if (local) {
            await showPreview(local);
            return;
          }
          const file = uploads.find(
            (item) => item.id === args.id || item.name === args.name,
          );
          if (!file) {
            throw new Error("未找到课件，请先在本机课件中重新打开原文件");
          }
          await openUpload(file);
        },
      ),
      classroomCommands.register(
        "panel.open",
        "显示浮层，args.panel=settings|record|files|ai",
        (args) => {
          if (
            !["settings", "record", "files", "ai"].includes(String(args.panel))
          ) {
            throw new Error("此浮层不存在");
          }
          setPanel(args.panel as Panel);
        },
      ),
      classroomCommands.register("panel.close", "关闭当前工具浮层", () =>
        close(false),
      ),
      classroomCommands.context("classroom", () => ({
        recording,
        recordingMode: mode,
        panel,
        files: [
          ...uploads.map(({ id, name }) => ({ id, name })),
          ...Array.from(recentFiles.current.keys(), (name) => ({ name })),
        ],
        recordings: records.map(({ id, created, duration }) => ({
          id,
          created,
          duration,
        })),
      })),
    ];
    return () => registrations.forEach((stop) => stop());
  });

  return (
    <div className="fc-classroom">
      <BoardSwitcher api={api} />
      <LanSession api={api} />
      <Teacher api={api} onCommand={execute} />
      <TeachingTools api={api} />
      {(error || status || busy || selectionBusy || recording || listening) && (
        <div
          className={`fc-notice ${error ? "fc-error" : ""}`}
          role={error ? "alert" : "status"}
        >
          <span>
            {error ||
              (busy || selectionBusy
                ? "正在处理…"
                : recording
                ? `录制中 ${timestamp(elapsed)}`
                : listening
                ? "正在聆听…"
                : status)}
          </span>
          {recording && (
            <button disabled={busy} onClick={() => void run(stopRecording)}>
              停止录制
            </button>
          )}
          {listening && (
            <button onClick={() => void run(toggleVoice)}>结束语音</button>
          )}
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
          style={
            panel === "plot"
              ? {
                  ...plotPlacement,
                  width: "min(280px, calc(100% - 24px))",
                  right: "auto",
                  bottom: "auto",
                  maxHeight: `calc(100% - ${plotPlacement.top + 84}px)`,
                }
              : panelStyle
          }
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
              <small>Fcboard · 方成教育</small>
              <h2>{titles[panel]}</h2>
            </div>
            <button onClick={() => close()} aria-label="关闭工具浮层">
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
                    if (settings.ttsEndpoint) {
                      validateEndpoint(settings.ttsEndpoint);
                    }
                    saveSettings(settings, remember);
                    setStatus("设置已保存");
                    setError("");
                  } catch (failure) {
                    setError(errorMessage(failure));
                  }
                }}
              >
                <LearningSettings />
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
                        speech: event.target.value as Settings["speech"],
                      })
                    }
                  >
                    <option value="local">内置离线中文语音（安卓版）</option>
                    <option value="system">安卓 / 浏览器系统语音识别</option>
                    <option value="custom">自定义语音转写接口</option>
                  </select>
                </label>
                {settings.speech === "local" && (
                  <p>
                    中文模型随安卓版安装，识别在本机完成，不依赖系统语音服务。录制文稿与录音共用同一麦克风。
                  </p>
                )}
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
                <section aria-label="语音播报（可选）">
                  <h3>语音播报（可选）</h3>
                  <label>
                    IndexTTS / 自定义播报接口
                    <input
                      type="url"
                      value={settings.ttsEndpoint}
                      placeholder="http://192.168.1.10:8766/v1/audio/speech"
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          ttsEndpoint: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    播报服务密钥
                    <input
                      type="password"
                      autoComplete="off"
                      value={settings.ttsKey}
                      onChange={(event) =>
                        setSettings({ ...settings, ttsKey: event.target.value })
                      }
                    />
                  </label>
                  <p>
                    IndexTTS
                    运行在局域网电脑上。留空时不启用播报；不影响内置语音识别。
                  </p>
                </section>
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
                <label className="fc-check">
                  <input
                    type="checkbox"
                    checked={autoMath}
                    onChange={(event) => {
                      setAutoMath(event.target.checked);
                      setSettings({
                        ...settings,
                        autoMath: event.target.checked,
                      });
                    }}
                  />
                  停笔后自动补全算式结果
                </label>
                <p>
                  AI
                  截图、语音或录制转写会发送至你配置的服务。系统语音是否联网取决于设备语音服务。
                </p>
                <button className="fc-primary" type="submit">
                  保存设置
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const context = await boardContext(api);
                      const result = await chat(
                        [
                          visualMessage(
                            context.image
                              ? "确认可以读取这张白板截图，只回复识别到的一小段内容。"
                              : "连接测试，请回复连接成功。",
                            context.image,
                          ),
                        ],
                        undefined,
                        settings,
                      );
                      setStatus(
                        context.image
                          ? `截图识别返回：${result.slice(0, 160)}`
                          : `连接测试返回：${result.slice(
                              0,
                              160,
                            )}；在白板书写后可测试截图识别`,
                      );
                    })
                  }
                >
                  测试当前配置
                </button>
              </form>
            )}
            {panel === "ai" && (
              <>
                {capture && (
                  <img className="fc-capture" src={capture} alt="白板截图" />
                )}
                <label className="fc-check">
                  <input
                    type="checkbox"
                    checked={wholeBoard}
                    onChange={(event) => {
                      capturedContext.current = null;
                      setCapture(undefined);
                      setWholeBoard(event.target.checked);
                    }}
                  />
                  分析整个白板（关闭时优先使用框选区域）
                </label>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(() => execute(prompt, wholeBoard));
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
                      void run(() => summarize(wholeBoard));
                    }}
                  >
                    总结选区 / 白板
                  </button>
                </div>
                {output && (
                  <>
                    <div className="fc-output">{output}</div>
                    {currentSettings().ttsEndpoint && (
                      <div className="fc-actions">
                        <button
                          disabled={busy || listening || recording}
                          onClick={() => {
                            void run(() => narrator.current!.speak(output));
                          }}
                        >
                          朗读回答
                        </button>
                        <button onClick={() => narrator.current?.stop()}>
                          停止朗读
                        </button>
                      </div>
                    )}
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
            {panel === "plot" && (
              <>
                <p>
                  <strong>
                    {plot.surface ? "z" : "y"} = {plot.expression}
                  </strong>
                </p>
                <label>
                  坐标范围 ±
                  <input
                    type="number"
                    min="0.1"
                    max="1000"
                    step="0.1"
                    value={plot.range}
                    onChange={(event) => {
                      const range = Number(event.target.value);
                      if (range > 0 && range <= 1000) {
                        try {
                          createPlot({ ...plot, range }, true);
                        } catch (failure) {
                          setError(errorMessage(failure));
                        }
                      }
                    }}
                  />
                </label>
                <p>
                  x、y 控制采样区间的平移，z 控制输出偏移；a、b、c
                  可用于表达式。拖动后更新当前图像。
                </p>
                {(["x", "y", "z", "a", "b", "c"] as const)
                  .filter(
                    (key) =>
                      key === "x" ||
                      key === "z" ||
                      (key === "y" && plot.surface) ||
                      new RegExp(`\\b${key}\\b`).test(plot.expression),
                  )
                  .map((key) => (
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
                    {active.summary && currentSettings().ttsEndpoint && (
                      <div className="fc-actions">
                        <button
                          disabled={busy || listening || recording}
                          onClick={() => {
                            void run(() =>
                              narrator.current!.speak(active.summary),
                            );
                          }}
                        >
                          朗读总结
                        </button>
                        <button onClick={() => narrator.current?.stop()}>
                          停止朗读
                        </button>
                      </div>
                    )}
                    <div className="fc-actions">
                      <button
                        disabled={busy}
                        onClick={() => {
                          void run(async () => {
                            const lines = await transcribe(active.blob);
                            const updated = {
                              ...active,
                              transcript: lines,
                              summary: "",
                            };
                            await persistRecords(
                              recordsRef.current.map((item) =>
                                item.id === active.id ? updated : item,
                              ),
                            );
                            if (currentSettings().autoSummary && lines.length) {
                              const summary = await summaryFor(updated);
                              await persistRecords(
                                recordsRef.current.map((item) =>
                                  item.id === active.id
                                    ? { ...item, summary }
                                    : item,
                                ),
                              );
                            }
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
                  accept={DOCUMENT_ACCEPT}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void showPreview(file).catch((failure) =>
                        setError(errorMessage(failure)),
                      );
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
                          void run(() => openUpload(file));
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
                    还没有收到文件。手机选中文件即上传上屏，支持 PPT /
                    PPTX、PDF、Word、Excel 和图片。
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
          onClose={(advance = true) => {
            previewReady.current?.reject(
              new DOMException("课件已关闭", "AbortError"),
            );
            previewReady.current = null;
            classroomCommands.invalidate();
            previewRef.current = null;
            setPreview(null);
            const next = advance ? incoming.current.shift() : undefined;
            if (next) {
              void openUpload(next).catch((failure) =>
                setError(errorMessage(failure)),
              );
            }
          }}
          listening={listening}
          onReady={(failure) => {
            const waiting = previewReady.current;
            previewReady.current = null;
            if (failure) {
              waiting?.reject(new Error(failure));
            } else {
              waiting?.resolve();
            }
          }}
          onVoice={() => {
            void toggleVoice().catch((failure) =>
              setError(errorMessage(failure)),
            );
          }}
          onTools={() => {
            void classroomCommands.execute({ name: "tools.open" });
          }}
        />
      )}
    </div>
  );
};
