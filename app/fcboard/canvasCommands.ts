import { t } from "@excalidraw/excalidraw/i18n";
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import { getCommonBounds, newIframeElement } from "@excalidraw/element";
import { validateInteractiveResource } from "@excalidraw/excalidraw/interactiveHtml";
import { FONT_FAMILY } from "@excalidraw/common";
import { switchWhiteboardPen } from "@excalidraw/excalidraw/whiteboardPen";

import type {
  ExcalidrawImperativeAPI,
  UIOptions,
} from "@excalidraw/excalidraw/types";
import type { ActionName } from "@excalidraw/excalidraw/actions/types";

import { selectedBoardElements } from "./ai";
import {
  insertElements,
  insertionPoint,
  insertText,
  validateShapes,
  contentViewport,
  objectSelection,
} from "./board";
import { documentStrokeBounds } from "./documents";
import { classroomCommands, commandObjectIds } from "./commands";
import { LessonCanvas, validateLesson } from "./lesson";
import { prepareQuestionWriting } from "./questionWriting";
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
  api: ExcalidrawImperativeAPI,
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
      "读取当前可见白板或课件层的真实对象、选区、画笔、可书写视口和缩放；bounds 顺序为左上右下，坐标使用返回的 coordinates；操作前读取，操作后再次检查结果，不使用背后白板对象",
      inspect,
    ),
    classroomCommands.register(
      "canvas.toolbar",
      "显示或隐藏原白板工具栏，args.visible 必须是布尔值；隐藏会收起工具属性和菜单",
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
      `执行原白板动作，args.action 仅限 ${Array.from(actions).join(",")}`,
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
    classroomCommands.register(
      "canvas.style",
      "修改画笔或选区：args.color/background 十六进制色，background可transparent；width=1..30,fontSize=8..200,fontFamily=1/2/3/5/6/7/8/9/10,opacity=0..100,roughness=0..2,textAlign=left|center|right,fillStyle=hachure|cross-hatch|solid|zigzag,strokeStyle=solid|dashed|dotted；pen=hard|brush|highlighter|dashed|rainbow|text|shape|magic|function|calculation|language 设置白板后续书写笔型",
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
        if (args.color) {
          api.executeAction("changeStrokeColor", {
            currentItemStrokeColor: args.color,
          });
        }
        if (args.background) {
          api.executeAction("changeBackgroundColor", {
            currentItemBackgroundColor: args.background,
          });
        }
        if (args.width) {
          api.executeAction("changeStrokeWidth", args.width);
        }
        for (const [key, [, , action]] of Object.entries(numeric)) {
          if (args[key] !== undefined) {
            api.executeAction(action, args[key]);
          }
        }
        for (const [key, [, action]] of Object.entries(choices)) {
          if (args[key] !== undefined) {
            api.executeAction(action, args[key]);
          }
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
      "Insert editable ink on the visible surface. args.strokes contains [[x,y],...] trajectories. Optional args.text is dictated text; also supply args.bounds={left,top,right,bottom} to wrap handwriting within that visible area. args.replaceIds atomically replaces a previous question. Returns actual object ids.",
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
        const elements = await prepareQuestionWriting(args, () => {
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
      "插入或修改可编辑文本；args.text 必填；args.id 可指向现有文本；不指定id时在选区旁插入并跟随选区颜色和字号；args.presentation=match|handwritten|text；args.placement=center 可在当前可见画布中央找空位，不依附旧选区",
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
          const next = convertToExcalidrawElements(
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
        const obstacles = api.getSceneElements().map((element) => {
          const [left, top, right, bottom] = getCommonBounds([element]);
          return { left, top, right, bottom };
        });
        const position = resourcePlacement(viewport, obstacles, scale);
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
      "插入可编辑图形，args.shapes 为 rectangle|ellipse|diamond|line|arrow|text 数组，坐标相对选区，包含 x,y,width,height，文本带text",
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
      "逐步板书，args.commands 使用 write_text/draw_path/draw_arrow 等，支持id、x,y,width,height,text,points,color,duration。返回 lessonId 与真实对象；更正已写标题须从 canvas.inspect 读取 lessonId 和 tutorId，传 args.lessonId 并复用 command.id=tutorId，原位置/字号/颜色会保留。新标题省略 lessonId。",
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
          title: "白板操作",
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
      "擦除 args.ids 指定的对象；省略时仅擦除圈选对象",
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
      "清空当前白板，仅在用户明确要求清空当前白板时使用",
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
      "选择已存在的对象，args.ids 为对象id数组",
      (args) => {
        if (classroomCommands.has("document.select")) {
          return classroomCommands.execute({ name: "document.select", args });
        }
        const ids = commandObjectIds(args.ids, api.getSceneElements(), true);
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
      "canvas.move",
      "移动选区或args.ids指定对象，args.dx/dy为有限位移；保留对象类型与参数",
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
        elements
          .filter((el) => ids.has(el.id))
          .forEach((el) =>
            api.mutateElement(el, {
              x: el.x + (args.dx as number),
              y: el.y + (args.dy as number),
            }),
          );
        api.updateScene({
          elements,
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
