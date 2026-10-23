import { t } from "@excalidraw/excalidraw/i18n";
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import { getCommonBounds } from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElementSkeleton } from "@excalidraw/element/transform";

import { boardContext } from "./ai";
import { classroomCommands } from "./commands";
import { currentSettings } from "./settings";
import { selectionSignature } from "./selection";
import { boardInk } from "./digitalInk";
import { insertText } from "./board";
import { inkAssistMode, recognizeInkContent } from "./inkRecognition";

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
  const configuration = () => {
    const state = api.getAppState();
    return JSON.stringify([
      state.currentItemInkAssist,
      state.currentItemPenMode,
      state.whiteboardPenTip,
      state.whiteboardPenTips,
      state.whiteboardDualPen,
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
    const pending = api
      .getSceneElements()
      .filter((element) => element.type === "freedraw")
      .filter(
        (element) =>
          !seen.has(element.id) &&
          inkAssistMode(element.customData?.fcInk?.assist),
      );
    const mode = inkAssistMode(pending.at(-1)?.customData?.fcInk?.assist);
    const source = pending.filter(
      (element) => element.customData?.fcInk?.assist === mode,
    );
    const signature = selectionSignature(source);
    if (!mode || !signature || failed.has(signature)) {
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
        (mode === "shape" || mode === "magic") &&
        (!currentSettings().apiKey || !currentSettings().model.trim())
      ) {
        failed.add(signature);
        return;
      }
      const current = () =>
        !request.signal.aborted &&
        !classroomCommands.has("document.draw") &&
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
        );
        if (!current()) {
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
                /=\s*$/.test(text) || /^[xyz] =/.test(result.answer) ? "" : "= "
              }${result.answer}`,
              undefined,
              { fcSelectionSource: signature },
              source,
              "match",
              { mode: "inline", sourceLines: text.split("\n").length },
            );
          }
          source.forEach((element) => seen.add(element.id));
          return;
        }
        const [left, top, right, bottom] = getCommonBounds(source);
        if (result.kind === "magic") {
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
        if (result.kind === "text") {
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
          throw new Error(t("fcboard.图形笔返回格式无效，原笔迹已保留"));
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
            if (mode !== "function" && mode !== "calculation") {
              onError(failure);
            }
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
    "选择文字/图形/魔术/函数/算式笔，args.mode=text|shape|magic|function|calculation|off；停笔后识别，失败保留原笔迹",
    (args) => {
      if (
        !["text", "shape", "magic", "function", "calculation", "off"].includes(
          String(args.mode),
        )
      ) {
        throw new Error(t("fcboard.智能笔型不存在"));
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
    invalidate();
    boards();
    command();
  };
};
