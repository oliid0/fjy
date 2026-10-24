import { t } from "@excalidraw/excalidraw/i18n";
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import { getCommonBounds } from "@excalidraw/element";
import { FONT_FAMILY } from "@excalidraw/common";
import { switchWhiteboardPen } from "@excalidraw/excalidraw/whiteboardPen";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ActionName } from "@excalidraw/excalidraw/actions/types";

import { selectedBoardElements } from "./ai";
import {
  insertElements,
  insertionPoint,
  insertText,
  validateShapes,
  contentViewport,
} from "./board";
import { documentStrokeBounds } from "./documents";
import { classroomCommands } from "./commands";
import { LessonCanvas, validateLesson } from "./lesson";

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
export const registerCanvasCommands = (api: ExcalidrawImperativeAPI) => {
  const animations = new Set<LessonCanvas>();
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
        fonts: FONT_FAMILY,
        selection: document.selection || [],
        total: ink.length,
        truncated: ink.length > 300,
        elements: ink.slice(-300).map((stroke) => {
          const bounds = documentStrokeBounds(stroke);
          return {
            id: stroke.id,
            type: stroke.text ? "text" : stroke.image ? "image" : "freedraw",
            bounds: [bounds.left, bounds.top, bounds.right, bounds.bottom],
            text: stroke.text,
            color: stroke.color,
            width: stroke.width,
            fontSize: stroke.fontSize,
            fontFamily: stroke.fontFamily,
            opacity: stroke.opacity,
            tutorId: stroke.commandId,
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
      fonts: FONT_FAMILY,
      selection: selectedBoardElements(api).map((element) => element.id),
      total: elements.length,
      truncated: elements.length > 300,
      elements: elements.slice(-300).map((element) => ({
        id: element.id,
        type: element.type,
        bounds: getCommonBounds([element]),
        text: element.type === "text" ? element.text : undefined,
        color: element.strokeColor,
        fontSize: element.type === "text" ? element.fontSize : undefined,
        fontFamily: element.type === "text" ? element.fontFamily : undefined,
        opacity: element.opacity,
        tutorId: element.customData?.fcTutorId,
      })),
    };
  };
  const registrations = [
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
          throw new Error(t("fcboard.请指定是否显示工具栏"));
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
          if (args.action === "undo" || args.action === "redo") {
            return classroomCommands.execute({
              name: `document.${args.action}`,
            });
          }
          throw new Error(
            t(
              "fcboard.这项操作用于白板；在课件上可翻页、板书、圈选、撤销或直接说要插入的内容",
            ),
          );
        }
        if (!actions.has(args.action as ActionName)) {
          throw new Error(t("fcboard.此白板动作不可用"));
        }
        api.executeAction(args.action as ActionName);
      },
    ),
    classroomCommands.register(
      "canvas.tool",
      "切换原工具，args.tool=selection|freedraw|eraser|text|rectangle|ellipse|diamond|line|arrow|hand|image|frame|laser",
      (args) => {
        if (classroomCommands.has("document.tool")) {
          return classroomCommands.execute({ name: "document.tool", args });
        }
        const tools = [
          "selection",
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
          throw new Error(t("fcboard.工具不存在"));
        }
        api.setActiveTool({ type: tool });
      },
    ),
    classroomCommands.register(
      "canvas.style",
      "修改画笔或选区：args.color/background 十六进制色，background可transparent；width=1..30,fontSize=8..200,fontFamily=1/2/3/5/6/7/8/9/10,opacity=0..100,roughness=0..2,textAlign=left|center|right,fillStyle=hachure|cross-hatch|solid|zigzag,strokeStyle=solid|dashed|dotted；pen=hard|brush|highlighter|dashed|rainbow 设置白板后续书写笔型",
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
          throw new Error(t("fcboard.样式参数无效"));
        }
        const pen = (
          ["hard", "brush", "highlighter", "dashed", "rainbow"] as const
        ).find((value) => value === args.pen);
        if (args.pen !== undefined && !pen) {
          throw new Error(t("fcboard.笔型不存在"));
        }
        for (const key of ["color", "background"] as const) {
          if (
            args[key] !== undefined &&
            (typeof args[key] !== "string" ||
              (!/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(args[key] as string) &&
                !(key === "background" && args[key] === "transparent")))
          ) {
            throw new Error(t("fcboard.颜色无效"));
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
            throw new Error(t("fcboard.样式 {{key}} 超出范围", { key }));
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
            throw new Error(t("fcboard.样式 {{key}} 无效", { key }));
          }
        }
        if (
          args.fontFamily !== undefined &&
          !Object.values(FONT_FAMILY).includes(
            args.fontFamily as typeof FONT_FAMILY.Helvetica,
          )
        ) {
          throw new Error(t("fcboard.字体不存在"));
        }
        if (
          args.width !== undefined &&
          (typeof args.width !== "number" ||
            !Number.isFinite(args.width) ||
            args.width < 1 ||
            args.width > 30)
        ) {
          throw new Error(t("fcboard.笔画宽度必须在 1 到 30 之间"));
        }
        if (pen) {
          api.updateScene({
            appState: {
              ...switchWhiteboardPen(api.getAppState(), pen),
              currentItemInkAssist: undefined,
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
      "canvas.text",
      "插入或修改可编辑文本；args.text 必填；args.id 可指向现有文本；不指定id时在选区旁插入并跟随选区颜色和字号；args.presentation=match|handwritten|text 可选择跟随原字、手写字体或印刷文本",
      async (args) => {
        if (
          typeof args.text !== "string" ||
          !args.text.trim() ||
          args.text.length > 10000
        ) {
          throw new Error(t("fcboard.文本为空或过长"));
        }
        if (
          args.presentation !== undefined &&
          !["match", "handwritten", "text"].includes(String(args.presentation))
        ) {
          throw new Error(t("fcboard.回答样式不存在"));
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
          throw new Error(t("fcboard.找不到要修改的文本"));
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
          insertText(
            api,
            args.text,
            undefined,
            undefined,
            selectedBoardElements(api),
            args.presentation as "match" | "handwritten" | "text" | undefined,
            { mode: args.placement === "inline" ? "inline" : "below" },
          );
        }
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
      "逐步书写、画路径或批注，args.commands 使用教学命令 write_text/draw_path/draw_arrow/annotate_circle 等；支持id、x,y,width,height,text,points,color,duration",
      async (args) => {
        const lesson = validateLesson({
          title: "白板操作",
          steps: [{ say: "", commands: args.commands }],
          quiz: [],
        });
        const renderer = new LessonCanvas(api);
        animations.add(renderer);
        try {
          for (const command of lesson.steps[0].commands) {
            await renderer.command(
              command,
              1,
              matchMedia("(prefers-reduced-motion: reduce)").matches,
            );
          }
        } finally {
          animations.delete(renderer);
        }
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
        if (
          !Array.isArray(ids) ||
          !ids.length ||
          ids.length > 3000 ||
          !ids.every((id) => typeof id === "string")
        ) {
          throw new Error(t("fcboard.请先圈选要擦除的内容"));
        }
        const selected = new Set(ids);
        api.updateScene({
          elements: api.getSceneElements().filter((el) => !selected.has(el.id)),
          appState: { selectedElementIds: {}, whiteboardSelection: undefined },
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
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
              appState: { selectedElementIds: {} },
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
        if (
          !Array.isArray(args.ids) ||
          !args.ids.every((id) => typeof id === "string")
        ) {
          throw new Error(t("fcboard.选区格式无效"));
        }
        const ids = new Set(args.ids);
        api.updateScene({
          appState: {
            selectedElementIds: Object.fromEntries(
              api
                .getSceneElements()
                .filter((el) => ids.has(el.id))
                .map((el) => [el.id, true]),
            ),
          },
        });
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
          throw new Error(t("fcboard.移动距离无效"));
        }
        const ids = new Set(
          Array.isArray(args.ids)
            ? args.ids
            : selectedBoardElements(api).map((el) => el.id),
        );
        if (!ids.size) {
          throw new Error(t("fcboard.请先选择对象"));
        }
        const elements = api.getSceneElements();
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
      },
    ),
    classroomCommands.context("canvas", inspect),
    classroomCommands.onInvalidate(() => {
      animations.forEach((animation) => animation.cancel());
      animations.clear();
    }),
  ];
  return () => {
    animations.forEach((animation) => animation.cancel());
    registrations.forEach((stop) => stop());
  };
};
