import { t, useI18n } from "@excalidraw/excalidraw/i18n";
import { useEffect, useRef, useState } from "react";
import { getCommonBounds } from "@excalidraw/element";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  boardContext,
  chat,
  cropImage,
  selectedBoardElements,
  visualMessage,
} from "./ai";
import { classroomCommands } from "./commands";
import { selectionSignature } from "./selection";
import { handwritingText } from "./handwriting";
import { recognizeHandwriting, warmHandwriting } from "./ocr";
import { selectionMathIntent } from "./intent";
import { calculate, compileExpression, defaultPlot } from "./math";
import { answerPosition, drawAxes, insertText } from "./board";
import { currentSettings } from "./settings";
import { insertGeneratedImage } from "./imageGeneration";

import type { Plot } from "./math";
import type { InkStroke } from "./documents";

type Action = "calculate" | "image" | "question";
type Region = { left: number; top: number; right: number; bottom: number };
type Target = {
  source: readonly ExcalidrawElement[];
  signature: string;
  left: number;
  top: number;
  region?: Region;
  document?: { crop: Region };
};
type DocumentContext = {
  name: string;
  page: number;
  ink: InkStroke[];
  selection: string[];
  region: [number, number][];
  viewport: {
    left: number;
    top: number;
    width: number;
    height: number;
    scroll: number;
  };
};

