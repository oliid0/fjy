import { t } from "@excalidraw/excalidraw/i18n";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element/transform";

import { registerCanvasCommands } from "./canvasCommands";
import { classroomCommands } from "./commands";
import { drawPlot, selectedPlot } from "./board";
import { defaultPlot } from "./math";
import { shapeInk } from "./documents";

import { sceneAPI } from "./test/scene";

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

it("inspects only the visible document with its actual coordinate space and pen settings", async () => {
  const api = {
    getSceneElements: vi.fn(() => {
      throw new Error("hidden board");
    }),
    getAppState: vi.fn(() => {
      throw new Error("hidden board");
    }),
  } as unknown as ExcalidrawImperativeAPI;
  const pen = { color: "#123456", penWidth: 3, fontSize: 18, opacity: 80 };
  const stops = [
    classroomCommands.context("document", () => ({
      id: "course",
      name: "lesson.pdf",
      page: 2,
      tool: "freedraw",
      pen,
      selection: ["ink"],
      ink: [
        {
          id: "ink",
          color: "#123456",
          width: 3,
          points: [
            [100, 120],
            [150, 160],
          ],
        },
      ],
    })),
    classroomCommands.context("document.layout", () => ({
      scale: 2,
      viewport: { left: 10, top: 20, right: 990, bottom: 480 },
    })),
    registerCanvasCommands(api),
  ];
  try {
    const state = (await classroomCommands.execute({
      name: "canvas.inspect",
    })) as { elements: { id: string }[] };
    expect(state).toMatchObject({
      target: { kind: "document", id: "course", page: 2 },
      coordinates: "document",
      scale: 2,
      viewport: { left: 10, top: 20, right: 990, bottom: 480 },
      styles: pen,
      selection: ["ink"],
    });
    expect(state.elements.map((element) => element.id)).toEqual(["ink"]);
    expect(classroomCommands.read("canvas")).toEqual(state);
    expect(api.getSceneElements).not.toHaveBeenCalled();
    expect(api.getAppState).not.toHaveBeenCalled();
  } finally {
    stops.forEach((stop) => stop());
  }
});

it("reports new whiteboard objects after a real command so an agent can verify its result", async () => {
  const api = sceneAPI();
  const stop = registerCanvasCommands(api);
  try {
    const read = async () =>
      (await classroomCommands.execute({ name: "canvas.inspect" })) as {
        coordinates: string;
        elements: { id: string; text?: string; bounds: number[] }[];
      };
    const before = await read();
    const element = before.elements[0];
    await classroomCommands.execute({
      name: "canvas.text",
      args: { text: "verified writing", presentation: "text" },
    });
    const after = await read();
    expect(after.coordinates).toBe("scene");
    expect(after.elements.find((item) => item.id === element.id)).toEqual(
      element,
    );
    expect(after.elements).toHaveLength(before.elements.length + 1);
    const written = after.elements.find(
      (item) => item.text === "verified writing",
    );
    expect(written).toBeDefined();
    expect(written?.bounds.every(Number.isFinite)).toBe(true);
  } finally {
    stop();
  }
});
