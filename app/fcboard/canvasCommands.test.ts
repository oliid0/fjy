import { t } from "@fcboard/fcboard/i18n";
import { Fonts } from "@fcboard/fcboard/fonts/Fonts";
import { getCommonBounds } from "@fcboard/element";
import { getNormalizedZoom } from "@fcboard/fcboard/scene";

import type { FcboardElementSkeleton } from "@fcboard/element/transform";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { registerCanvasCommands } from "./canvasCommands";
import { classroomCommands } from "./commands";
import { drawPlot, selectedPlot } from "./board";
import { defaultPlot } from "./math";
import { shapeInk } from "./documents";

import { sceneAPI } from "./test/scene";
import { interactiveResource } from "./test/interactiveResource";

import type { InkStroke } from "./documents";

it.each([0.5, 1, 2])(
  "keeps a dictated CJK question inside its physical writing frame at zoom %s",
  async (zoom) => {
    const api = sceneAPI();
    const original = api.getAppState();
    api.getAppState = () => ({
      ...original,
      zoom: { value: getNormalizedZoom(zoom) },
    });
    const stop = registerCanvasCommands(api);
    try {
      const result = (await classroomCommands.execute({
        name: "canvas.ink",
        args: {
          strokes: [],
          text: "请讲解牛顿第二定律",
          bounds: {
            left: 400 / zoom,
            top: 200 / zoom,
            right: 1000 / zoom,
            bottom: 344 / zoom,
          },
          select: false,
        },
      })) as { ids: string[] };
      const question = api
        .getSceneElements()
        .filter((item) => result.ids.includes(item.id));
      expect(question).toHaveLength(1);
      const text = question[0];
      expect(text.type).toBe("text");
      if (text.type !== "text") {
        throw new Error("Expected editable question text");
      }
      expect(text.fontSize * zoom).toBeCloseTo(24);
      const [left, top, right, bottom] = getCommonBounds(question).map(
        (point) => point * zoom,
      );
      expect(left).toBeGreaterThanOrEqual(400);
      expect(top).toBeGreaterThanOrEqual(200);
      expect(right).toBeLessThanOrEqual(1000);
      expect(bottom).toBeLessThanOrEqual(344);
    } finally {
      stop();
    }
  },
);

it.each(["abort", "board", "document", "edit"])(
  "does not commit dictated question writing after %s during font loading",
  async (change) => {
    const api = sceneAPI();
    const original = [...api.getSceneElements()];
    const stop = registerCanvasCommands(api);
    let board = "first";
    const unboard = classroomCommands.context("boards", () => ({
      active: board,
    }));
    const controller = new AbortController();
    let finish!: () => void;
    const fonts = vi.spyOn(Fonts, "loadElementsFonts").mockImplementation(
      () =>
        new Promise<FontFace[]>((resolve) => {
          finish = () => resolve([]);
        }),
    );
    let document = () => {};
    try {
      const operation = classroomCommands.execute({
        name: "canvas.ink",
        args: {
          strokes: [],
          text: "牛顿定律",
          bounds: { left: 200, top: 200, right: 800, bottom: 344 },
          replaceIds: [original[0].id],
          signal: controller.signal,
        },
      });
      const rejected = expect(operation).rejects.toMatchObject({
        name: "AbortError",
      });
      await vi.waitFor(() => expect(fonts).toHaveBeenCalled());
      if (change === "abort") {
        controller.abort();
      }
      if (change === "board") {
        board = "second";
      }
      if (change === "document") {
        document = classroomCommands.register(
          "document.draw",
          "@internal",
          vi.fn(),
        );
      }
      if (change === "edit") {
        api.updateScene({
          elements: original.map((element) => ({
            ...element,
            version: element.version + 1,
          })),
        });
      }
      const before = [...api.getSceneElements()];
      const writes = vi.mocked(api.updateScene).mock.calls.length;
      finish();
      await rejected;
      expect(api.getSceneElements()).toEqual(before);
      expect(api.updateScene).toHaveBeenCalledTimes(writes);
    } finally {
      fonts.mockRestore();
      document();
      unboard();
      stop();
    }
  },
);