/** Selection changes only position controls. Recognition is exclusively a button action. */
export const SelectionActions = ({
  api,
  onPlot,
  onRequest,
}: {
  api: ExcalidrawImperativeAPI;
  onPlot: (plot: Plot, source: string) => void;
  onRequest: (
    text: string,
    context: Awaited<ReturnType<typeof boardContext>>,
    signal: AbortSignal,
  ) => Promise<void>;
}) => {
  useI18n();
  const [target, setTarget] = useState<Target>();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const controller = useRef<AbortController | undefined>(undefined);
  const cache = useRef<{ signature: string; text: string } | undefined>(
    undefined,
  );
  useEffect(() => {
    const prepare = () => {
      void warmHandwriting().catch(() => {});
    };
    if (typeof requestIdleCallback === "function") {
      const task = requestIdleCallback(prepare, { timeout: 1500 });
      return () => cancelIdleCallback(task);
    }
    const task = setTimeout(prepare, 300);
    return () => clearTimeout(task);
  }, []);
  useEffect(() => {
    let previous = "";
    const refresh = () => {
      const state = api.getAppState();
      const selection = state.whiteboardSelection;
      const region =
        state.activeTool.type === "lasso" &&
        selection?.elementIds.length ===
          Object.keys(state.selectedElementIds).length &&
        selection.elementIds.every((id) => state.selectedElementIds[id])
          ? selection.bounds
          : undefined;
      const doc = classroomCommands.read("document") as
        | DocumentContext
        | undefined;
      if (doc) {
        const points = doc.region || [];
        if (points.length < 2 || !doc.viewport?.width) {
          controller.current?.abort();
          previous = "";
          setTarget(undefined);
          setPending(false);
          return;
        }
        const selected = doc.ink.filter((stroke) =>
          doc.selection.includes(stroke.id),
        );
        const signature = JSON.stringify([
          doc.name,
          doc.page,
          points,
          selected,
          doc.viewport,
        ]);
        if (signature !== previous) {
          previous = signature;
          controller.current?.abort();
          setPending(false);
          setMessage("");
          setError("");
        }
        const box = {
          left: Math.min(...points.map((p) => p[0])) - 12,
          top: Math.min(...points.map((p) => p[1])) - 12,
          right: Math.max(...points.map((p) => p[0])) + 12,
          bottom: Math.max(...points.map((p) => p[1])) + 12,
        };
        const viewport = doc.viewport;
        const crop = {
          left: box.left / 1000,
          right: box.right / 1000,
          top:
            ((box.top - viewport.scroll) * viewport.width) /
            1000 /
            viewport.height,
          bottom:
            ((box.bottom - viewport.scroll) * viewport.width) /
            1000 /
            viewport.height,
        };
        setTarget((old) =>
          old?.signature === signature
            ? old
            : {
                source: [],
                signature,
                left: Math.max(
                  8,
                  Math.min(
                    innerWidth - 190,
                    viewport.left + (box.left * viewport.width) / 1000,
                  ),
                ),
                top: Math.max(
                  8,
                  Math.min(
                    innerHeight - 110,
                    viewport.top + crop.bottom * viewport.height + 8,
                  ),
                ),
                document: {
                  crop,
                },
              },
        );
        return;
      }
      const source = selectedBoardElements(api);
      const signature =
        !classroomCommands.read("document") &&
        !state.toolbarHidden &&
        !state.editingTextElement &&
        state.cursorButton !== "down" &&
        !state.isResizing &&
        !state.isRotating &&
        source.length &&
        !source.some((element) => element.customData?.fcPlot)
          ? selectionSignature(source) +
            (region ? `|${JSON.stringify(region)}` : "")
          : "";
      if (signature !== previous) {
        previous = signature;
        controller.current?.abort();
        setPending(false);
        setMessage("");
        setError("");
      }
      if (!signature) {
        setTarget(undefined);
        return;
      }
      const [left, , right, bottom] = region
        ? [region.left, region.top, region.right, region.bottom]
        : getCommonBounds(source);
      const unit = Math.max(
        0.85,
        Math.min(state.width / 1280, state.height / 688),
      );
      const position = {
        left:
          Math.max(
            8,
            Math.min(
              state.width - 174 * unit - 8,
              ((left + right) / 2) * state.zoom.value +
                state.scrollX * state.zoom.value -
                87 * unit,
            ),
          ) + (state.offsetLeft || 0),
        top:
          Math.max(
            8,
            Math.min(
              state.height - 100 * unit,
              (bottom + state.scrollY) * state.zoom.value + 12 * unit,
            ),
          ) + (state.offsetTop || 0),
      };
      setTarget((old) =>
        old?.signature === signature &&
        old.left === position.left &&
        old.top === position.top
          ? old
          : { source, signature, ...position, region },
      );
    };
    const stop = api.onChange(refresh);
    const documentChanged = classroomCommands.watch("document", refresh);
    const invalidate = classroomCommands.onInvalidate(() => {
      controller.current?.abort();
      cache.current = undefined;
      setTarget(undefined);
      setPending(false);
    });
    refresh();
    return () => {
      controller.current?.abort();
      stop();
      documentChanged();
      invalidate();
    };
  }, [api]);

  const act = async (action: Action) => {
    if (!target || pending) {
      return;
    }
    const snapshot = target;
    const request = new AbortController();
    controller.current?.abort();
    controller.current = request;
    const { signal } = request;
    setPending(true);
    setError("");
    setMessage("");
    const started = performance.now();
    try {
      const write = async (value: string) =>
        snapshot.document
          ? classroomCommands.execute({
              name: "canvas.text",
              args: {
                text: value,
                presentation: currentSettings().answerStyle,
                signal,
              },
            })
          : insertText(
              api,
              value,
              snapshot.region
                ? answerPosition(
                    api,
                    snapshot.source,
                    value.length > 20 ? 280 : 80,
                    [
                      snapshot.region.left,
                      snapshot.region.top,
                      snapshot.region.right,
                      snapshot.region.bottom,
                    ],
                  )
                : undefined,
              { fcSelectionSource: snapshot.signature },
              snapshot.source,
            );
      let text =
        cache.current?.signature === snapshot.signature
          ? cache.current.text
          : "";
      let context: Awaited<ReturnType<typeof boardContext>> | undefined;
      const capture = async () => {
        if (!context) {
          setMessage(t("fcboard.正在提取选区…"));
          if (snapshot.document) {
            const page = (await classroomCommands.execute({
              name: "document.snapshot",
            })) as { image: string };
            context = {
              elements: [],
              text: "",
              image: await cropImage(
                page.image,
                snapshot.document.crop,
                signal,
              ),
            };
          } else {
            context = await boardContext(
              api,
              false,
              snapshot.source,
              snapshot.region,
            );
          }
        }
        signal.throwIfAborted();
        if (!context.image) {
          throw new Error(t("fcboard.选区没有可识别的内容"));
        }
        return context.image;
      };
      const visualAnswer = async () => {
        setMessage(t("fcboard.正在理解图示…"));
        let preview = "";
        const answer = await chat(
          [
            visualMessage(
              "回答圈选区域中的问题；若只有图示，简要解释图示。结合几何关系和手写文字，不猜测无法辨认的条件。直接给出适合白板的简洁回答，不用Markdown。",
              await capture(),
            ),
          ],
          signal,
          currentSettings(),
          {
            maxTokens: 1536,
            onDelta: (delta) => {
              preview += delta;
              if (!signal.aborted) {
                setMessage(preview.slice(-160));
              }
            },
          },
        );
        signal.throwIfAborted();
        await write(answer);
        setMessage(
          t("fcboard.已写入白板 · {{seconds}}秒", {
            seconds: ((performance.now() - started) / 1000).toFixed(1),
          }),
        );
      };
      const hasDiagram = snapshot.source.some(
        (element) => element.type !== "text" && element.type !== "freedraw",
      );
      if (action === "question" && hasDiagram) {
        await visualAnswer();
        return;
      }

      if (!text) {
        const written = handwritingText(snapshot.source);
        const groups = new Set(
          snapshot.source
            .filter((element) => element.type === "freedraw")
            .map((element) => element.customData?.fcWrittenGroup),
        );
        const known = [
          ...snapshot.source
            .filter((el) => el.type === "text")
            .map((el) => (el.type === "text" ? el.text : "")),
          ...written,
        ]
          .join("\n")
          .trim();
        const [left, top, right, bottom] = snapshot.source.length
          ? getCommonBounds(snapshot.source)
          : [0, 0, 0, 0];
        const completeSource =
          !snapshot.region ||
          (left >= snapshot.region.left &&
            top >= snapshot.region.top &&
            right <= snapshot.region.right &&
            bottom <= snapshot.region.bottom);
        const hasUnknownInk =
          written.length !== groups.size ||
          snapshot.source.some(
            (el) =>
              el.type === "image" ||
              (el.type === "freedraw" && !el.customData?.fcWrittenGroup),
          );
        if (known && completeSource && !hasUnknownInk) {
          text = known;
        } else {
          const image = await capture();
          try {
            text = await recognizeHandwriting(
              image,
              signal,
              setMessage,
              action === "question" ? "text" : "math",
              action === "calculate"
                ? (value) => selectionMathIntent(value)?.action === "calculate"
                : undefined,
            );
          } catch (failure) {
            signal.throwIfAborted();
            const settings = currentSettings();
            if (
              !settings.apiKey ||
              !settings.model.trim() ||
              action === "calculate"
            ) {
              throw failure;
            }
            if (action === "question") {
              await visualAnswer();
              return;
            }
            if (!settings.imageModel.trim()) {
              throw new Error(
                t("fcboard.生成插图请先在设置中填写图像生成模型 ID"),
              );
            }
            setMessage(t("fcboard.正在理解草图…"));
            text = await chat(
              [
                visualMessage(
                  "将这幅草图概括为一段简短、准确的图像生成描述，保留主体和关系，不添加无依据的细节；只输出描述。",
                  image,
                ),
              ],
              signal,
              settings,
              { maxTokens: 256 },
            );
          }
        }
        signal.throwIfAborted();
        if (!text.trim() || text.trim() === "NONE") {
          throw new Error(t("fcboard.未识别到内容，请重新圈选"));
        }
        cache.current = { signature: snapshot.signature, text };
      }
      signal.throwIfAborted();
      const intent = selectionMathIntent(text);
      if (action === "calculate") {
        if (intent?.action !== "calculate") {
          throw new Error(
            t("fcboard.未识别到可计算的算式：{{text}}", {
              text: text.slice(0, 100),
            }),
          );
        }
        await write(calculate(intent.expression));
      } else if (action === "image") {
        if (intent?.action === "axes") {
          await drawAxes(api, snapshot.signature);
        } else if (intent?.action === "plot") {
          onPlot(
            {
              ...defaultPlot,
              expression: intent.expression,
              surface: intent.surface,
            },
            snapshot.signature,
          );
        } else if (
          intent?.action === "calculate" &&
          /\bx\b/.test(intent.expression)
        ) {
          compileExpression(intent.expression);
          onPlot(
            { ...defaultPlot, expression: intent.expression },
            snapshot.signature,
          );
        } else {
          setMessage(t("fcboard.正在生成图像…"));
          await insertGeneratedImage(api, text, signal);
        }
      } else if (
        /^(?:(?:请|帮我|麻烦)\s*)?(?:讲解|讲一|教我|演示|画|绘制|生成|插入|总结|标注|录制|开始录制|停止录制|新建白板|切换白板|撤销|撤回|重做|删除选中|清空白板)/.test(
          text.trim(),
        )
      ) {
        setMessage(t("fcboard.正在执行白板指令…"));
        context ||= { elements: snapshot.source, text, image: undefined };
        await onRequest(text, context, signal);
      } else {
        setMessage(t("fcboard.正在回答…"));
        const settings = currentSettings();
        let preview = "";
        const answer = await chat(
          [
            {
              role: "system",
              content:
                "你是课堂与会议白板助教。直接、准确、简洁地回答问题，使用适合白板的短段落；不要复述问题，不要输出 Markdown 表格或代码围栏。",
            },
            { role: "user", content: text },
          ],
          signal,
          { ...settings, model: settings.textModel || settings.model },
          {
            maxTokens: 1536,
            onDelta: (delta) => {
              preview += delta;
              if (!signal.aborted) {
                setMessage(preview.slice(-160));
              }
            },
          },
        );
        signal.throwIfAborted();
        await write(answer);
      }
      signal.throwIfAborted();
      setMessage(
        t("fcboard.已写入白板 · {{seconds}}秒", {
          seconds: ((performance.now() - started) / 1000).toFixed(1),
        }),
      );
    } catch (failure) {
      if (!signal.aborted) {
        setMessage("");
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      if (controller.current === request) {
        setPending(false);
      }
    }
  };
  if (!target) {
    return null;
  }
  return (
    <div
      className="fc-selection-actions"
      style={{ left: target.left, top: target.top }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div role="toolbar" aria-label={t("fcboard.选区操作")}>
        {(
          [
            [
              "calculate",
              t("fcboard.计算"),
              "M5 7h14M7 12h4m-2-2v4m5-3 4 4m0-4-4 4",
            ],
            [
              "image",
              t("fcboard.图像"),
              "M3 17 9 10l4 4 3-3 5 6M4 4h16v16H4zM15 8h.01",
            ],
            ["question", t("fcboard.问答"), "M5 4h14v12H9l-4 4zM9 8h6m-6 4h4"],
          ] as const
        ).map(([action, label, path]) => (
          <button
            key={action}
            aria-label={label}
            disabled={pending}
            onClick={() => void act(action)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={path} />
            </svg>
            <span>{label}</span>
          </button>
        ))}
        {pending && (
          <button
            aria-label={t("fcboard.取消识别")}
            onClick={() => {
              controller.current?.abort();
              setPending(false);
              setMessage("");
            }}
          >
            ×
          </button>
        )}
      </div>
      {(message || error) && (
        <div
          className={error ? "fc-error" : ""}
          role={error ? "alert" : "status"}
        >
          {error || message}
        </div>
      )}
    </div>
  );
};
