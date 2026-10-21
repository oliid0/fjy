import { t } from "@excalidraw/excalidraw/i18n";
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import { getCommonBounds } from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElementSkeleton } from "@excalidraw/element/transform";

import { boardContext, chat, parseJSON, visualMessage } from "./ai";
import { classroomCommands } from "./commands";
import { currentSettings } from "./settings";
import { selectionSignature } from "./selection";
import { teachingResources } from "./TeachingResources";
import { recognizeHandwriting } from "./ocr";

/** Smart pen modes keep the real ink until a complete, still-current recognition is ready. */
export const observeInkAssistance = (
  api: ExcalidrawImperativeAPI,
  onBusy: (busy: boolean) => void,
  onError: (failure: unknown) => void,
) => {
  const seen = new Set(api.getSceneElements().map((element) => element.id));
  const failed = new Set<string>();
  let timer: ReturnType<typeof setTimeout>;
  let controller: AbortController | undefined;
  let previous = "";
  const refresh = () => {
    const state = api.getAppState();
    const mode = state.currentItemInkAssist;
    if (
      state.cursorButton === "down" ||
      !mode ||
      state.activeTool.type !== "freedraw"
    ) {
      clearTimeout(timer);
      controller?.abort();
      onBusy(false);
      previous = "";
      return;
    }
    const source = api
      .getSceneElements()
      .filter((element) => element.type === "freedraw")
      .filter(
        (element) =>
          !seen.has(element.id) && element.customData?.fcInk?.assist === mode,
      );
    const signature = selectionSignature(source);
    if (!signature || failed.has(signature)) {
      clearTimeout(timer);
      controller?.abort();
      onBusy(false);
      previous = "";
      return;
    }
    if (signature === previous) {
      return;
    }
    previous = signature;
    clearTimeout(timer);
    controller?.abort();
    const request = new AbortController();
    controller = request;
    timer = setTimeout(() => {
      if (
        mode !== "text" &&
        (!currentSettings().apiKey || !currentSettings().model.trim())
      ) {
        onError(
          new Error(
            t(
              "fcboard.文字 / 图形 / 魔术笔需要先配置视觉模型；原笔迹已保留，可继续书写或圈选",
            ),
          ),
        );
        return;
      }
      const current = () =>
        !request.signal.aborted &&
        selectionSignature(
          api
            .getSceneElements()
            .filter((element) =>
              source.some((input) => input.id === element.id),
            ),
        ) === signature;
      onBusy(true);
      void (async () => {
        const context = await boardContext(api, false, source);
        if (!current()) {
          return;
        }
        const instruction =
          mode === "text"
            ? '逐字识别这段手写文字，不回答问题，仅返回 {"text":"识别结果"}；不确定返回 {"none":true}。'
            : mode === "shape"
            ? '识别手绘几何，只返回 {"shape":"rectangle|ellipse|line|arrow|triangle"} 中最接近的一种。不确定返回 {"none":true}。'
            : `识别手绘图示，从以下本地教学图示选择最接近的一项，仅返回 {"resourceId":"清单中的id"}；不匹配返回 {"none":true}。清单：${JSON.stringify(
                teachingResources
                  .filter((item) => item.asset)
                  .map(({ id, title }) => ({ id, title })),
              )}`;
        const result = (
          mode === "text"
            ? {
                text: await recognizeHandwriting(
                  context.image || "",
                  request.signal,
                  () => {},
                ),
              }
            : parseJSON(
                await chat(
                  [visualMessage(instruction, context.image)],
                  request.signal,
                ),
              )
        ) as {
          text?: unknown;
          shape?: unknown;
          resourceId?: unknown;
          none?: unknown;
        };
        if (!current()) {
          return;
        }
        if (result?.none === true) {
          failed.add(signature);
          return;
        }
        const [left, top, right, bottom] = getCommonBounds(source);
        if (mode === "magic") {
          if (
            typeof result?.resourceId !== "string" ||
            !teachingResources.some(
              (item) => item.id === result.resourceId && item.asset,
            )
          ) {
            throw new Error(
              t("fcboard.魔术笔没有识别到匹配的本地图示，原笔迹已保留"),
            );
          }
          await classroomCommands.execute({
            name: "resources.use",
            args: {
              id: result.resourceId,
              x: left,
              y: top,
              size: Math.max(40, right - left, bottom - top),
              replaceIds: source.map((element) => element.id),
              sourceSignature: signature,
              signal: request.signal,
            },
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
        let shape: ExcalidrawElementSkeleton;
        if (mode === "text") {
          if (
            typeof result?.text !== "string" ||
            !result.text.trim() ||
            result.text.length > 4000
          ) {
            throw new Error(t("fcboard.文字笔返回格式无效，原笔迹已保留"));
          }
          shape = {
            ...style,
            type: "text",
            x: left,
            y: top,
            text: result.text,
            fontFamily: 2,
            fontSize: Math.max(
              12,
              Math.min(
                160,
                (bottom - top) /
                  Math.max(1, result.text.split("\n").length) /
                  1.25,
              ),
            ),
          };
        } else {
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
            throw new Error(t("fcboard.图形笔返回格式无效，原笔迹已保留"));
          }
        }
        if (!current()) {
          return;
        }
        const ids = new Set(source.map((element) => element.id));
        api.updateScene({
          elements: [
            ...api.getSceneElements().filter((element) => !ids.has(element.id)),
            ...convertToExcalidrawElements([shape]),
          ],
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
      })()
        .catch((failure) => {
          if (!request.signal.aborted) {
            failed.add(signature);
            if (failed.size > 100) {
              failed.delete(failed.values().next().value!);
            }
            onError(failure);
          }
        })
        .finally(() => {
          if (controller === request) {
            onBusy(false);
          }
        });
    }, 700);
  };
  const stop = api.onChange(refresh);
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
    "选择文字/图形/魔术笔，args.mode=text|shape|magic|off；停笔后识别并保留失败时的原笔迹",
    (args) => {
      if (!["text", "shape", "magic", "off"].includes(String(args.mode))) {
        throw new Error(t("fcboard.智能笔型不存在"));
      }
      api.updateScene({
        appState: {
          currentItemInkAssist:
            args.mode === "off"
              ? undefined
              : (args.mode as "text" | "shape" | "magic"),
          currentItemPenMode: "hard",
        },
      });
      api.setActiveTool({ type: "freedraw" });
    },
  );
  return () => {
    clearTimeout(timer);
    controller?.abort();
    stop();
    invalidate();
    boards();
    command();
  };
};
