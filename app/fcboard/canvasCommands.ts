import { t } from "@fcboard/fcboard/i18n";
import {
  CaptureUpdateAction,
  convertToFcboardElements,
} from "@fcboard/fcboard";
import { getCommonBounds, newIframeElement } from "@fcboard/element";
import { validateInteractiveResource } from "@fcboard/fcboard/interactiveHtml";
import { FONT_FAMILY } from "@fcboard/common";
import { switchWhiteboardPen } from "@fcboard/fcboard/whiteboardPen";

import type { ActionName } from "@fcboard/fcboard/actions/types";

import type { FcboardImperativeAPI, UIOptions } from "@fcboard/fcboard/types";

import { boardContext, selectedBoardElements } from "./ai";
import {
  insertElements,
  insertionPoint,
  insertText,
  validateShapes,
  contentViewport,
  objectSelection,
  styleFunctionPlots,
} from "./board";
import { currentSettings } from "./settings";
import { insertGeneratedImage } from "./imageGeneration";
import { documentStrokeBounds } from "./documents";
import {
  alignmentOffset,
  resizeAnchor,
  transformBoardElement,
} from "./canvasTransform";
import { classroomCommands, commandObjectIds } from "./commands";
import { LessonCanvas, validateLesson } from "./lesson";
import { prepareInkWriting, inkStrokeStyle } from "./inkWriting";
import { resourcePlacement } from "./resourcePlacement";
import { registerResourceCommands } from "./resourceControls";
import { registerLanguageCommands } from "./languageCommands";
import { inkAssistMode } from "./inkRecognition";
import {
  configureCanvas,
  readCanvasConfiguration,
} from "./canvasConfiguration";

import type { InkStroke } from "./documents";
import type { ContentRect } from "./placement";