it("inserts an interactive lesson as one visible object and routes it to courseware when open", async () => {
  const api = sceneAPI();
  const stop = registerCanvasCommands(api);
  try {
    const result = (await classroomCommands.execute({
      name: "canvas.resource",
      args: { resource: interactiveResource },
    })) as { ids: string[] };
    const element = api
      .getSceneElements()
      .find((element) => element.id === result.ids[0])!;
    expect(element.type).toBe("iframe");
    expect(element.customData?.fcInteractiveResource.title).toBe(
      interactiveResource.title,
    );
    expect(element.x).toBeGreaterThanOrEqual(16);
    expect(element.x + element.width).toBeLessThanOrEqual(1584);
    expect(element.y + element.height).toBeLessThanOrEqual(816);
    const insert = vi.fn().mockReturnValue({ ids: ["document-lesson"] });
    const release = classroomCommands.register(
      "document.resource",
      "@internal",
      insert,
    );
    try {
      await expect(
        classroomCommands.execute({
          name: "canvas.resource",
          args: { resource: interactiveResource },
        }),
      ).resolves.toEqual({ ids: ["document-lesson"] });
      expect(api.getSceneElements()).toHaveLength(2);
      expect(insert).toHaveBeenCalledTimes(1);
    } finally {
      release();
    }
    const controller = new AbortController();
    controller.abort();
    await expect(
      classroomCommands.execute({
        name: "canvas.resource",
        args: { resource: interactiveResource, signal: controller.signal },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(api.getSceneElements()).toHaveLength(2);
  } finally {
    stop();
  }
});

it.each(["canvas.select", "canvas.move", "canvas.erase"])(
  "rejects a stale mixed target set atomically for %s",
  async (name) => {
    const api = sceneAPI();
    const original = [...api.getSceneElements()];
    const mutate = vi.fn();
    api.mutateElement = mutate;
    const stop = registerCanvasCommands(api);
    try {
      await expect(
        classroomCommands.execute({
          name,
          args: { ids: [original[0].id, "missing"], dx: 10, dy: 20 },
        }),
      ).rejects.toThrow("missing");
      expect(api.getSceneElements()).toEqual(original);
      expect(api.updateScene).not.toHaveBeenCalled();
      expect(mutate).not.toHaveBeenCalled();
      await expect(
        classroomCommands.execute({
          name,
          args: { ids: original[0].id, dx: 10, dy: 20 },
        }),
      ).rejects.toThrow();
      expect(api.updateScene).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  },
);

it("returns actual object ids for selection, movement and erasure", async () => {
  const api = sceneAPI();
  const object = api.getSceneElements()[0];
  const initial = { x: object.x, y: object.y };
  api.mutateElement = vi.fn((element, changes) =>
    Object.assign(element, changes),
  );
  const stop = registerCanvasCommands(api);
  try {
    await expect(
      classroomCommands.execute({
        name: "canvas.select",
        args: { ids: [object.id] },
      }),
    ).resolves.toEqual({ ids: [object.id] });
    await expect(
      classroomCommands.execute({
        name: "canvas.move",
        args: { ids: [object.id], dx: 10, dy: 20 },
      }),
    ).resolves.toEqual({ ids: [object.id], dx: 10, dy: 20 });
    expect(api.getSceneElements()[0]).toMatchObject({
      x: initial.x + 10,
      y: initial.y + 20,
    });
    await expect(
      classroomCommands.execute({
        name: "canvas.erase",
        args: { ids: [object.id] },
      }),
    ).resolves.toEqual({ ids: [object.id] });
    expect(api.getSceneElements()).toEqual([]);
    await expect(
      classroomCommands.execute({
        name: "canvas.erase",
        args: { ids: [object.id] },
      }),
    ).rejects.toThrow(object.id);
  } finally {
    stop();
  }
});

it("exposes the original pen modes to AI and validates the complete style request before changing the pen", async () => {
  const api = {
    getAppState: () => ({ currentItemStrokeWidth: 2 }),
    setActiveTool: vi.fn(),
    updateScene: vi.fn(),
    executeAction: vi.fn(),
  } as unknown as FcboardImperativeAPI;
  const stop = registerCanvasCommands(api);
  try {
    await expect(
      classroomCommands.execute({
        name: "canvas.style",
        args: { pen: "missing" },
      }),
    ).rejects.toThrow(t("fcboard.unknown_pen_type"));
    await expect(
      classroomCommands.execute({
        name: "canvas.style",
        args: { pen: "rainbow", color: "invalid" },
      }),
    ).rejects.toThrow(t("fcboard.invalid_color"));
    expect(api.updateScene).not.toHaveBeenCalled();
    expect(api.executeAction).not.toHaveBeenCalled();
    await classroomCommands.execute({
      name: "canvas.style",
      args: { pen: "rainbow" },
    });
    expect(api.setActiveTool).toHaveBeenCalledWith({ type: "freedraw" });
    expect(api.updateScene).toHaveBeenCalledWith({
      appState: expect.objectContaining({
        currentItemPenMode: "rainbow",
        currentItemStrokeWidth: 2,
        whiteboardPenWidths: { hard: 2 },
      }),
    });
    await classroomCommands.execute({
      name: "canvas.style",
      args: { pen: "language" },
    });
    expect(api.updateScene).toHaveBeenLastCalledWith({
      appState: expect.objectContaining({
        currentItemPenMode: "hard",
        currentItemInkAssist: "language",
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
  } as unknown as FcboardImperativeAPI;
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
      strokes = (args.shapes as FcboardElementSkeleton[]).map((shape) =>
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
    await classroomCommands.execute({
      name: "canvas.action",
      args: { action: "selectAll" },
    });
    expect(select).toHaveBeenLastCalledWith({
      ids: strokes.map((stroke) => stroke.id),
    });
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
  } as unknown as FcboardImperativeAPI;
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
