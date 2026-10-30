import { getLanguage, t } from "@fcboard/fcboard/i18n";
import {
  CaptureUpdateAction,
  convertToFcboardElements,
} from "@fcboard/fcboard";
import { getCommonBounds } from "@fcboard/element";
import { pointFrom } from "@fcboard/math";

import type { FcboardElementSkeleton } from "@fcboard/element/transform";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { insertGeneratedImage } from "./imageGeneration";

import { boardContext } from "./ai";
import { classroomCommands } from "./commands";
import { currentSettings } from "./settings";
import { selectionSignature } from "./selection";
import { boardInk } from "./digitalInk";
import { insertText } from "./board";
import { languageInkSignature } from "./languageStudy";
import { LiveTableWriting } from "./liveTableWriting";
import { chooseInsertionCandidate } from "./InsertionCandidates";
import { latestFunctionInk } from "./functionInk";
import {
  boardWritingParts,
  insertionWritingTargets,
  insertionWritingAt,
  insertionWritingText,
  insertionWritingTextIds,
} from "./insertionWriting";
import { insertionLabelParts } from "./insertionLabels";
import {
  inkAssistMode,
  recognizeInkContent,
  settleInkRecognition,
} from "./inkRecognition";

/** Smart pen modes keep the real ink until a complete, still-current recognition is ready. */
export const observeInkAssistance = (
  api: FcboardImperativeAPI,
  onBusy: (busy: boolean) => void,
  onError: (failure: unknown) => void,
) => {
  const seen = new Set(api.getSceneElements().map((element) => element.id));
  const failed = new Set<string>();
  let timer: ReturnType<typeof setTimeout>;
  let controller: AbortController | undefined;
  let previous = "";
  const configuration = () => {
    const state = api.getAppState();
    return JSON.stringify([
      state.currentItemInkAssist,
      state.currentItemPenMode,
      state.whiteboardPenTip,
      state.whiteboardPenTips,
      state.whiteboardDualPen,
      getLanguage().code,
    ]);
  };
  let penConfiguration = configuration();
  const refresh = () => {
    const state = api.getAppState();
    const nextConfiguration = configuration();
    if (
      penConfiguration !== nextConfiguration ||
      classroomCommands.has("document.draw") ||
      state.activeTool.type !== "freedraw"
    ) {
      penConfiguration = nextConfiguration;
      api.getSceneElements().forEach((element) => seen.add(element.id));
      clearTimeout(timer);
      controller?.abort();
      onBusy(false);
      previous = "";
      return;
    }
    if (state.cursorButton === "down" || state.activeTool.type !== "freedraw") {
      clearTimeout(timer);
      controller?.abort();
      onBusy(false);
      previous = "";
      return;
    }
    const scene = api.getSceneElements();
    const targets = insertionWritingTargets(boardWritingParts(scene));
    const targetCache = new Map<
      string,
      ReturnType<typeof insertionWritingAt>
    >();
    const targetFor = (element: typeof scene[number]) => {
      if (
        !targets.length ||
        element.type !== "freedraw" ||
        !element.points.length
      ) {
        return undefined;
      }
      if (targetCache.has(element.id)) {
        return targetCache.get(element.id);
      }
      const mode = inkAssistMode(element.customData?.fcInk?.assist);
      const point = element.angle
        ? boardInk([element])[0]?.[0]
        : [element.x + element.points[0][0], element.y + element.points[0][1]];
      const target =
        !mode || mode === "text"
          ? insertionWritingAt(targets, point)
          : undefined;
      targetCache.set(element.id, target);
      return target;
    };
    const pending = scene
      .filter((element) => element.type === "freedraw")
      .filter((element) => {
        if (
          seen.has(element.id) ||
          element.customData?.fcGenerated ||
          element.customData?.fcLanguage ||
          element.customData?.fcQuestionInput ||
          element.customData?.fcWrittenText
        ) {
          return false;
        }
        if (
          inkAssistMode(element.customData?.fcInk?.assist) ||
          targetFor(element)
        ) {
          return true;
        }
        seen.add(element.id);
        return false;
      });
    const last = pending.at(-1);
    const target = last ? targetFor(last) : undefined;
    const mode = target
      ? "text"
      : inkAssistMode(last?.customData?.fcInk?.assist);
    let source = pending.filter((element) =>
      target
        ? targetFor(element)?.key === target.key
        : !targetFor(element) && element.customData?.fcInk?.assist === mode,
    );
    if (!target && mode === "function") {
      const included = latestFunctionInk(boardInk(source));
      source = source.filter((_, index) => included.has(index));
    }
    const signature = selectionSignature(source);
    const requestKey = `${signature}:${target?.stamp || ""}`;
    if (!mode || !signature || failed.has(requestKey)) {
      clearTimeout(timer);
      controller?.abort();
      onBusy(false);
      previous = "";
      return;
    }
    if (requestKey === previous) {
      return;
    }
    previous = requestKey;
    clearTimeout(timer);
    controller?.abort();
    const request = new AbortController();
    controller = request;
    const since = Date.now();
    timer = setTimeout(
      () => {
        if (
          mode === "shape" &&
          (!currentSettings().apiKey || !currentSettings().model.trim())
        ) {
          failed.add(requestKey);
          return;
        }
        const current = () =>
          !request.signal.aborted &&
          !classroomCommands.has("document.draw") &&
          (!target ||
            insertionWritingTargets(
              boardWritingParts(api.getSceneElements()),
            ).some(
              (item) => item.key === target.key && item.stamp === target.stamp,
            )) &&
          selectionSignature(
            api
              .getSceneElements()
              .filter((element) =>
                source.some((input) => input.id === element.id),
              ),
          ) === signature;
        onBusy(true);
        void (async () => {
          const result = await recognizeInkContent(
            mode,
            async () => (await boardContext(api, false, source)).image || "",
            boardInk(source),
            request.signal,
            undefined,
            target
              ? (candidates) => {
                  const state = api.getAppState();
                  return chooseInsertionCandidate(
                    candidates,
                    {
                      x:
                        (target.x + state.scrollX) * state.zoom.value +
                        (state.offsetLeft || 0),
                      y:
                        (target.y + target.height + state.scrollY) *
                          state.zoom.value +
                        (state.offsetTop || 0) +
                        8,
                    },
                    request.signal,
                  );
                }
              : undefined,
          );
          await settleInkRecognition(mode, since, request.signal);
          if (!current()) {
            return;
          }
          if (result.kind === "language") {
            const group = crypto.randomUUID();
            const metadata = {
              group,
              source: true,
              study: result.study,
              targetLanguage: result.targetLanguage,
              signature: languageInkSignature(boardInk(source)),
            };
            source.forEach((element) => seen.add(element.id));
            insertText(
              api,
              result.study.translation,
              undefined,
              { fcLanguage: { group, source: false } },
              source,
              "handwritten",
              {
                mode: "below",
                sourceLines: result.text.split("\n").length,
                groupId: group,
                sourceUpdates: source.map((element, index) => ({
                  id: element.id,
                  data: {
                    fcLanguage:
                      index === 0 ? metadata : { group, source: true },
                  },
                })),
              },
            );
            return;
          }
          if (result.kind === "function" || result.kind === "calculation") {
            const text = result.text;
            if (result.kind === "function") {
              await classroomCommands.execute({
                name: "math.plot",
                args: {
                  ...result.plot,
                  quiet: true,
                  sourceIds: source.map((element) => element.id),
                  sourceSignature: signature,
                  signal: request.signal,
                },
              });
            } else {
              insertText(
                api,
                `${
                  result.layout ||
                  /=\s*$/.test(text) ||
                  /^[xyz] =/.test(result.answer)
                    ? ""
                    : "= "
                }${result.answer}`,
                undefined,
                { fcSelectionSource: signature },
                source,
                "match",
                {
                  mode: result.layout?.mode || "inline",
                  sourceLines: result.layout?.lines || text.split("\n").length,
                },
              );
            }
            source.forEach((element) => seen.add(element.id));
            return;
          }
          const [left, top, right, bottom] = getCommonBounds(source);
          if (result.kind === "magic") {
            await insertGeneratedImage(api, result.prompt, request.signal, {
              referenceImage: result.image,
              transparent: true,
              bounds: { left, top, right, bottom },
              replaceIds: source.map((element) => element.id),
              sourceSignature: signature,
            });
            return;
          }
          const style = {
            strokeColor: source[0].strokeColor,
            strokeWidth: source[0].strokeWidth,
            opacity: source[0].opacity,
            roughness: 0,
            customData: {
              fcRecognizedSource: source.map((element) => element.id),
            },
          };
          let shape: FcboardElementSkeleton;
          if (result.kind === "text") {
            if (target) {
              const ids = source.map((element) => element.id);
              const text = insertionWritingText(
                target,
                result.text,
                source[0].strokeColor,
                ids,
              );
              if (!text || !current()) {
                return;
              }
              const remove = new Set([
                ...ids,
                ...insertionWritingTextIds(
                  target,
                  boardWritingParts(api.getSceneElements()),
                ),
              ]);
              ids.forEach((id) => seen.add(id));
              api.updateScene({
                elements: [
                  ...api
                    .getSceneElements()
                    .filter((element) => !remove.has(element.id)),
                  ...convertToFcboardElements(
                    insertionLabelParts(
                      text,
                      text.customData?.fcInsertion?.textRuns?.[target.index],
                    ),
                    {
                      regenerateIds: false,
                    },
                  ),
                ],
                captureUpdate: CaptureUpdateAction.IMMEDIATELY,
              });
              return;
            }
            insertText(
              api,
              result.text,
              { x: left, y: top },
              style.customData,
              source,
              "text",
              { mode: "replace", sourceLines: result.text.split("\n").length },
            );
            return;
          }
          const width = Math.max(1, right - left);
          const height = Math.max(1, bottom - top);
          if (result?.shape === "triangle") {
            shape = {
              ...style,
              type: "line",
              x: left + width / 2,
              y: top,
              points: [
                pointFrom(0, 0),
                pointFrom(width / 2, height),
                pointFrom(-width / 2, height),
                pointFrom(0, 0),
              ],
            };
          } else if (result?.shape === "line" || result?.shape === "arrow") {
            const first = source[0];
            const last = source[source.length - 1];
            const end = last.points[last.points.length - 1];
            shape = {
              ...style,
              type: result.shape,
              x: first.x,
              y: first.y,
              points: [
                pointFrom(0, 0),
                pointFrom(last.x + end[0] - first.x, last.y + end[1] - first.y),
              ],
            };
          } else if (
            result?.shape === "rectangle" ||
            result?.shape === "ellipse"
          ) {
            shape = {
              ...style,
              type: result.shape,
              x: left,
              y: top,
              width,
              height,
            };
          } else {
            throw new Error(
              t("fcboard.invalid_shape_pen_response_your_ink_is_preserved"),
            );
          }

          if (!current()) {
            return;
          }
          const ids = new Set(source.map((element) => element.id));
          api.updateScene({
            elements: [
              ...api
                .getSceneElements()
                .filter((element) => !ids.has(element.id)),
              ...convertToFcboardElements([shape]),
            ],
            captureUpdate: CaptureUpdateAction.IMMEDIATELY,
          });
        })()
          .catch((failure) => {
            if (!request.signal.aborted) {
              failed.add(requestKey);
              if (failed.size > 100) {
                failed.delete(failed.values().next().value!);
              }
              if (!target && mode !== "function" && mode !== "calculation") {
                onError(failure);
              }
            }
          })
          .finally(() => {
            if (controller === request) {
              onBusy(false);
            }
          });
      },
      mode === "function" || mode === "calculation"
        ? 350
        : mode === "magic"
        ? 1600
        : 700,
    );
  };
  const stop = api.onChange(refresh);
  const tables = new LiveTableWriting(api);
  const inkProgress = api.onInkProgress?.((stroke, phase) => {
    if (!classroomCommands.has("document.draw")) {
      tables.progress(stroke, phase);
    }
  });
  const inkCommit = api.onInkCommit?.((stroke) => {
    if (classroomCommands.has("document.draw")) {
      return;
    }
    tables.commit(stroke);
    if (
      api.getSceneElements().find((item) => item.id === stroke.id)?.customData
        ?.fcInsertion
    ) {
      seen.add(stroke.id);
    }
  });
  const invalidate = classroomCommands.onInvalidate(() => {
    clearTimeout(timer);
    controller?.abort();
    onBusy(false);
  });
  let board = "";
  const boards = classroomCommands.watch("boards", () => {
    const active =
      (classroomCommands.read("boards") as { active?: string } | undefined)
        ?.active || "";
    if (active !== board) {
      board = active;
      clearTimeout(timer);
      controller?.abort();
      onBusy(false);
      api.getSceneElements().forEach((element) => seen.add(element.id));
    }
  });
  const command = classroomCommands.register(
    "canvas.inkAssist",
    "选择文字/图形/魔术/函数/算式笔，args.mode=text|shape|magic|function|calculation|off；停笔后识别，失败保留原笔迹",
    (args) => {
      if (
        !["text", "shape", "magic", "function", "calculation", "off"].includes(
          String(args.mode),
        )
      ) {
        throw new Error(t("fcboard.unknown_smart_pen_type"));
      }
      api.updateScene({
        appState: {
          currentItemInkAssist:
            args.mode === "off"
              ? undefined
              : (args.mode as
                  | "text"
                  | "shape"
                  | "magic"
                  | "function"
                  | "calculation"),
          currentItemPenMode: "hard",
        },
      });
      if (classroomCommands.has("document.tool")) {
        void classroomCommands.execute({
          name: "document.tool",
          args: { tool: "freedraw" },
        });
      } else {
        api.setActiveTool({ type: "freedraw" });
      }
    },
  );
  return () => {
    clearTimeout(timer);
    controller?.abort();
    stop();
    inkCommit?.();
    inkProgress?.();
    tables.clear();
    invalidate();
    boards();
    command();
  };
};