const actions = new Set<ActionName>([
  "undo",
  "redo",
  "selectAll",
  "duplicateSelection",
  "group",
  "ungroup",
  "sendBackward",
  "bringForward",
  "sendToBack",
  "bringToFront",
  "zoomIn",
  "zoomOut",
  "zoomToFit",
  "zoomToFitSelection",
  "resetZoom",
  "toggleFullScreen",
  "gridMode",
  "objectsSnapMode",
  "zenMode",
  "flipHorizontal",
  "flipVertical",
  "alignTop",
  "alignBottom",
  "alignLeft",
  "alignRight",
  "alignVerticallyCentered",
  "alignHorizontallyCentered",
  "distributeHorizontally",
  "distributeVertically",
  "copy",
  "cut",
  "copyAsPng",
  "copyAsSvg",
  "copyText",
  "copyStyles",
  "pasteStyles",
  "bindText",
  "unbindText",
  "increaseFontSize",
  "decreaseFontSize",
  "toggleElementLock",
  "unlockAllElements",
  "setFrameAsActiveTool",
  "wrapSelectionInFrame",
  "selectAllElementsInFrame",
  "removeAllElementsFromFrame",
  "toggleLassoTool",
  "toggleHandTool",
  "toggleEraserTool",
  "cropEditor",
  "autoResize",
  "searchMenu",
  "stats",
]);
export const registerCanvasCommands = (
  api: FcboardImperativeAPI,
  inkProfile: () => UIOptions["inkProfile"] = () => undefined,
) => {
  const animations = new Set<LessonCanvas>();
  const configurations = new Set<AbortController>();
  const inspect = () => {
    const document = classroomCommands.read("document") as
      | {
          id?: string;
          name?: string;
          page?: number;
          tool?: string;
          pen?: {
            color: string;
            penWidth: number;
            fontSize: number;
            opacity: number;
          };
          selection?: string[];
          configuration?: ReturnType<typeof readCanvasConfiguration>;
          ink?: InkStroke[];
        }
      | undefined;
    if (document) {
      const layout = classroomCommands.read("document.layout") as
        | { scale: number; viewport: ContentRect }
        | undefined;
      const ink = document.ink || [];
      return {
        target: {
          kind: "document",
          id: document.id,
          name: document.name,
          page: document.page,
        },
        coordinates: "document",
        viewport: layout?.viewport,
        scale: layout?.scale,
        revision: classroomCommands.revision,
        tool: document.tool,
        styles: document.pen,
        ...(document.configuration
          ? { configuration: document.configuration }
          : {}),
        fonts: FONT_FAMILY,
        selection: document.selection || [],
        total: ink.length,
        truncated: ink.length > 300,
        elements: ink.slice(-300).map((stroke) => {
          const bounds = documentStrokeBounds(stroke);
          return {
            id: stroke.id,
            type: stroke.resource
              ? "iframe"
              : stroke.text
              ? "text"
              : stroke.image
              ? "image"
              : "freedraw",
            bounds: [bounds.left, bounds.top, bounds.right, bounds.bottom],
            text: stroke.resource?.title || stroke.text,
            interactive: stroke.resource ? true : undefined,
            color: stroke.color,
            width: stroke.width,
            fontSize: stroke.fontSize,
            fontFamily: stroke.fontFamily,
            opacity: stroke.opacity,
            tutorId: stroke.commandId,
            lessonId: stroke.lesson,
          };
        }),
      };
    }
    const state = api.getAppState();
    const elements = api
      .getSceneElements()
      .filter((element) => !element.isDeleted);
    return {
      target: {
        kind: "whiteboard",
        id:
          (classroomCommands.read("boards") as { active?: string } | undefined)
            ?.active || api.id,
      },
      coordinates: "scene",
      viewport: contentViewport(api),
      scale: state.zoom.value,
      revision: classroomCommands.revision,
      tool: state.activeTool?.type,
      styles: {
        color: state.currentItemStrokeColor,
        background: state.currentItemBackgroundColor,
        width: state.currentItemStrokeWidth,
        fontSize: state.currentItemFontSize,
        fontFamily: state.currentItemFontFamily,
        opacity: state.currentItemOpacity,
        textAlign: state.currentItemTextAlign,
      },
      configuration: readCanvasConfiguration(api, inkProfile()),
      fonts: FONT_FAMILY,
      selection: selectedBoardElements(api).map((element) => element.id),
      total: elements.length,
      truncated: elements.length > 300,
      elements: elements.slice(-300).map((element) => ({
        id: element.id,
        type: element.type,
        bounds: getCommonBounds([element]),
        text:
          element.type === "text"
            ? element.text
            : element.customData?.fcWrittenText ||
              element.customData?.fcInteractiveResource?.title,
        color: element.strokeColor,
        fontSize: element.type === "text" ? element.fontSize : undefined,
        fontFamily: element.type === "text" ? element.fontFamily : undefined,
        opacity: element.opacity,
        tutorId: element.customData?.fcTutorId,
        lessonId: element.customData?.fcLessonId,
        interactive: element.customData?.fcInteractiveResource
          ? true
          : undefined,
      })),
    };
  };
  const registrations = [
    classroomCommands.register("canvas.snapshot", "@internal", async (args) => {
      const signal =
        args.signal instanceof AbortSignal ? args.signal : undefined;
      signal?.throwIfAborted();
      const snapshot = classroomCommands.has("document.snapshot")
        ? await classroomCommands.execute({
            name: "document.snapshot",
            args: { capture: args.capture !== false },
          })
        : await boardContext(
            api,
            !Array.isArray(args.sourceIds) || !args.sourceIds.length,
            Array.isArray(args.sourceIds) && args.sourceIds.length
              ? api
                  .getSceneElements()
                  .filter(
                    (element) =>
                      args.sourceIds &&
                      (args.sourceIds as string[]).includes(element.id),
                  )
              : undefined,
            contentViewport(api),
            args.capture !== false,
          );
      signal?.throwIfAborted();
      return snapshot;
    }),
    registerResourceCommands(api),
    registerLanguageCommands(api),
    classroomCommands.register(
      "canvas.configure",
      "Configure the existing controls. Read canvas.inspect.configuration first. args: backgroundColor=#RRGGBB, backgroundPattern=0 (none) or 1..13; tip=fine|thick; dualPen=boolean (requires thickThreshold or device calibration); thickThreshold=1..240, brushVariation=0..50, palmEraser=boolean, palmThreshold=16..120, eraserMode=stroke|object, eraserSize=12..240; multiStroke and toolbarReversed=boolean. Sizes and thresholds use CSS pixels. Background and multiStroke apply only to the whiteboard. Returns actual committed configuration; never changes existing handwriting.",
      async ({ signal, ...input }) => {
        if (signal !== undefined && !(signal instanceof AbortSignal)) {
          throw new Error(t("fcboard.invalid_style_parameters"));
        }
        const request = new AbortController();
        const cancel = () => request.abort();
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) {
          cancel();
        }
        configurations.add(request);
        try {
          return await configureCanvas(
            api,
            input,
            inkProfile(),
            request.signal,
          );
        } finally {
          signal?.removeEventListener("abort", cancel);
          configurations.delete(request);
        }
      },
    ),
    classroomCommands.register(
      "canvas.inspect",
      "Inspect actual objects, selection, pen, writable viewport and zoom on the visible board/document layer. bounds=[left,top,right,bottom]; use the returned coordinates. Inspect before/after changes; never operate on a hidden board.",
      inspect,
    ),
    classroomCommands.register(
      "canvas.toolbar",
      "Show or hide the original board toolbar; boolean args.visible is required. Hiding also closes properties and menus.",
      (args) => {
        if (typeof args.visible !== "boolean") {
          throw new Error(t("fcboard.specify_whether_to_show_the_toolbar"));
        }
        api.updateScene({
          appState: { toolbarHidden: !args.visible, openMenu: null },
        });
      },
    ),
    classroomCommands.register(
      "canvas.action",
      `Perform an existing board action; args.action must be ${Array.from(
        actions,
      ).join(",")}`,
      (args) => {
        if (classroomCommands.has("document.draw")) {
          if (
            [
              "zoomIn",
              "zoomOut",
              "resetZoom",
              "zoomToFit",
              "zoomToFitSelection",
            ].includes(String(args.action))
          ) {
            return classroomCommands.execute({ name: "document.zoom", args });
          }
          if (
            [
              "bringForward",
              "sendBackward",
              "bringToFront",
              "sendToBack",
              "toggleElementLock",
            ].includes(String(args.action))
          ) {
            return classroomCommands.execute({ name: "document.action", args });
          }
          if (args.action === "duplicateSelection") {
            return classroomCommands.execute({ name: "document.duplicate" });
          }
          if (args.action === "selectAll") {
            const document = classroomCommands.read("document") as
              | { ink?: InkStroke[] }
              | undefined;
            return classroomCommands.execute({
              name: "document.select",
              args: { ids: (document?.ink || []).map((stroke) => stroke.id) },
            });
          }
          if (args.action === "undo" || args.action === "redo") {
            return classroomCommands.execute({
              name: `document.${args.action}`,
            });
          }
          throw new Error(
            t(
              "fcboard.this_action_is_for_the_board_in_a_document_turn_pages_annotate_circle_undo_or_describe_what_to",
            ),
          );
        }
        if (!actions.has(args.action as ActionName)) {
          throw new Error(t("fcboard.this_board_action_is_unavailable"));
        }
        api.executeAction(args.action as ActionName);
      },
    ),
    classroomCommands.register(
      "canvas.tool",
      "Switch the current visible surface tool: args.tool=selection|lasso|freedraw|eraser|text|rectangle|ellipse|diamond|line|arrow|hand|image|frame|laser. selection/lasso use the factory circle selector. For eraser, optional args.eraserMode=stroke|object and args.eraserSize=12..240 configure the real eraser before switching.",
      async (args) => {
        if (args.eraserMode !== undefined || args.eraserSize !== undefined) {
          if (args.tool !== "eraser") {
            throw new Error(t("fcboard.invalid_style_parameters"));
          }
          await classroomCommands.execute({
            name: "canvas.configure",
            args: {
              ...(args.eraserMode !== undefined
                ? { eraserMode: args.eraserMode }
                : {}),
              ...(args.eraserSize !== undefined
                ? { eraserSize: args.eraserSize }
                : {}),
              ...(args.signal instanceof AbortSignal
                ? { signal: args.signal }
                : {}),
            },
          });
        }
        if (args.signal instanceof AbortSignal) {
          args.signal.throwIfAborted();
        }
        if (classroomCommands.has("document.tool")) {
          return classroomCommands.execute({
            name: "document.tool",
            args: {
              ...args,
              tool: args.tool === "lasso" ? "selection" : args.tool,
            },
          });
        }
        const tools = [
          "selection",
          "lasso",
          "freedraw",
          "eraser",
          "text",
          "rectangle",
          "ellipse",
          "diamond",
          "line",
          "arrow",
          "hand",
          "image",
          "frame",
          "laser",
        ] as const;
        const tool = tools.find((value) => value === args.tool);
        if (!tool) {
          throw new Error(t("fcboard.unknown_tool"));
        }
        api.setActiveTool({ type: tool === "selection" ? "lasso" : tool });
        return { tool: api.getAppState().activeTool };
      },
    ),
    classroomCommands.register("canvas.editText", "@internal", () => {
      if (classroomCommands.has("document.editText")) {
        return classroomCommands.execute({ name: "document.editText" });
      }
      const selected = selectedBoardElements(api);
      if (
        selected.length !== 1 ||
        selected[0].type !== "text" ||
        !api.editTextElement(selected[0].id)
      ) {
        throw new Error(t("fcboard.this_board_action_is_unavailable"));
      }
    }),
    classroomCommands.register(
      "canvas.style",
      "Style the pen or selection: args.color/background are hex (background also transparent); width=1..30,fontSize=8..200,fontWeight=400|700,fontFamily=1|2|3|5|6|7|8|9|10,opacity=0..100,roughness=0..2,textAlign=left|center|right,fillStyle=hachure|cross-hatch|solid|zigzag,strokeStyle=solid|dashed|dotted. pen=hard|brush|highlighter|dashed|rainbow|text|shape|magic|function|calculation|language controls future handwriting.",
      (args) => {
        if (classroomCommands.has("document.style")) {
          return classroomCommands.execute({ name: "document.style", args });
        }
        const supported = [
          "color",
          "background",
          "width",
          "fontSize",
          "fontFamily",
          "fontWeight",
          "opacity",
          "roughness",
          "textAlign",
          "fillStyle",
          "strokeStyle",
          "pen",
        ];
        if (
          !Object.keys(args).length ||
          Object.keys(args).some((key) => !supported.includes(key))
        ) {
          throw new Error(t("fcboard.invalid_style_parameters"));
        }
        const pen = (
          ["hard", "brush", "highlighter", "dashed", "rainbow"] as const
        ).find((value) => value === args.pen);
        const assist = inkAssistMode(args.pen);
        if (args.pen !== undefined && !pen && !assist) {
          throw new Error(t("fcboard.unknown_pen_type"));
        }
        for (const key of ["color", "background"] as const) {
          if (
            args[key] !== undefined &&
            (typeof args[key] !== "string" ||
              (!/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(args[key] as string) &&
                !(key === "background" && args[key] === "transparent")))
          ) {
            throw new Error(t("fcboard.invalid_color"));
          }
        }
        const numeric: Record<string, [number, number, ActionName]> = {
          fontSize: [8, 200, "changeFontSize"],
          opacity: [0, 100, "changeOpacity"],
          roughness: [0, 2, "changeSloppiness"],
        };
        for (const [key, [min, max]] of Object.entries(numeric)) {
          if (
            args[key] !== undefined &&
            (typeof args[key] !== "number" ||
              !Number.isFinite(args[key]) ||
              (args[key] as number) < min ||
              (args[key] as number) > max)
          ) {
            throw new Error(t("fcboard.style_key_is_out_of_range", { key }));
          }
        }
        const choices: Record<string, [string[], ActionName]> = {
          textAlign: [["left", "center", "right"], "changeTextAlign"],
          fillStyle: [
            ["hachure", "cross-hatch", "solid", "zigzag"],
            "changeFillStyle",
          ],
          strokeStyle: [["solid", "dashed", "dotted"], "changeStrokeStyle"],
        };
        for (const [key, [values]] of Object.entries(choices)) {
          if (args[key] !== undefined && !values.includes(String(args[key]))) {
            throw new Error(t("fcboard.invalid_style_key", { key }));
          }
        }
        if (
          args.fontFamily !== undefined &&
          !Object.values(FONT_FAMILY).includes(
            args.fontFamily as typeof FONT_FAMILY.Helvetica,
          )
        ) {
          throw new Error(t("fcboard.unknown_font"));
        }
        if (
          args.fontWeight !== undefined &&
          args.fontWeight !== 400 &&
          args.fontWeight !== 700
        ) {
          throw new Error(t("fcboard.invalid_style_parameters"));
        }
        const textIds = new Set(
          (args.fontWeight !== undefined ? selectedBoardElements(api) : [])
            .filter((element) => element.type === "text" && !element.locked)
            .map((element) => element.id),
        );
        if (args.fontWeight !== undefined && !textIds.size) {
          throw new Error(t("fcboard.invalid_style_parameters"));
        }
        if (
          args.width !== undefined &&
          (typeof args.width !== "number" ||
            !Number.isFinite(args.width) ||
            args.width < 1 ||
            args.width > 30)
        ) {
          throw new Error(t("fcboard.pen_width_out_of_range"));
        }
        if (pen || assist) {
          api.setActiveTool({ type: "freedraw" });
          api.updateScene({
            appState: {
              selectedElementIds: {},
              selectedGroupIds: {},
              whiteboardSelection: undefined,
              ...switchWhiteboardPen(api.getAppState(), pen || "hard"),
              currentItemInkAssist: assist,
            },
          });
        }
        const graphsOnly = styleFunctionPlots(api, {
          color: args.color as string | undefined,
          width: args.width as number | undefined,
          strokeStyle: args.strokeStyle as
            | "solid"
            | "dashed"
            | "dotted"
            | undefined,
        });
        if (args.color) {
          if (!graphsOnly) {
            api.executeAction("changeStrokeColor", {
              currentItemStrokeColor: args.color,
            });
          }
        }
        if (args.background) {
          api.executeAction("changeBackgroundColor", {
            currentItemBackgroundColor: args.background,
          });
        }
        if (args.width && !graphsOnly) {
          api.executeAction("changeStrokeWidth", args.width);
        }
        for (const [key, [, , action]] of Object.entries(numeric)) {
          if (args[key] !== undefined) {
            api.executeAction(action, args[key]);
          }
        }
        for (const [key, [, action]] of Object.entries(choices)) {
          if (
            args[key] !== undefined &&
            !(graphsOnly && key === "strokeStyle")
          ) {
            api.executeAction(action, args[key]);
          }
        }
        if (args.fontWeight !== undefined) {
          api.executeAction("changeFontWeight", args.fontWeight);
        }
        if (args.fontFamily !== undefined) {
          api.executeAction("changeFontFamily", {
            currentItemFontFamily: args.fontFamily,
          });
        }
      },
    ),
    classroomCommands.register(
      "canvas.ink",
      "Insert editable ink on the visible surface. args.strokes contains [[x,y],...] trajectories. Optional per-command pen=hard|brush|highlighter|dashed|rainbow, color (hex), width=1..30 and opacity=0..100 use real pen effects without changing the global pen. Optional args.text is dictated text; also supply args.bounds={left,top,right,bottom} to wrap handwriting within that visible area. args.replaceIds atomically replaces the specified source objects. Returns actual object ids.",
      async (args) => {
        if (args.signal instanceof AbortSignal) {
          args.signal.throwIfAborted();
        }
        if (classroomCommands.has("document.draw")) {
          return classroomCommands.execute({ name: "document.strokes", args });
        }
        const board = () =>
          (classroomCommands.read("boards") as { active?: string } | undefined)
            ?.active || api.id;
        const target = board();
        const replaced = commandObjectIds(
          args.replaceIds ?? [],
          api.getSceneElements(),
          true,
        );
        const signature = () =>
          JSON.stringify(
            api.getSceneElements().filter((item) => replaced.has(item.id)),
          );
        const before = signature();
        const elements = await prepareInkWriting(args, () => {
          if (
            classroomCommands.has("document.draw") ||
            board() !== target ||
            signature() !== before
          ) {
            throw new DOMException("Question target changed", "AbortError");
          }
          const state = api.getAppState();
          return {
            viewport: contentViewport(api),
            obstacles: api
              .getSceneElements()
              .filter((item) => !replaced.has(item.id))
              .map((item) => {
                const [left, top, right, bottom] = getCommonBounds([item]);
                return { left, top, right, bottom };
              }),
            scale: state.zoom.value,
            inkStyle: inkStrokeStyle(
              args,
              state,
              inkProfile(),
              state.zoom.value,
            ),
            fontSize: (state.currentItemFontSize || 24) / state.zoom.value,
            color: state.currentItemStrokeColor || "#000000",
            width: state.currentItemStrokeWidth || 2,
            opacity: state.currentItemOpacity ?? 100,
          };
        });
        if (args.signal instanceof AbortSignal) {
          args.signal.throwIfAborted();
        }
        if (
          classroomCommands.has("document.draw") ||
          board() !== target ||
          signature() !== before
        ) {
          throw new DOMException("Question target changed", "AbortError");
        }
        api.updateScene({
          elements: [
            ...api.getSceneElements().filter((item) => !replaced.has(item.id)),
            ...elements,
          ],
          ...(args.select === false
            ? {}
            : { appState: objectSelection(elements) }),
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        return { ids: elements.map((element) => element.id) };
      },
    ),
    classroomCommands.register(
      "canvas.text",
      'Insert or update editable text; args.text is required. args.id updates existing text. Without id, insert beside the selection using its color/size. args.presentation=match|handwritten|text; placement=center finds space in the current visible canvas independently of previous selection. For titles use {"text":"complete title","role":"title","presentation":"handwritten","placement":"center","sourceIds":[]}, laid out at 36 screen pixels; body text follows nearby handwriting.',
      async (args) => {
        if (args.signal instanceof AbortSignal) {
          args.signal.throwIfAborted();
        }
        if (
          typeof args.text !== "string" ||
          !args.text.trim() ||
          args.text.length > 10000
        ) {
          throw new Error(t("fcboard.text_is_empty_or_too_long"));
        }
        if (
          args.presentation !== undefined &&
          !["match", "handwritten", "text"].includes(String(args.presentation))
        ) {
          throw new Error(t("fcboard.unknown_answer_style"));
        }
        if (args.role !== undefined && args.role !== "title") {
          throw new Error(t("fcboard.invalid_style_parameters"));
        }
        if (
          !args.id &&
          args.presentation === "handwritten" &&
          currentSettings().handwritingGeneration === "cloud" &&
          currentSettings().apiKey.trim()
        ) {
          const signal =
            args.signal instanceof AbortSignal
              ? args.signal
              : AbortSignal.timeout(90000);
          try {
            await insertGeneratedImage(
              api,
              `Render only this exact text as clear handwritten board writing, preserving every character, mathematical symbol and line break. No extra text, illustrations or decorations. Text: ${JSON.stringify(
                args.text,
              )}`,
              signal,
            );
            return;
          } catch (error) {
            signal.throwIfAborted();
            if (error instanceof DOMException && error.name === "AbortError") {
              throw error;
            }
          }
          // A failed optional output provider cannot disable local text writing.
        }
        if (classroomCommands.has("document.draw")) {
          return classroomCommands.execute({ name: "document.text", args });
        }
        const existing = args.id
          ? api
              .getSceneElements()
              .find((el) => el.id === args.id && el.type === "text")
          : undefined;
        if (args.id && !existing) {
          throw new Error(t("fcboard.text_to_edit_not_found"));
        }
        if (existing?.type === "text") {
          const next = convertToFcboardElements(
            [
              {
                ...existing,
                type: "text",
                text: args.text,
                originalText: args.text,
                version: existing.version + 1,
                ...(args.presentation === "handwritten"
                  ? { fontFamily: FONT_FAMILY.Excalifont }
                  : args.presentation === "text"
                  ? { fontFamily: FONT_FAMILY.Helvetica }
                  : {}),
              },
            ],
            { regenerateIds: false },
          );
          api.updateScene({
            elements: api
              .getSceneElements()
              .flatMap((el) => (el.id === existing.id ? next : [el])),
            captureUpdate: CaptureUpdateAction.IMMEDIATELY,
          });
        } else {
          const source =
            args.sourceIds !== undefined
              ? (() => {
                  const ids = commandObjectIds(
                    args.sourceIds,
                    api.getSceneElements(),
                    true,
                  );
                  return api
                    .getSceneElements()
                    .filter((element) => ids.has(element.id));
                })()
              : selectedBoardElements(api);
          insertText(
            api,
            args.text,
            undefined,
            undefined,
            args.placement === "center" ? undefined : source,
            args.presentation as "match" | "handwritten" | "text" | undefined,
            {
              role: args.role as "title" | undefined,
              mode:
                args.placement === "center"
                  ? "center"
                  : args.placement === "inline"
                  ? "inline"
                  : "below",
            },
          );
        }
      },
    ),
    classroomCommands.register(
      "canvas.resource",
      "Insert a self-contained interactive HTML lesson in the currently visible surface. args.resource contains id,title,html; prefer resources.generate to create it. Returns actual object ids. Code runs only in an isolated iframe and cannot call host tools.",
      async (args) => {
        if (args.signal instanceof AbortSignal) {
          args.signal.throwIfAborted();
        }
        const resource = validateInteractiveResource(args.resource);
        if (classroomCommands.has("document.resource")) {
          return classroomCommands.execute({
            name: "document.resource",
            args: { ...args, resource },
          });
        }
        const viewport = contentViewport(api);
        const scale = api.getAppState().zoom.value;
        const position = resourcePlacement(
          viewport,
          scale,
          resource.id === "builtin-calculator",
        );
        const ids = insertElements(api, [
          newIframeElement({
            type: "iframe",
            ...position,
            strokeWidth: 0,
            customData: {
              fcInteractiveResource: resource,
              generationData: { status: "done", html: resource.html },
            },
          }),
        ]);
        api.setActiveTool({ type: "lasso" });
        return { ids };
      },
    ),
    classroomCommands.register(
      "canvas.shapes",
      "Insert editable shapes: args.shapes contains rectangle|ellipse|diamond|line|arrow|text with x,y,width,height relative to the selection; text shapes also need text.",
      async (args) => {
        const origin = insertionPoint(api);
        if (classroomCommands.has("document.draw")) {
          const shapes = validateShapes(args.shapes);
          for (const shape of shapes) {
            await classroomCommands.execute({
              name: "document.draw",
              args: {
                lesson: "voice",
                progress: 1,
                shape: {
                  ...shape,
                  id: crypto.randomUUID(),
                  x: 32 + (shape.x || 0),
                  y: 32 + (shape.y || 0),
                },
              },
            });
          }
          return;
        }
        insertElements(
          api,
          validateShapes(args.shapes).map((shape) => ({
            ...shape,
            x: origin.x + (shape.x || 0),
            y: origin.y + (shape.y || 0),
          })),
          [],
          true,
        );
      },
    ),
    classroomCommands.register(
      "canvas.animate",
      'Animate incremental board writing using a flat args.commands array, for example {"commands":[{"type":"write_text","id":"note","text":"board text","x":0,"y":0,"duration":0.8}]}. Internal commands use type, never nested name/args. Types include write_text/draw_path/draw_arrow with id,x,y,width,height,text,points,color,duration. Returns lessonId and real objects. Inspect lessonId/tutorId before correcting, pass args.lessonId and reuse command.id=tutorId to preserve position/size/color. Use canvas.text role=title for independent titles.',
      async (args) => {
        const signal =
          args.signal instanceof AbortSignal ? args.signal : undefined;
        signal?.throwIfAborted();
        if (
          args.lessonId !== undefined &&
          (typeof args.lessonId !== "string" ||
            !inspect().elements.some(
              (element) => element.lessonId === args.lessonId,
            ))
        ) {
          throw new DOMException(
            "Writing to revise is no longer visible",
            "AbortError",
          );
        }
        const lesson = validateLesson({
          title: t("fcboard.aiMessages.boardActions"),
          steps: [{ say: "", commands: args.commands }],
          quiz: [],
        });
        const renderer = new LessonCanvas(api, {
          id: args.lessonId as string | undefined,
          sourceIds: [],
        });
        const abort = () => renderer.cancel();
        signal?.addEventListener("abort", abort, { once: true });
        animations.add(renderer);
        try {
          await renderer.prepareStep(lesson.steps[0].commands);
          for (const command of lesson.steps[0].commands) {
            await renderer.command(
              command,
              1,
              matchMedia("(prefers-reduced-motion: reduce)").matches,
            );
          }
        } finally {
          signal?.removeEventListener("abort", abort);
          animations.delete(renderer);
        }
        return {
          lessonId: renderer.id,
          elements: inspect().elements.filter(
            (element) => element.lessonId === renderer.id,
          ),
        };
      },
    ),
    classroomCommands.register(
      "canvas.erase",
      "Erase objects identified by args.ids, or only the current selection when omitted.",
      (args) => {
        if (classroomCommands.has("document.erase")) {
          return classroomCommands.execute({ name: "document.erase", args });
        }
        const ids =
          args.ids === undefined
            ? selectedBoardElements(api).map((el) => el.id)
            : args.ids;
        const selected = commandObjectIds(ids, api.getSceneElements());
        api.updateScene({
          elements: api.getSceneElements().filter((el) => !selected.has(el.id)),
          appState: { selectedElementIds: {}, whiteboardSelection: undefined },
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        return { ids: [...selected] };
      },
    ),
    classroomCommands.register(
      "canvas.clear",
      "Clear the current whiteboard only when the user explicitly requests it.",
      () =>
        classroomCommands.has("document.clearInk")
          ? classroomCommands.execute({ name: "document.clearInk" })
          : api.updateScene({
              elements: [],
              appState: {
                selectedElementIds: {},
                whiteboardSelection: undefined,
              },
              captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            }),
    ),
    classroomCommands.register(
      "canvas.select",
      "Select existing objects using the ID array in args.ids.",
      async (args) => {
        if (classroomCommands.has("document.select")) {
          const result = await classroomCommands.execute({
            name: "document.select",
            args,
          });
          if (
            Array.isArray(args.ids) &&
            args.ids.length &&
            classroomCommands.has("document.tool")
          ) {
            await classroomCommands.execute({
              name: "document.tool",
              args: { tool: "selection" },
            });
          }
          return result;
        }
        const ids = commandObjectIds(args.ids, api.getSceneElements(), true);
        if (ids.size) {
          api.setActiveTool({ type: "lasso" });
        }
        api.updateScene({
          appState: {
            whiteboardSelection: undefined,
            selectedElementIds: Object.fromEntries(
              api
                .getSceneElements()
                .filter((el) => ids.has(el.id))
                .map((el) => [el.id, true]),
            ),
          },
        });
        return { ids: [...ids] };
      },
    ),
    classroomCommands.register(
      "canvas.resize",
      "Uniformly scale selected objects or args.ids, including real handwriting/text. args.scale=0.1..10; args.anchor=center (default)|top-left. Inspect real IDs and include all title strokes/groups/bound text. Preserve relative layout, pen style and editable parameters; return actual bounds.",
      (args) => {
        if (classroomCommands.has("document.resize")) {
          return classroomCommands.execute({ name: "document.resize", args });
        }
        const elements = api.getSceneElements();
        const ids = commandObjectIds(
          args.ids === undefined
            ? selectedBoardElements(api).map((element) => element.id)
            : args.ids,
          elements,
        );
        const selected = elements.filter((element) => ids.has(element.id));
        const [left, top, right, bottom] = getCommonBounds(selected);
        const anchor = resizeAnchor(args, { left, top, right, bottom });
        const next = elements.map((element) =>
          ids.has(element.id)
            ? transformBoardElement(element, anchor, args.scale as number)
            : element,
        );
        api.updateScene({
          elements: next,
          appState: { whiteboardSelection: undefined },
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        return {
          ids: [...ids],
          scale: args.scale,
          bounds: getCommonBounds(
            next.filter((element) => ids.has(element.id)),
          ),
        };
      },
    ),
    classroomCommands.register(
      "canvas.align",
      "Align selected objects or args.ids as a group inside the visible canvas, preserving internal layout. args.horizontal=left|center|right; args.vertical=top|center|bottom; provide at least one. Return actual displacement/bounds.",
      (args) => {
        if (classroomCommands.has("document.align")) {
          return classroomCommands.execute({ name: "document.align", args });
        }
        const elements = api.getSceneElements();
        const ids = commandObjectIds(
          args.ids === undefined
            ? selectedBoardElements(api).map((element) => element.id)
            : args.ids,
          elements,
        );
        const [left, top, right, bottom] = getCommonBounds(
          elements.filter((element) => ids.has(element.id)),
        );
        const { dx, dy } = alignmentOffset(
          args,
          { left, top, right, bottom },
          contentViewport(api),
        );
        const next = elements.map((element) =>
          ids.has(element.id)
            ? transformBoardElement(element, { x: 0, y: 0 }, 1, dx, dy)
            : element,
        );
        api.updateScene({
          elements: next,
          appState: { whiteboardSelection: undefined },
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        return {
          ids: [...ids],
          dx,
          dy,
          bounds: getCommonBounds(
            next.filter((element) => ids.has(element.id)),
          ),
        };
      },
    ),
    classroomCommands.register(
      "canvas.move",
      "Move the selection or args.ids by finite args.dx/dy; preserve object types and parameters.",
      (args) => {
        if (classroomCommands.has("document.move")) {
          return classroomCommands.execute({ name: "document.move", args });
        }
        if (
          typeof args.dx !== "number" ||
          typeof args.dy !== "number" ||
          !Number.isFinite(args.dx) ||
          !Number.isFinite(args.dy) ||
          Math.abs(args.dx) > 10000 ||
          Math.abs(args.dy) > 10000
        ) {
          throw new Error(t("fcboard.invalid_movement_distance"));
        }
        const elements = api.getSceneElements();
        const ids = commandObjectIds(
          args.ids === undefined
            ? selectedBoardElements(api).map((el) => el.id)
            : args.ids,
          elements,
        );
        const next = elements.map((element) =>
          ids.has(element.id)
            ? transformBoardElement(
                element,
                { x: 0, y: 0 },
                1,
                args.dx as number,
                args.dy as number,
              )
            : element,
        );
        api.updateScene({
          elements: next,
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        return { ids: [...ids], dx: args.dx, dy: args.dy };
      },
    ),
    classroomCommands.context("canvas", inspect),
    classroomCommands.onInvalidate(() => {
      configurations.forEach((request) => request.abort());
      animations.forEach((animation) => animation.cancel());
      animations.clear();
    }),
  ];
  return () => {
    configurations.forEach((request) => request.abort());
    animations.forEach((animation) => animation.cancel());
    registrations.forEach((stop) => stop());
  };
};
