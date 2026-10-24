import { t, useI18n, getLanguage } from "@excalidraw/excalidraw/i18n";
import { useEffect, useRef, useState } from "react";
import Paper from "@mui/material/Paper";
import ButtonBase from "@mui/material/ButtonBase";

import { getCommonBounds } from "@excalidraw/element";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { TransientMessage } from "./TransientMessage";

import {
  boardContext,
  chat,
  cropImage,
  selectedBoardElements,
  visualMessage,
} from "./ai";
import { classroomCommands } from "./commands";
import { selectionSignature, selectionToolbarPosition } from "./selection";
import { handwritingText } from "./handwriting";
import { recognizeHandwriting, warmHandwriting } from "./ocr";
import { selectionMathIntent, selectionAIAction } from "./intent";
import { drawAxes, insertText } from "./board";
import { currentSettings } from "./settings";
import { boardInk, clipInk } from "./digitalInk";
import { recognizeMath } from "./mathRecognition";
import {
  explainLanguage,
  isDictionaryWord,
  languageStudyText,
} from "./languageStudy";

import type { Plot } from "./math";
import type { InkStroke } from "./documents";

type Action = "auto" | "search" | "language";
type Region = { left: number; top: number; right: number; bottom: number };
type Target = {
  source: readonly ExcalidrawElement[];
  signature: string;
  canSearch: boolean;
  left: number;
  top: number;
  region?: Region;
  document?: { crop: Region; hasObjects: boolean };
};
type DocumentContext = {
  selectionInProgress?: boolean;
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
        ["selection", "lasso"].includes(state.activeTool.type) &&
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
        if (
          doc.selectionInProgress ||
          points.length < 2 ||
          !doc.viewport?.width
        ) {
          controller.current?.abort();
          previous = "";
          setTarget(undefined);
          setPending(false);
          return;
        }
        const selected = doc.ink.filter((stroke) =>
          doc.selection.includes(stroke.id),
        );
        const canSearch =
          !selected.length ||
          selected.some(
            (stroke) =>
              stroke.text ||
              (!stroke.image &&
                !stroke.widget &&
                !stroke.plot &&
                !stroke.insertion),
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
          left: Math.min(...points.map((p) => p[0])),
          top: Math.min(...points.map((p) => p[1])),
          right: Math.max(...points.map((p) => p[0])),
          bottom: Math.max(...points.map((p) => p[1])),
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
                canSearch,
                ...selectionToolbarPosition(
                  {
                    left: viewport.left + (box.left * viewport.width) / 1000,
                    right: viewport.left + (box.right * viewport.width) / 1000,
                    top:
                      viewport.top +
                      ((box.top - viewport.scroll) * viewport.width) / 1000,
                    bottom:
                      viewport.top +
                      ((box.bottom - viewport.scroll) * viewport.width) / 1000,
                  },
                  {
                    left: Math.max(0, viewport.left),
                    right: Math.min(innerWidth, viewport.left + viewport.width),
                    top: Math.max(0, viewport.top),
                    bottom: Math.min(
                      innerHeight,
                      viewport.top + viewport.height,
                    ),
                  },
                  1,
                  canSearch ? 4 : 3,
                ),
                document: {
                  crop,
                  hasObjects: !!selected.length,
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
      const [left, top, right, bottom] = region
        ? [region.left, region.top, region.right, region.bottom]
        : getCommonBounds(source);
      const unit = Math.max(
        0.85,
        Math.min(1, state.width / 1280, state.height / 688),
      );
      const canSearch = source.some(
        (element) => element.type === "text" || element.type === "freedraw",
      );
      const offsetLeft = state.offsetLeft || 0;
      const offsetTop = state.offsetTop || 0;
      const position = selectionToolbarPosition(
        {
          left: (left + state.scrollX) * state.zoom.value + offsetLeft,
          right: (right + state.scrollX) * state.zoom.value + offsetLeft,
          top: (top + state.scrollY) * state.zoom.value + offsetTop,
          bottom: (bottom + state.scrollY) * state.zoom.value + offsetTop,
        },
        {
          left: offsetLeft,
          right: offsetLeft + state.width,
          top: offsetTop,
          bottom: offsetTop + state.height - 68 * unit,
        },
        unit,
        canSearch ? 4 : 3,
      );
      setTarget((old) =>
        old?.signature === signature &&
        old.left === position.left &&
        old.top === position.top
          ? old
          : { source, signature, canSearch, ...position, region },
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

  const act = async (action: Action, reportToCaller = false) => {
    if (!target || pending) {
      return;
    }
    const snapshot = target;
    let operation:
      | Exclude<Action, "auto">
      | ReturnType<typeof selectionAIAction> =
      action === "auto" ? "question" : action;
    const request = new AbortController();
    controller.current?.abort();
    controller.current = request;
    const { signal } = request;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const write = async (value: string) =>
        snapshot.document
          ? classroomCommands.execute({
              name: "canvas.text",
              args: {
                text: value,
                presentation: currentSettings().answerStyle,
                placement: operation === "calculate" ? "inline" : "below",
                sourceLines: text.trim()
                  ? text.split("\n").filter((line) => line.trim()).length
                  : undefined,
                signal,
              },
            })
          : insertText(
              api,
              value,
              undefined,
              { fcSelectionSource: snapshot.signature },
              snapshot.source,
              currentSettings().answerStyle,
              {
                mode: operation === "calculate" ? "inline" : "below",
                bounds: snapshot.region,
                sourceLines: text.trim()
                  ? text.split("\n").filter((line) => line.trim()).length
                  : undefined,
              },
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
        setMessage("");
      };
      const hasDiagram = snapshot.source.some(
        (element) => element.type !== "text" && element.type !== "freedraw",
      );
      if (action === "auto" && hasDiagram) {
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
          const strokes = snapshot.document
            ? (() => {
                const doc = classroomCommands.read("document") as
                  | DocumentContext
                  | undefined;
                if (!doc) {
                  return [];
                }
                const points = doc.region;
                const chosen = doc.ink.filter((stroke) =>
                  doc.selection.includes(stroke.id),
                );
                if (
                  chosen.some(
                    (stroke) =>
                      stroke.text ||
                      stroke.image ||
                      stroke.widget ||
                      stroke.insertion ||
                      stroke.plot,
                  )
                ) {
                  return [];
                }
                return clipInk(
                  chosen
                    .filter(
                      (stroke) =>
                        doc.selection.includes(stroke.id) &&
                        !stroke.text &&
                        !stroke.image &&
                        !stroke.widget &&
                        !stroke.insertion,
                    )
                    .map((stroke) => stroke.points),
                  points.length
                    ? {
                        left: Math.min(...points.map(([x]) => x)),
                        right: Math.max(...points.map(([x]) => x)),
                        top: Math.min(...points.map(([, y]) => y)),
                        bottom: Math.max(...points.map(([, y]) => y)),
                      }
                    : undefined,
                );
              })()
            : snapshot.source.every((element) => element.type === "freedraw")
            ? boardInk(snapshot.source, snapshot.region)
            : [];
          text = await recognizeHandwriting(
            capture,
            signal,
            setMessage,
            "text",
            undefined,
            strokes,
          );
        }
        signal.throwIfAborted();
        if (!text.trim() || text.trim() === "NONE") {
          throw new Error(t("fcboard.未识别到内容，请重新圈选"));
        }
        cache.current = { signature: snapshot.signature, text };
      }
      signal.throwIfAborted();
      operation = action === "auto" ? selectionAIAction(text) : action;
      const intent = selectionMathIntent(text);
      if (operation === "search") {
        await classroomCommands.execute({
          name: "web.open",
          args: {
            url: `${
              getLanguage().code.startsWith("zh")
                ? "https://image.baidu.com/search/index?tn=baiduimage&word="
                : "https://www.google.com/search?q="
            }${encodeURIComponent(text.trim())}`,
          },
        });
      } else if (
        operation === "language" ||
        (operation === "question" && isDictionaryWord(text))
      ) {
        setMessage(t("fcboard.正在解析词句…"));
        const study = await explainLanguage(text.trim(), signal);
        signal.throwIfAborted();
        await write(languageStudyText(study));
      } else if (operation === "calculate") {
        const result = await recognizeMath(text, "calculation", signal);
        signal.throwIfAborted();
        if (result.kind === "calculation") {
          await write(result.answer);
        }
      } else if (operation === "image") {
        if (intent?.action === "axes") {
          await drawAxes(api, snapshot.signature);
        } else {
          const result = await recognizeMath(text, "function", signal);
          signal.throwIfAborted();
          if (result.kind === "function") {
            onPlot(result.plot, snapshot.signature);
          }
        }
      } else if (
        /^(?:(?:请|帮我|麻烦)\s*)?(?:讲解|解释|引导|辅导|讲一|教我|演示|画|绘制|生成|插入|总结|标注|录制|开始录制|停止录制|新建白板|切换白板|撤销|撤回|重做|删除选中|清空白板)/.test(
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
      setMessage("");
    } catch (failure) {
      if (!signal.aborted) {
        setMessage("");
        setError(failure instanceof Error ? failure.message : String(failure));
      }
      if (reportToCaller) {
        throw failure;
      }
    } finally {
      if (controller.current === request) {
        setPending(false);
      }
    }
  };
  useEffect(() =>
    classroomCommands.register(
      "language.explain",
      "解析圈中的任意语言词句：词性、发音、音节、释义、语法、用法与例句，结果写在选区旁；先圈选内容再调用",
      () => {
        if (!target || pending) {
          throw new Error(t("fcboard.请先圈选要学习的词句"));
        }
        return act("language", true);
      },
    ),
  );
  if (!target) {
    return null;
  }
  return (
    <div
      className="fc-selection-actions"
      style={{ left: target.left, top: target.top }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Paper
        component="div"
        role="toolbar"
        aria-label={t("fcboard.选区操作")}
        elevation={0}
      >
        <ButtonBase
          aria-label={t("labels.copy")}
          disabled={pending || target.document?.hasObjects === false}
          onClick={() => {
            controller.current?.abort();
            void classroomCommands
              .execute({
                name: "canvas.action",
                args: { action: "duplicateSelection" },
              })
              .catch((failure) => setError(String(failure)));
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <path d="M8 8h12v12H8zM4 16V4h12" />
          </svg>
        </ButtonBase>
        <ButtonBase
          aria-label={t("labels.delete")}
          disabled={target.document?.hasObjects === false}
          onClick={() => {
            controller.current?.abort();
            void classroomCommands
              .execute({ name: "canvas.erase" })
              .catch((failure) => setError(String(failure)));
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7" />
          </svg>
        </ButtonBase>
        {target.canSearch && (
          <ButtonBase
            aria-label={t("fcboard.搜索")}
            disabled={pending}
            onClick={() => void act("search")}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <circle cx="10" cy="10" r="6" />
              <path d="m15 15 6 6" />
            </svg>
          </ButtonBase>
        )}
        <ButtonBase
          aria-label={pending ? t("fcboard.取消识别") : "AI"}
          aria-busy={pending}
          onClick={() => {
            if (pending) {
              controller.current?.abort();
              setPending(false);
              setMessage("");
            } else {
              void act("auto");
            }
          }}
        >
          {pending ? "×" : "AI"}
        </ButtonBase>
      </Paper>
      <TransientMessage
        message={error || (pending ? "" : message)}
        role={error ? "alert" : "status"}
        className={error ? "fc-error" : ""}
      />
    </div>
  );
};
