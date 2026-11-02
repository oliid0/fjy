import { getLanguage, t } from "@fcboard/fcboard/i18n";
import {
  CaptureUpdateAction,
  convertToFcboardElements,
} from "@fcboard/fcboard";
import {
  getCommonBounds,
  getElementAbsoluteCoords,
  newElementWith,
} from "@fcboard/element";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { insertGeneratedImage } from "./imageGeneration";

import { boardContext } from "./ai";
import { classroomCommands } from "./commands";
import { recognizedShapeGeometry } from "./shapeRecognition";
import { selectionSignature } from "./selection";
import { boardInk } from "./digitalInk";
import { insertText } from "./board";
import { languageInkSignature } from "./languageStudy";
import { LiveTableWriting } from "./liveTableWriting";
import { chooseInsertionCandidate } from "./InsertionCandidates";
import { renderInsertion } from "./insertObjects";
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
            api.getSceneElements().flatMap((element) => {
              if (element.type !== "line" || element.points.length < 4) {
                return [];
              }
              const [, , , , cx, cy] = getElementAbsoluteCoords(
                element,
                new Map(),
              );
              const cos = Math.cos(element.angle);
              const sin = Math.sin(element.angle);
              return [
                {
                  id: element.id,
                  points: element.points.map(([x, y]): [number, number] => {
                    const dx = element.x + x - cx;
                    const dy = element.y + y - cy;
                    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
                  }),
                },
              ];
            }),
          );
          await settleInkRecognition(mode, since, request.signal);
          if (!current()) {
            return;
          }
          if (result.kind === "angles") {
            const groups = new Map(
              result.labels.map((label) => [
                label.shapeId,
                api
                  .getSceneElements()
                  .find((element) => element.id === label.shapeId)
                  ?.groupIds.at(-1) || crypto.randomUUID(),
              ]),
            );
            source.forEach((element) => seen.add(element.id));
            const marks = new Set(source.map((element) => element.id));
            api.updateScene({
              elements: [
                ...api
                  .getSceneElements()
                  .filter(
                    (element) =>
                      !result.labels.some(
                        (label) =>
                          element.customData?.fcAngle?.shapeId ===
                            label.shapeId &&
                          element.customData?.fcAngle?.vertex === label.vertex,
                      ),
                  )
                  .map((element) =>
                    groups.has(element.id) || marks.has(element.id)
                      ? newElementWith(element, {
                          groupIds: [
                            groups.get(element.id) ||
                              groups.values().next().value!,
                          ],
                          customData: {
                            ...element.customData,
                            ...(marks.has(element.id)
                              ? { fcGenerated: true }
                              : {}),
                          },
                        })
                      : element,
                  ),
                ...convertToFcboardElements(
                  result.labels.map((label) => ({
                    type: "text" as const,
                    x: label.x,
                    y: label.y,
                    text: label.text,
                    fontSize: 18 / api.getAppState().zoom.value,
                    fontFamily: 2,
                    strokeColor: source[0].strokeColor,
                    groupIds: [groups.get(label.shapeId)!],
                    customData: {
                      fcGenerated: true,
                      fcAngle: { shapeId: label.shapeId, vertex: label.vertex },
                    },
                  })),
                ),
              ],
              captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            });
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
          if (result.kind === "text") {
            if (target) {
              const ids = source.map((element) => element.id);
              const text = insertionWritingText(
                target,
                result.text,
                source[0].strokeColor,
                ids,
              );
              if (!text || text.type !== "text" || !current()) {
                return;
              }
              if (target.insertion.kind === "fourline") {
                ids.forEach((id) => seen.add(id));
                await renderInsertion(
                  api,
                  {
                    ...text.customData!.fcInsertion,
                    position: { x: target.x, y: target.y },
                    height: target.height,
                    text: text.originalText,
                    textColors: [source[0].strokeColor],
                  },
                  true,
                  { select: false, removeIds: ids, exact: true },
                );
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
          const shape = {
            ...recognizedShapeGeometry(result.shape, boardInk(source)),
            ...style,
          };

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
        : mode === "shape"
        ? 250
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
