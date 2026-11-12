import { getLanguage, t } from "@fcboard/fcboard/i18n";
import {
  CaptureUpdateAction,
  convertToFcboardElements,
} from "@fcboard/fcboard";
import {
  getCommonBounds,
  LinearElementEditor,
  newElementWith,
} from "@fcboard/element";

import type { FcboardElementSkeleton } from "@fcboard/element/transform";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { insertMagicInk } from "./magicPen";
import { InkRequests } from "./inkRequests";

import { boardContext } from "./ai";
import { classroomCommands } from "./commands";
import { selectionSignature } from "./selection";
import { boardInk } from "./digitalInk";
import { insertText } from "./board";
import { languageInkSignature } from "./languageStudy";
import { LiveTableWriting } from "./liveTableWriting";
import { chooseInsertionCandidate } from "./InsertionCandidates";
import { renderInsertion } from "./insertObjects";
import { latestFunctionInk } from "./functionInk";
import {
  latestShapeInk,
  recognizeAngleMark,
  recognizedShapeSkeleton,
} from "./shapeRecognition";
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
  inkRecognitionDelay,
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
  const requests = new InkRequests();
  let previous = "";
  let disposed = false;
  let observedScene:
    | readonly import("@fcboard/element/types").FcboardElement[]
    | undefined;
  let observedButton: string | undefined;
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
  const refresh = (rescan = false) => {
    if (disposed) {
      return;
    }
    const state = api.getAppState();
    const nextConfiguration = configuration();
    const currentScene = api.getSceneElements();
    requests.prune(currentScene.map((element) => element.id));
    if (
      !rescan &&
      currentScene === observedScene &&
      state.cursorButton === observedButton &&
      penConfiguration === nextConfiguration
    ) {
      return;
    }
    observedScene = currentScene;
    observedButton = state.cursorButton;
    if (
      penConfiguration !== nextConfiguration ||
      classroomCommands.has("document.draw") ||
      state.activeTool.type !== "freedraw"
    ) {
      penConfiguration = nextConfiguration;
      api.getSceneElements().forEach((element) => seen.add(element.id));
      requests.cancelAll();
      onBusy(requests.busy);
      previous = "";
      return;
    }
    if (state.cursorButton === "down" || state.activeTool.type !== "freedraw") {
      onBusy(requests.busy);
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
    const last = pending
      .filter((element) => requests.available(element.id))
      .at(-1);
    if (!last) {
      return;
    }
    const target = last ? targetFor(last) : undefined;
    const mode = target
      ? "text"
      : inkAssistMode(last?.customData?.fcInk?.assist);
    let source = pending.filter((element) =>
      target
        ? targetFor(element)?.key === target.key
        : !targetFor(element) && element.customData?.fcInk?.assist === mode,
    );
    if (mode) {
      source = requests.source(source, mode, (element) => element.id, boardInk);
    }
    if (!target && mode === "function") {
      const included = latestFunctionInk(boardInk(source));
      source = source.filter((_, index) => included.has(index));
    }
    if (!target && mode === "shape") {
      const included = latestShapeInk(boardInk(source));
      source = source.filter((_, index) => included.has(index));
    }
    const signature = selectionSignature(source);
    const requestKey = `${signature}:${target?.stamp || ""}`;
    if (!mode || !signature || failed.has(requestKey)) {
      onBusy(requests.busy);
      previous = "";
      return;
    }
    if (requestKey === previous) {
      return;
    }
    previous = requestKey;
    const request = new AbortController();
    const sourceIds = new Set(source.map((element) => element.id));
    const current = () =>
      !request.signal.aborted &&
      !classroomCommands.has("document.draw") &&
      (!target ||
        insertionWritingTargets(boardWritingParts(api.getSceneElements())).some(
          (item) => item.key === target.key && item.stamp === target.stamp,
        )) &&
      selectionSignature(
        api.getSceneElements().filter((element) => sourceIds.has(element.id)),
      ) === signature;
    requests.reserve(
      request,
      source.map((element) => element.id),
      boardInk(source),
      mode,
      current,
    );
    const since = Date.now();
    requests.schedule(
      request,
      () => {
        requests.start(request);
        onBusy(true);
        void (async () => {
          if (mode === "shape") {
            const scene = api.getSceneElements();
            const elementsMap = new Map(scene.map((item) => [item.id, item]));
            const angle = recognizeAngleMark(
              boardInk(source),
              scene.flatMap((element) =>
                element.type === "line" &&
                element.customData?.fcRecognizedSource
                  ? [
                      {
                        id: element.id,
                        points: LinearElementEditor.getPointsGlobalCoordinates(
                          element,
                          elementsMap,
                        ).map(([x, y]): [number, number] => [x, y]),
                      },
                    ]
                  : [],
              ),
            );
            if (angle && current()) {
              const ids = new Set(source.map((item) => item.id));
              const parent = scene.find((item) => item.id === angle.target)!;
              const group = parent.groupIds.at(-1) || parent.id;
              api.updateScene({
                elements: [
                  ...scene
                    .filter((item) => !ids.has(item.id))
                    .map((item) =>
                      item.id === parent.id
                        ? newElementWith(item, {
                            groupIds: [...new Set([...item.groupIds, group])],
                          })
                        : item,
                    ),
                  ...convertToFcboardElements(
                    angle.shapes.map((shape) => ({
                      ...shape,
                      strokeColor: source[0].strokeColor,
                      strokeWidth: source[0].strokeWidth,
                      groupIds: [group],
                      customData: { fcAngleTarget: parent.id },
                    })),
                  ),
                ],
                captureUpdate: CaptureUpdateAction.IMMEDIATELY,
              });
              source.forEach((item) => seen.add(item.id));
              return;
            }
          }
          if (mode === "magic") {
            const [left, top, right, bottom] = getCommonBounds(source);
            await insertMagicInk(
              api,
              async () =>
                (
                  await boardContext(api, false, source, undefined, true, false)
                ).image || "",
              boardInk(source),
              request.signal,
              {
                bounds: { left, top, right, bottom },
                replaceIds: source.map((element) => element.id),
                sourceSignature: signature,
                opacity: source[0].opacity,
              },
              current,
            );
            return;
          }
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
          await settleInkRecognition(
            mode,
            since,
            request.signal,
            boardInk(source),
          );
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
              "text",
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
          const [left, top] = getCommonBounds(source);
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
          const shape: FcboardElementSkeleton = {
            ...recognizedShapeSkeleton(result, boardInk(source)),
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
              if (
                !target &&
                !(
                  failure instanceof DOMException &&
                  failure.name === "AbortError"
                ) &&
                !(
                  failure instanceof Error &&
                  failure.message === "Shape incomplete"
                )
              ) {
                onError(failure);
              }
            }
          })
          .finally(() => {
            requests.finish(request, failed.has(requestKey));
            onBusy(requests.busy);
          });
      },
      inkRecognitionDelay(mode, boardInk(source)),
    );
    // A batched native/multi-writer scene can contain several completed regions.
    // Reserve all independent work now; no region waits for another model to end.
    if (pending.some((element) => requests.available(element.id))) {
      queueMicrotask(() => refresh(true));
    }
  };
  const stop = api.onChange(() => refresh());
  const tables = new LiveTableWriting(api);
  const inkProgress = api.onInkProgress?.((stroke, phase) => {
    if (phase === "start" || phase === "update") {
      const mode = inkAssistMode(stroke.customData?.fcInk?.assist);
      if (mode) {
        requests.revise(boardInk([stroke]), mode);
      }
      previous = "";
      onBusy(requests.busy);
    }
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
      !stroke.customData?.fcInsertion &&
      !stroke.customData?.fcQuestionInput &&
      (!stroke.customData?.fcInk?.assist ||
        stroke.customData.fcInk.assist === "text")
    ) {
      const point = boardInk([stroke])[0]?.[0];
      const target =
        point &&
        insertionWritingAt(
          insertionWritingTargets(boardWritingParts(api.getSceneElements())),
          point,
        );
      if (target && target.insertion.kind !== "table") {
        api.updateScene({
          elements: api.getSceneElements().map((element) =>
            element.id === stroke.id
              ? newElementWith(element, {
                  groupIds: [
                    ...new Set([...stroke.groupIds, target.insertion.id]),
                  ],
                  customData: {
                    ...stroke.customData,
                    fcInsertion: {
                      ...target.insertion,
                      inkCell: target.index,
                      origin: { x: stroke.x, y: stroke.y },
                    },
                  },
                })
              : element,
          ),
          captureUpdate: CaptureUpdateAction.EVENTUALLY,
        });
      }
    }
    if (
      api.getSceneElements().find((item) => item.id === stroke.id)?.customData
        ?.fcInsertion?.kind === "table"
    ) {
      seen.add(stroke.id);
    }
  });
  const invalidate = classroomCommands.onInvalidate(() => {
    requests.cancelAll();
    onBusy(false);
  });
  let board = "";
  const boards = classroomCommands.watch("boards", () => {
    const active =
      (classroomCommands.read("boards") as { active?: string } | undefined)
        ?.active || "";
    if (active !== board) {
      board = active;
      requests.cancelAll();
      onBusy(requests.busy);
      api.getSceneElements().forEach((element) => seen.add(element.id));
    }
  });
  const command = classroomCommands.register(
    "canvas.inkAssist",
    "选择文字/图形/魔术/函数/算式/语言笔，args.mode=text|shape|magic|function|calculation|language|off；停笔后识别，失败保留原笔迹",
    (args) => {
      if (
        ![
          "text",
          "shape",
          "magic",
          "function",
          "calculation",
          "language",
          "off",
        ].includes(String(args.mode))
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
                  | "calculation"
                  | "language"),
          currentItemPenMode: "hard",
          multiStroke: false,
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
    disposed = true;
    requests.cancelAll();
    stop();
    inkCommit?.();
    inkProgress?.();
    tables.clear();
    invalidate();
    boards();
    command();
  };
};
