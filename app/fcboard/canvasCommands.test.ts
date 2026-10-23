import { t } from "@excalidraw/excalidraw/i18n";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element/transform";

import { registerCanvasCommands } from "./canvasCommands";
import { classroomCommands } from "./commands";
import { drawPlot, selectedPlot } from "./board";
import { defaultPlot } from "./math";
import { shapeInk } from "./documents";

import type { InkStroke } from "./documents";

it("exposes the original pen modes to AI and validates the complete style request before changing the pen", async () => {
  const api = {
    getAppState: () => ({ currentItemStrokeWidth: 2 }),
    updateScene: vi.fn(),
    executeAction: vi.fn(),
  } as unknown as ExcalidrawImperativeAPI;
  const stop = registerCanvasCommands(api);
  try {
    await expect(
      classroomCommands.execute({
        name: "canvas.style",
        args: { pen: "missing" },
      }),
    ).rejects.toThrow(t("fcboard.笔型不存在"));
    await expect(
      classroomCommands.execute({
        name: "canvas.style",
        args: { pen: "rainbow", color: "invalid" },
      }),
    ).rejects.toThrow(t("fcboard.颜色无效"));
    expect(api.updateScene).not.toHaveBeenCalled();
    expect(api.executeAction).not.toHaveBeenCalled();
    await classroomCommands.execute({
      name: "canvas.style",
      args: { pen: "rainbow" },
    });
    expect(api.updateScene).toHaveBeenCalledWith({
      appState: expect.objectContaining({
        currentItemPenMode: "rainbow",
        currentItemStrokeWidth: 2,
        whiteboardPenWidths: { hard: 2 },
      }),
    });
  } finally {
    stop();
  }
});

it("routes text, shapes, selection and plots into the visible document instead of the hidden board", async () => {
  const api = {
    getSceneElements: () => [],
    getAppState: () => ({
      selectedElementIds: {},
      scrollX: 0,
      scrollY: 0,
      width: 1600,
      height: 900,
      zoom: { value: 1 },
    }),
    updateScene: vi.fn(),
  } as unknown as ExcalidrawImperativeAPI;
  const stop = registerCanvasCommands(api);
  const text = vi.fn();
  const draw = vi.fn();
  const select = vi.fn();
  const duplicate = vi.fn();
  let strokes: InkStroke[] = [];
  const stops = [
    classroomCommands.register("document.text", "@internal", text),
    classroomCommands.register("document.draw", "@internal", draw),
    classroomCommands.register("document.select", "@internal", select),
    classroomCommands.register("document.duplicate", "@internal", duplicate),
    classroomCommands.register("document.plot", "@internal", (args) => {
      strokes = (args.shapes as ExcalidrawElementSkeleton[]).map((shape) =>
        shapeInk(shape, "plot"),
      );
    }),
    classroomCommands.context("document", () => ({
      ink: strokes,
      selection: strokes.map((stroke) => stroke.id),
    })),
  ];
  try {
    await classroomCommands.execute({
      name: "canvas.text",
      args: { text: "课件批注" },
    });
    await classroomCommands.execute({
      name: "canvas.shapes",
      args: {
        shapes: [{ type: "diamond", x: 0, y: 0, width: 50, height: 80 }],
      },
    });
    await classroomCommands.execute({
      name: "canvas.select",
      args: { ids: ["ink"] },
    });
    await classroomCommands.execute({
      name: "canvas.action",
      args: { action: "duplicateSelection" },
    });
    expect(duplicate).toHaveBeenCalledTimes(1);
    drawPlot(api, defaultPlot, { x: 300, y: 260 });
    expect(text).toHaveBeenCalledWith({ text: "课件批注" });
    expect(draw).toHaveBeenCalled();
    expect(select).toHaveBeenCalledWith({ ids: ["ink"] });
    expect(strokes.length).toBeGreaterThan(10);
    expect(selectedPlot(api)?.plot.expression).toBe("x+1");
    expect(api.updateScene).not.toHaveBeenCalled();
  } finally {
    stops.forEach((cleanup) => cleanup());
    stop();
  }
});
