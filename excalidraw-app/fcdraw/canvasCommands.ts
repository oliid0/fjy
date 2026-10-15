import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import { getCommonBounds } from "@excalidraw/element";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ActionName } from "@excalidraw/excalidraw/actions/types";

import { selectedBoardElements } from "./ai";
import {
  insertElements,
  insertionPoint,
  insertText,
  validateShapes,
} from "./board";
import { classroomCommands } from "./commands";
import { LessonCanvas, validateLesson } from "./lesson";

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
]);
export const registerCanvasCommands = (api: ExcalidrawImperativeAPI) => {
  const animations = new Set<LessonCanvas>();
  const registrations = [
    classroomCommands.register(
      "canvas.action",
      `执行原白板动作，args.action 仅限 ${Array.from(actions).join(",")}`,
      (args) => {
        if (classroomCommands.has("document.draw")) {
          if (args.action === "undo" || args.action === "redo") {
            return classroomCommands.execute({
              name: `document.${args.action}`,
            });
          }
          throw new Error(
            "这项操作用于白板；在课件上可翻页、板书、圈选、撤销或直接说要插入的内容",
          );
        }
        if (!actions.has(args.action as ActionName)) {
          throw new Error("此白板动作不可用");
        }
        api.executeAction(args.action as ActionName);
      },
    ),
    classroomCommands.register(
      "canvas.tool",
      "切换原工具，args.tool=selection|freedraw|eraser|text|rectangle|ellipse|diamond|line|arrow|hand|image",
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
        ] as const;
        const tool = tools.find((value) => value === args.tool);
        if (!tool) {
          throw new Error("工具不存在");
        }
        api.setActiveTool({ type: tool });
      },
    ),
    classroomCommands.register(
      "canvas.style",
      "修改画笔或选区样式，args.color / background 为十六进制颜色，args.width=1..30",
      (args) => {
        if (classroomCommands.has("document.style")) {
          return classroomCommands.execute({ name: "document.style", args });
        }
        for (const key of ["color", "background"] as const) {
          if (
            args[key] !== undefined &&
            (typeof args[key] !== "string" ||
              !/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(args[key] as string))
          ) {
            throw new Error("颜色无效");
          }
        }
        if (
          args.width !== undefined &&
          (typeof args.width !== "number" ||
            !Number.isFinite(args.width) ||
            args.width < 1 ||
            args.width > 30)
        ) {
          throw new Error("笔画宽度必须在 1 到 30 之间");
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
      },
    ),
    classroomCommands.register(
      "canvas.text",
      "插入或修改文本；args.text 必填；args.id 可指向现有文本；不指定id时在选区旁插入",
      async (args) => {
        if (
          typeof args.text !== "string" ||
          !args.text.trim() ||
          args.text.length > 10000
        ) {
          throw new Error("文本为空或过长");
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
          throw new Error("找不到要修改的文本");
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
          insertText(api, args.text);
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
          throw new Error("请先圈选要擦除的内容");
        }
        const selected = new Set(ids);
        api.updateScene({
          elements: api.getSceneElements().filter((el) => !selected.has(el.id)),
          appState: { selectedElementIds: {} },
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
          throw new Error("选区格式无效");
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
          throw new Error("移动距离无效");
        }
        const ids = new Set(
          Array.isArray(args.ids)
            ? args.ids
            : selectedBoardElements(api).map((el) => el.id),
        );
        if (!ids.size) {
          throw new Error("请先选择对象");
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
    classroomCommands.context("canvas", () => ({
      tool: api.getAppState().activeTool.type,
      selection: selectedBoardElements(api).map((el) => el.id),
      elements: api
        .getSceneElements()
        .slice(-300)
        .map((el) => ({
          id: el.id,
          type: el.type,
          bounds: getCommonBounds([el]),
          text: el.type === "text" ? el.text : undefined,
          tutorId: el.customData?.fcTutorId,
        })),
    })),
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
