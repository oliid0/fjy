import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { Fcboard, convertToFcboardElements } from "@fcboard/fcboard";
import { CaptureUpdateAction, newFreeDrawElement } from "@fcboard/element";
import { pointFrom } from "@fcboard/math";
import { API } from "@fcboard/fcboard/tests/helpers/api";
import { render as renderEditor } from "@fcboard/fcboard/tests/test-utils";
import { t } from "@fcboard/fcboard/i18n";
import { selectedRegion } from "@fcboard/fcboard/lasso/region";

import { drawPlot, objectSelection, selectedPlot } from "./board";
import { defaultPlot } from "./math";
import { localFunctionResult } from "./mathRecognition";
import { FunctionGraphInteraction } from "./FunctionGraphInteraction";
import * as ocr from "./ocr";
import { functionSelection, mergeFunctions } from "./functionMerge";
import { latestFunctionInk } from "./functionInk";
import { functionGeometry } from "./functionGeometry";
import * as visualization from "./functionVisualization";
import { SelectionActions } from "./SelectionActions";
import { registerCanvasCommands } from "./canvasCommands";
import { classroomCommands } from "./commands";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const setup = async (expression = "x") => {
  await renderEditor(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  const api = window.h.app.api;
  act(() => api.updateScene({ appState: { width: 1600, height: 900 } }));
  let ids: string[] = [];
  act(() => {
    ids = drawPlot(api, { ...defaultPlot, expression }, { x: 350, y: 300 });
    api.setActiveTool({ type: "selection" });
    api.updateScene({
      appState: objectSelection(
        api.getSceneElements().filter((element) => ids.includes(element.id)),
      ),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  });
  const { render } = await import("./test/render");
  render(<FunctionGraphInteraction api={api} />);
  await waitFor(() =>
    expect(document.querySelector(".fc-inline-function canvas")).not.toBeNull(),
  );
  const graph = () =>
    api
      .getSceneElements()
      .find((element) => element.type === "image" && ids.includes(element.id))!;
  const canvas = () =>
    document.querySelector<HTMLCanvasElement>(".fc-inline-function canvas")!;
  vi.spyOn(canvas(), "getBoundingClientRect").mockImplementation(() => {
    const element = graph();
    const state = api.getAppState();
    const left = (element.x + state.scrollX) * state.zoom.value;
    const top = (element.y + state.scrollY) * state.zoom.value;
    const width = element.width * state.zoom.value;
    const height = element.height * state.zoom.value;
    return {
      x: left,
      y: top,
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      toJSON: () => ({}),
    };
  });
  return { api, graph, canvas };
};
it("inserts one saved transparent PNG object and renders a direct TSX canvas with no iframe or window chrome", async () => {
  const { api, graph, canvas } = await setup();
  expect(graph().type).toBe("image");
  expect(graph().customData!.fcPlot.renderer).toBe("canvas");
  expect(graph().strokeColor).toBe("#2563eb");
  expect(graph().customData!.fcInteractiveResource).toBeUndefined();
  expect(document.querySelector("iframe[data-resource-object-id]")).toBeNull();
  expect(document.querySelector(".fc-resource-window")).toBeNull();
  expect(canvas().width).toBeGreaterThan(0);
  expect(getComputedStyle(canvas()).pointerEvents).toBe("auto");
  expect(document.querySelector(".fc-inline-function svg")).toBeNull();
  expect(document.querySelector(".fc-inline-function")).toHaveAttribute(
    "aria-label",
    "y = x",
  );
  const element = graph();
  if (element.type !== "image" || !element.fileId) {
    throw new Error("Expected PNG image");
  }
  expect(api.getFiles()[element.fileId].mimeType).toBe("image/png");
});
it("keeps clicks free of extra controls and persists the internal wheel domain on the same object", async () => {
  const { api, graph, canvas } = await setup();
  const boardZoom = api.getAppState().zoom.value;
  const before = graph();
  const rect = canvas().getBoundingClientRect();
  const clientX = rect.left + rect.width * 0.52;
  const clientY = rect.top + rect.height * 0.5;
  fireEvent.click(canvas(), { clientX, clientY });
  expect(
    document
      .querySelector(".fc-inline-function-object")!
      .querySelector("button,input,textarea,form,nav,output"),
  ).toBeNull();
  expect(document.querySelector(".fc-function-point")).toBeNull();
  fireEvent.wheel(canvas(), {
    clientX,
    clientY,
    deltaY: -160,
    deltaMode: 0,
  });
  await waitFor(() =>
    expect(graph().customData!.fcPlot.plot.view).toBeDefined(),
  );
  expect(graph()).toMatchObject({
    id: before.id,
    x: before.x,
    y: before.y,
    width: before.width,
    height: before.height,
  });
  const box = graph().customData!.fcPlot.plot.view;
  expect(box.right - box.left).toBeLessThan(20);
  expect(api.getAppState().zoom.value).toBe(boardZoom);
});
it("has no parameter/editor controls and undoes one range gesture with its saved pixels", async () => {
  const { api, graph, canvas } = await setup("a*x+1");
  const before = graph();
  expect(
    document
      .querySelector(".fc-inline-function-object")!
      .querySelector("button,input,textarea,form,nav,output"),
  ).toBeNull();
  const rect = canvas().getBoundingClientRect();
  fireEvent.wheel(canvas(), {
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    deltaY: -160,
  });
  await waitFor(() =>
    expect(graph().customData!.fcPlot.plot.view).toBeDefined(),
  );
  expect(graph().customData!.fcPlot.plot.a).toBe(
    before.customData!.fcPlot.plot.a,
  );
  expect(graph()).toMatchObject({
    id: before.id,
    x: before.x,
    y: before.y,
    width: before.width,
    height: before.height,
  });
  act(() => api.executeAction("undo"));
  await waitFor(() =>
    expect(graph().customData!.fcPlot.plot.view).toBeUndefined(),
  );
  const restoredGraph = graph();
  expect(restoredGraph.type === "image" && restoredGraph.fileId).toBe(
    before.type === "image" && before.fileId,
  );
});

it("keeps comparison curves in one coordinate system and preserves them through serialization", () => {
  const result = localFunctionResult("y=x\ny=x^2");
  if (result.kind !== "function") {
    throw new Error("Expected functions");
  }
  expect(result.plot.compare).toEqual(["x^2"]);
  const geometry = functionGeometry(JSON.parse(JSON.stringify(result.plot)));
  expect(geometry.curves.map((curve) => curve.expression)).toEqual([
    "x",
    "x^2",
  ]);
  expect(geometry.intersections.map(({ x, y }) => [x, y])).toEqual([
    [0, 0],
    [1, 1],
  ]);
});

it("creates a comparison only after explicit Merge and preserves selected handwritten expressions", async () => {
  const { api } = await setup();
  const source = convertToFcboardElements([
    { type: "text", text: "y=x", x: 100, y: 100 },
    { type: "text", text: "y=x^2", x: 100, y: 250 },
  ]);
  act(() =>
    api.updateScene({
      elements: source,
      appState: {
        currentItemInkAssist: "function",
        ...objectSelection(source),
      },
    }),
  );
  expect(functionSelection(api)).toBeDefined();
  expect(api.getSceneElements()).toEqual(source);
  await act(async () => {
    await mergeFunctions(api, new AbortController().signal);
  });
  await waitFor(() =>
    expect(
      api
        .getSceneElements()
        .filter((element) => element.customData?.fcPlot?.plot.compare),
    ).toHaveLength(1),
  );
  expect(
    api
      .getSceneElements()
      .find((element) => element.customData?.fcPlot?.plot.compare),
  ).toMatchObject({
    type: "image",
    customData: { fcPlot: { plot: { expression: "x", compare: ["x^2"] } } },
  });
  expect(api.getSceneElements().slice(0, 2)).toEqual(source);
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(
    api.getSceneElements().filter((element) => element.type === "image"),
  ).toHaveLength(1);
});
it.each([false, true])(
  "recognizes selected handwritten expressions concurrently and discards stale sources=%s",
  async (erase) => {
    const { api } = await setup();
    const pending: ((text: string) => void)[] = [];
    const recognize = vi
      .spyOn(ocr, "recognizeHandwriting")
      .mockImplementation(
        () => new Promise((resolve) => pending.push(resolve)),
      );
    const source = [100, 320].map((y) =>
      newFreeDrawElement({
        type: "freedraw",
        x: 100,
        y,
        points: [pointFrom(0, 0), pointFrom(100, 50)],
        simulatePressure: true,
        customData: { fcInk: { version: 2, pen: "hard", assist: "function" } },
      }),
    );
    act(() =>
      api.updateScene({
        elements: source,
        appState: {
          currentItemInkAssist: "function",
          ...objectSelection(source),
        },
      }),
    );
    let merging!: Promise<unknown>;
    act(() => {
      merging = mergeFunctions(api, new AbortController().signal);
    });
    const completion = merging.catch((error) => error);
    await waitFor(() => expect(recognize).toHaveBeenCalledTimes(2));
    expect(api.getSceneElements()).toEqual(source);
    if (erase) {
      act(() => api.updateScene({ elements: [] }));
    }
    await act(async () => {
      pending[1]("y=x^2");
      pending[0]("y=x");
      await completion;
    });
    if (erase) {
      expect(api.getSceneElements()).toEqual([]);
    } else {
      await waitFor(() =>
        expect(
          api.getSceneElements().filter((element) => element.type === "image"),
        ).toHaveLength(1),
      );
      expect(
        api.getSceneElements().find((element) => element.type === "image")
          ?.customData?.fcPlot.plot.compare,
      ).toEqual(["x^2"]);
    }
  },
);
it("keeps an earlier row out of a newer formula that includes a superscript", () => {
  const ink: import("./digitalInk").InkInput = [
    [
      [110, 66],
      [122, 92],
    ],
    [
      [122, 108],
      [130, 121],
    ],
    [
      [100, 125],
      [118, 160],
    ],
  ];
  expect([...latestFunctionInk(ink)].sort()).toEqual([1, 2]);
});

it("merges two nearby handwritten definitions returned in one OCR line", async () => {
  const { api } = await setup();
  const recognize = vi
    .spyOn(ocr, "recognizeHandwriting")
    .mockResolvedValue("y=x g(x)=x^2");
  const source = [100, 170].map((x) =>
    newFreeDrawElement({
      type: "freedraw",
      x,
      y: 100,
      points: [pointFrom(0, 0), pointFrom(40, 30)],
      simulatePressure: true,
      customData: { fcInk: { version: 2, pen: "hard", assist: "function" } },
    }),
  );
  act(() =>
    api.updateScene({ elements: source, appState: objectSelection(source) }),
  );
  await act(async () => {
    await mergeFunctions(api, new AbortController().signal);
  });
  expect(recognize).toHaveBeenCalledTimes(1);
  expect(api.getSceneElements()).toHaveLength(3);
  expect(api.getSceneElements().at(-1)?.customData?.fcPlot?.plot).toMatchObject(
    {
      expression: "x",
      compare: ["x^2"],
    },
  );
});

it("keeps nearby generated graphs independent until an explicit selection merge", async () => {
  const { api } = await setup();
  const sources = [100, 200].map((y) =>
    newFreeDrawElement({
      type: "freedraw",
      x: 100,
      y,
      points: [pointFrom(0, 0), pointFrom(80, 30)],
      simulatePressure: true,
      customData: { fcInk: { version: 2, pen: "hard", assist: "function" } },
    }),
  );
  act(() => {
    api.updateScene({ elements: sources });
    for (const [index, source] of sources.entries()) {
      drawPlot(
        api,
        { ...defaultPlot, expression: index ? "x+1" : "x-1" },
        { x: 450, y: source.y },
        [],
        undefined,
        true,
        undefined,
        [source.id],
      );
    }
  });
  expect(api.getSceneElements()).toHaveLength(4);
  act(() => api.updateScene({ appState: objectSelection(sources) }));
  await act(async () => {
    await mergeFunctions(api, new AbortController().signal);
  });
  expect(api.getSceneElements()).toHaveLength(3);
  const merged = api.getSceneElements().find((item) => item.customData?.fcPlot)!
    .customData!.fcPlot.plot;
  expect(new Set([merged.expression, ...merged.compare])).toEqual(
    new Set(["x-1", "x+1"]),
  );
  act(() => api.executeAction("undo"));
  await waitFor(() => expect(api.getSceneElements()).toHaveLength(4));
});

it("merges two selected graph objects without re-recognizing their source", async () => {
  const { api } = await setup("x^2");
  const recognize = vi.spyOn(ocr, "recognizeHandwriting");
  act(() => {
    drawPlot(api, { ...defaultPlot, expression: "x+1" }, { x: 650, y: 120 });
    api.updateScene({ appState: objectSelection(api.getSceneElements()) });
  });
  await act(async () => {
    await mergeFunctions(api, new AbortController().signal);
  });
  const [graph] = api.getSceneElements();
  expect(api.getSceneElements()).toHaveLength(1);
  const plot = graph.customData?.fcPlot?.plot;
  expect(new Set([plot?.expression, ...(plot?.compare || [])])).toEqual(
    new Set(["x^2", "x+1"]),
  );
  expect(recognize).not.toHaveBeenCalled();
});

it("merges partially selected handwritten sources and preserves every original stroke", async () => {
  const { api } = await setup();
  const recognize = vi.spyOn(ocr, "recognizeHandwriting");
  const sources = [100, 100, 240, 240].map((y, index) =>
    newFreeDrawElement({
      type: "freedraw",
      x: 100 + (index % 2) * 35,
      y,
      points: [pointFrom(0, 0), pointFrom(25, 30)],
      simulatePressure: true,
      customData: { fcInk: { version: 2, pen: "hard", assist: "function" } },
    }),
  );
  act(() => {
    api.updateScene({ elements: sources });
    for (const index of [0, 2]) {
      drawPlot(
        api,
        { ...defaultPlot, expression: index ? "x+1" : "x-1" },
        { x: 500, y: sources[index].y },
        [],
        undefined,
        true,
        undefined,
        sources.slice(index, index + 2).map((source) => source.id),
      );
    }
    api.updateScene({ appState: objectSelection([sources[0], sources[2]]) });
  });
  expect(functionSelection(api)?.groups).toHaveLength(2);
  await act(async () => mergeFunctions(api, new AbortController().signal));
  expect(recognize).not.toHaveBeenCalled();
  expect(
    api.getSceneElements().filter((item) => item.type === "freedraw"),
  ).toEqual(sources);
  const graphs = api
    .getSceneElements()
    .filter((item) => item.customData?.fcPlot);
  expect(graphs).toHaveLength(1);
  expect(new Set(graphs[0].customData!.fcPlot.sourceIds)).toEqual(
    new Set(sources.map((source) => source.id)),
  );
});

it("merges expressions only on request and labels the actual reciprocal/line intersections without extra graph UI", async () => {
  const { api } = await setup("1/x");
  const sources = convertToFcboardElements([
    { type: "text", text: "y=1/x", x: 100, y: 100 },
    { type: "text", text: "y=x", x: 100, y: 220 },
  ]);
  act(() =>
    api.updateScene({ elements: sources, appState: objectSelection(sources) }),
  );
  await act(async () => {
    await mergeFunctions(api, new AbortController().signal);
  });
  expect(api.getSceneElements()).toHaveLength(3);
  const plot = api.getSceneElements().find((item) => item.customData?.fcPlot)!
    .customData!.fcPlot.plot;
  expect(new Set([plot.expression, ...plot.compare])).toEqual(
    new Set(["1/x", "x"]),
  );
  const intersections = functionGeometry(plot).intersections;
  expect(intersections).toHaveLength(2);
  intersections.forEach((point, index) => {
    expect(point.x).toBeCloseTo(index === 0 ? -1 : 1, 5);
    expect(point.y).toBeCloseTo(index === 0 ? -1 : 1, 5);
  });
  await waitFor(() =>
    expect(
      document.querySelector(".fc-inline-function canvas"),
    ).toHaveAttribute("aria-description", expect.stringContaining("-1, -1")),
  );
  expect(document.querySelector(".fc-inline-function canvas")).toHaveAttribute(
    "aria-description",
    expect.stringContaining("1, 1"),
  );
  expect(
    document
      .querySelector(".fc-inline-function-object")!
      .querySelector("button,input,textarea,form,nav,output"),
  ).toBeNull();
  const { render } = await import("./test/render");
  render(<SelectionActions api={api} onPlot={vi.fn()} onRequest={vi.fn()} />);
  expect(screen.getByRole("button", { name: t("labels.copy") })).toBeVisible();
  expect(
    screen.getByRole("button", { name: t("fcboard.selection_border") }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: t("fcboard.selection_layers") }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: t("fcboard.functionGraph.merge") }),
  ).toBeNull();
});

it("keeps graph object actions available and offers merge for two selected graphs", async () => {
  const { api } = await setup();
  act(() => {
    drawPlot(api, { ...defaultPlot, expression: "-x" }, { x: 950, y: 300 });
  });
  const graphs = api.getSceneElements();
  act(() => api.updateScene({ appState: objectSelection(graphs) }));
  const { render } = await import("./test/render");
  render(<SelectionActions api={api} onPlot={vi.fn()} onRequest={vi.fn()} />);
  expect(screen.getByRole("button", { name: t("labels.copy") })).toBeVisible();
  expect(
    screen.getByRole("button", { name: t("fcboard.selection_layers") }),
  ).toBeVisible();
  expect(api.getSceneElements()).toHaveLength(2);
  expect(
    screen.getByRole("button", { name: t("fcboard.functionGraph.merge") }),
  ).toBeEnabled();
});

it("moves the selected canvas object and undoes one complete drag", async () => {
  const { api, graph, canvas } = await setup();
  const before = graph();
  const historyCount = API.getUndoStack().length;
  fireEvent.pointerDown(canvas(), {
    pointerId: 11,
    pointerType: "touch",
    button: 0,
    clientX: 200,
    clientY: 200,
  });
  fireEvent.pointerMove(canvas(), {
    pointerId: 11,
    pointerType: "touch",
    clientX: 240,
    clientY: 225,
  });
  fireEvent.pointerMove(canvas(), {
    pointerId: 11,
    pointerType: "touch",
    clientX: 280,
    clientY: 250,
  });
  fireEvent.pointerUp(canvas(), {
    pointerId: 11,
    pointerType: "touch",
    clientX: 280,
    clientY: 250,
  });
  await waitFor(() =>
    expect(graph()).toMatchObject({ x: before.x + 80, y: before.y + 50 }),
  );
  expect({
    historyCount,
    afterCount: API.getUndoStack().length,
    snapshot: API.getSnapshot().map((item) => ({
      id: item.id,
      x: item.x,
      y: item.y,
    })),
  }).toMatchObject({ afterCount: historyCount + 1 });
  act(() => api.executeAction("undo"));
  await waitFor(() =>
    expect(graph()).toMatchObject({ x: before.x, y: before.y }),
  );
});

it("moves a circled graph and its blue frame together without zooming the function domain", async () => {
  const { api, graph, canvas } = await setup();
  const before = graph();
  const selection = selectedRegion([before], undefined, 1)!;
  act(() => {
    api.setActiveTool({ type: "lasso" });
    api.updateScene({
      appState: {
        ...objectSelection([before]),
        whiteboardSelection: selection,
      },
    });
  });
  fireEvent.wheel(canvas(), { clientX: 200, clientY: 200, deltaY: -180 });
  fireEvent.pointerDown(canvas(), {
    pointerId: 13,
    pointerType: "touch",
    button: 0,
    clientX: 200,
    clientY: 200,
  });
  fireEvent.pointerDown(canvas(), {
    pointerId: 14,
    pointerType: "touch",
    button: 0,
    clientX: 260,
    clientY: 260,
  });
  fireEvent.pointerMove(canvas(), {
    pointerId: 13,
    pointerType: "touch",
    clientX: 235,
    clientY: 225,
  });
  expect(graph()).toMatchObject({ x: before.x + 35, y: before.y + 25 });
  expect(api.getAppState().whiteboardSelection?.bounds).toEqual({
    left: selection.bounds.left + 35,
    right: selection.bounds.right + 35,
    top: selection.bounds.top + 25,
    bottom: selection.bounds.bottom + 25,
  });
  fireEvent.pointerUp(canvas(), {
    pointerId: 13,
    pointerType: "touch",
    clientX: 235,
    clientY: 225,
  });
  expect(graph().customData?.fcPlot.plot.view).toBeUndefined();
});

it("zooms the numeric range with three contacts without moving/resizing the selected object", async () => {
  const { api, graph, canvas } = await setup();
  const boardZoom = api.getAppState().zoom.value;
  const before = graph();
  for (const [pointerId, clientX, clientY] of [
    [1, 160, 220],
    [2, 260, 220],
    [3, 210, 300],
  ]) {
    fireEvent.pointerDown(canvas(), {
      pointerId,
      pointerType: "touch",
      button: 0,
      clientX,
      clientY,
    });
  }
  fireEvent.pointerMove(canvas(), {
    pointerId: 1,
    pointerType: "touch",
    clientX: 110,
    clientY: 220,
  });
  fireEvent.pointerMove(canvas(), {
    pointerId: 2,
    pointerType: "touch",
    clientX: 310,
    clientY: 220,
  });
  fireEvent.pointerMove(canvas(), {
    pointerId: 3,
    pointerType: "touch",
    clientX: 210,
    clientY: 350,
  });
  for (const [pointerId, clientX, clientY] of [
    [1, 110, 220],
    [2, 310, 220],
    [3, 210, 350],
  ]) {
    fireEvent.pointerUp(canvas(), {
      pointerId,
      pointerType: "touch",
      clientX,
      clientY,
    });
  }
  await waitFor(() =>
    expect(graph().customData?.fcPlot.plot.view).toBeDefined(),
  );
  expect(api.getAppState().zoom.value).toBe(boardZoom);
  expect(
    graph().customData?.fcPlot.plot.view.right -
      graph().customData?.fcPlot.plot.view.left,
  ).toBeLessThan(20);
  expect(graph()).toMatchObject({
    x: before.x,
    y: before.y,
    width: before.width,
    height: before.height,
  });
});

it("keeps copied graphs independent and updates the saved PNG on a real color action", async () => {
  const { api, graph } = await setup();
  const source = graph();
  const stop = registerCanvasCommands(api);
  try {
    await act(async () => {
      await classroomCommands.execute({
        name: "canvas.action",
        args: { action: "duplicateSelection" },
      });
    });
    const copy = api
      .getSceneElements()
      .find((element) => element.id !== source.id)!;
    expect(copy.customData?.fcPlot.id).not.toBe(source.customData?.fcPlot.id);
    expect(selectedPlot(api)?.ids).toEqual([copy.id]);
    await act(async () => {
      await classroomCommands.execute({
        name: "canvas.style",
        args: { color: "#d32941", opacity: 40 },
      });
    });
    const updated = api
      .getSceneElements()
      .find((element) => element.id === copy.id)!;
    expect(updated).toMatchObject({ strokeColor: "#d32941", opacity: 40 });
    expect(updated.type === "image" && updated.fileId).not.toBe(
      copy.type === "image" && copy.fileId,
    );
    expect(
      api.getSceneElements().find((element) => element.id === source.id),
    ).toEqual(source);
  } finally {
    stop();
  }
});

it("limits an explicit merge to the first three selected expressions and keeps all original ink/text", async () => {
  const { api } = await setup();
  const source = convertToFcboardElements(
    ["x", "x+1", "x+2", "x+3"].map((expression, index) => ({
      type: "text" as const,
      text: `y=${expression}`,
      x: 100,
      y: 100 + index * 100,
    })),
  );
  act(() =>
    api.updateScene({ elements: source, appState: objectSelection(source) }),
  );
  await act(async () => {
    await mergeFunctions(api, new AbortController().signal);
  });
  const graph = api
    .getSceneElements()
    .find((element) => element.customData?.fcPlot)!;
  expect(graph.customData!.fcPlot.plot).toMatchObject({
    expression: "x",
    compare: ["x+1", "x+2"],
  });
  expect(api.getSceneElements().slice(0, 4)).toEqual(source);
});

it("cancels a graph translation without an undo entry and releases the live view when selection changes", async () => {
  const { api, graph, canvas } = await setup();
  const before = graph();
  const count = API.getUndoStack().length;
  fireEvent.pointerDown(canvas(), {
    pointerId: 12,
    pointerType: "touch",
    button: 0,
    clientX: 200,
    clientY: 200,
  });
  fireEvent.pointerMove(canvas(), {
    pointerId: 12,
    pointerType: "touch",
    clientX: 240,
    clientY: 250,
  });
  fireEvent.pointerCancel(canvas(), { pointerId: 12, pointerType: "touch" });
  expect(graph()).toMatchObject({ x: before.x, y: before.y });
  expect(API.getUndoStack()).toHaveLength(count);
  act(() =>
    api.updateScene({
      appState: { selectedElementIds: {}, selectedGroupIds: {} },
    }),
  );
  await waitFor(() =>
    expect(document.querySelector(".fc-inline-function canvas")).toBeNull(),
  );
  expect(graph().id).toBe(before.id);
});

it("undoes a graph color and its saved pixels together as one edit", async () => {
  const { api, graph } = await setup();
  const before = graph();
  const count = API.getUndoStack().length;
  const stop = registerCanvasCommands(api);
  try {
    await act(async () => {
      await classroomCommands.execute({
        name: "canvas.style",
        args: { color: "#d32941" },
      });
    });
    expect(graph().strokeColor).toBe("#d32941");
    expect(
      API.getUndoStack()
        .slice(count)
        .filter((entry) => !entry.elements.isEmpty()),
    ).toHaveLength(1);
    act(() => api.executeAction("undo"));
    expect(graph().strokeColor).toBe(before.strokeColor);
    const restoredGraph = graph();
    expect(restoredGraph.type === "image" && restoredGraph.fileId).toBe(
      before.type === "image" && before.fileId,
    );
  } finally {
    stop();
  }
});

it("uses the ordinary border menu and preserves its actual curve style through range zoom and one-step undo", async () => {
  const { api, graph, canvas } = await setup();
  const before = graph();
  const regenerate = vi.spyOn(visualization, "functionGraphImage");
  const stop = registerCanvasCommands(api);
  const { render } = await import("./test/render");
  render(<SelectionActions api={api} onPlot={vi.fn()} onRequest={vi.fn()} />);
  try {
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.selection_border") }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("labels.strokeStyle_dashed") }),
    );
    await waitFor(() => expect(graph().strokeStyle).toBe("dashed"));
    expect(regenerate).toHaveBeenLastCalledWith(
      graph().customData!.fcPlot.plot,
      graph().strokeColor,
      { width: graph().strokeWidth, strokeStyle: "dashed" },
    );
    act(() => api.executeAction("undo"));
    await waitFor(() => expect(graph().strokeStyle).toBe("solid"));
    const restoredGraph = graph();
    expect(restoredGraph.type === "image" && restoredGraph.fileId).toBe(
      before.type === "image" && before.fileId,
    );
    act(() =>
      api.updateScene({
        appState: objectSelection([graph()]),
        captureUpdate: CaptureUpdateAction.NEVER,
      }),
    );
    await act(async () => {
      await classroomCommands.execute({
        name: "canvas.style",
        args: { width: 6, strokeStyle: "dashed" },
      });
    });
    expect(graph()).toMatchObject({ strokeWidth: 6, strokeStyle: "dashed" });
    const rect = canvas().getBoundingClientRect();
    fireEvent.wheel(canvas(), {
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      deltaY: -160,
    });
    await waitFor(() =>
      expect(graph().customData!.fcPlot.plot.view).toBeDefined(),
    );
    expect(regenerate).toHaveBeenLastCalledWith(
      graph().customData!.fcPlot.plot,
      graph().strokeColor,
      { width: 6, strokeStyle: "dashed" },
    );
    expect(
      document
        .querySelector(".fc-inline-function-object")!
        .querySelector("button,input,textarea,form,nav,output"),
    ).toBeNull();
  } finally {
    stop();
  }
});

it("starts a direct two-contact graph zoom from its floating surface without prior selection or a board gesture", async () => {
  const { api, graph, canvas } = await setup();
  const before = graph();
  act(() =>
    api.updateScene({
      appState: { selectedElementIds: {}, selectedGroupIds: {} },
    }),
  );
  expect(document.querySelector(".fc-inline-function canvas")).toBeNull();
  const surface = document.getElementById(`fc-inline-function-${before.id}`)!;
  const state = api.getAppState();
  const x =
    (before.x + before.width * 0.4 + state.scrollX) * state.zoom.value +
    state.offsetLeft;
  const y =
    (before.y + before.height * 0.5 + state.scrollY) * state.zoom.value +
    state.offsetTop;
  fireEvent.pointerDown(surface, {
    pointerId: 41,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  expect(api.getAppState().selectedElementIds[before.id]).toBe(true);
  expect(canvas()).not.toBeNull();
  expect(api.getAppState().cursorButton).toBe("up");
  fireEvent.pointerDown(canvas(), {
    pointerId: 42,
    pointerType: "touch",
    button: 0,
    clientX: x + 100,
    clientY: y,
  });
  fireEvent.pointerMove(canvas(), {
    pointerId: 42,
    pointerType: "touch",
    clientX: x + 180,
    clientY: y,
  });
  fireEvent.pointerUp(canvas(), {
    pointerId: 42,
    pointerType: "touch",
    clientX: x + 180,
    clientY: y,
  });
  fireEvent.pointerUp(canvas(), {
    pointerId: 41,
    pointerType: "touch",
    clientX: x,
    clientY: y,
  });
  await waitFor(() =>
    expect(graph().customData?.fcPlot.plot.view).toBeDefined(),
  );
  expect(graph()).toMatchObject({
    x: before.x,
    y: before.y,
    width: before.width,
    height: before.height,
  });
  expect(api.getAppState().zoom.value).toBe(state.zoom.value);
  expect(api.getAppState().cursorButton).toBe("up");
});

it("keeps floating graph touches off the writing plane and releases its live Canvas after an unselected pinch", async () => {
  const { api, graph } = await setup();
  act(() => {
    api.setActiveTool({ type: "freedraw" });
    api.updateScene({
      appState: { selectedElementIds: {}, selectedGroupIds: {} },
    });
  });
  const before = graph();
  const surface = document.getElementById(`fc-inline-function-${before.id}`)!;
  expect(surface).not.toBeNull();
  expect(surface.querySelector("canvas")).toBeNull();
  fireEvent.pointerDown(surface, {
    pointerId: 61,
    pointerType: "touch",
    button: 0,
    clientX: 200,
    clientY: 220,
  });
  const canvas = surface.querySelector("canvas")!;
  expect(canvas).not.toBeNull();
  fireEvent.pointerDown(canvas, {
    pointerId: 62,
    pointerType: "touch",
    button: 0,
    clientX: 300,
    clientY: 220,
  });
  fireEvent.pointerMove(canvas, {
    pointerId: 62,
    pointerType: "touch",
    clientX: 370,
    clientY: 220,
  });
  fireEvent.pointerUp(canvas, {
    pointerId: 62,
    pointerType: "touch",
    clientX: 370,
    clientY: 220,
  });
  fireEvent.pointerUp(canvas, {
    pointerId: 61,
    pointerType: "touch",
    clientX: 200,
    clientY: 220,
  });
  await waitFor(() =>
    expect(graph().customData?.fcPlot.plot.view).toBeDefined(),
  );
  expect(api.getSceneElements()).toHaveLength(1);
  expect(api.getAppState().activeTool.type).toBe("freedraw");
  expect(surface.querySelector("canvas")).toBeNull();
  expect(surface.querySelector("img")).not.toBeNull();
});

it.each(["sendBackward", "sendToBack"] as const)(
  "returns a floating graph to the writable board through %s and restores its plane with undo",
  async (action) => {
    const { api, graph } = await setup();
    const before = graph();
    const stop = registerCanvasCommands(api);
    try {
      await act(async () => {
        await classroomCommands.execute({
          name: "canvas.action",
          args: { action },
        });
      });
      expect(graph().customData?.fcPlot.layer).toBe("board");
      expect(
        document.getElementById(`fc-inline-function-${before.id}`),
      ).toBeNull();
      expect(api.getAppState().selectedElementIds[before.id]).toBe(true);
      act(() =>
        api.updateScene({
          appState: { selectedElementIds: {}, selectedGroupIds: {} },
        }),
      );
      expect(
        document.getElementById(`fc-inline-function-${before.id}`),
      ).toBeNull();
      act(() => api.executeAction("undo"));
      await waitFor(() =>
        expect(graph().customData?.fcPlot.layer).toBe("floating"),
      );
      expect(
        document.getElementById(`fc-inline-function-${before.id}`),
      ).not.toBeNull();
      act(() => api.updateScene({ appState: objectSelection([graph()]) }));
      await act(async () => {
        await classroomCommands.execute({
          name: "canvas.action",
          args: { action },
        });
      });
      act(() => {
        api.setActiveTool({ type: "freedraw" });
        api.updateScene({
          appState: { selectedElementIds: {}, selectedGroupIds: {} },
        });
      });
      const board =
        document.querySelector<HTMLCanvasElement>("canvas.interactive")!;
      const x = before.x + before.width / 2;
      const y = before.y + before.height / 2;
      fireEvent.pointerDown(board, {
        pointerId: 71,
        pointerType: "pen",
        button: 0,
        clientX: x,
        clientY: y,
        pressure: 0.5,
      });
      fireEvent.pointerMove(board, {
        pointerId: 71,
        pointerType: "pen",
        clientX: x + 30,
        clientY: y + 20,
        pressure: 0.5,
      });
      fireEvent.pointerUp(board, {
        pointerId: 71,
        pointerType: "pen",
        clientX: x + 60,
        clientY: y + 30,
        pressure: 0.5,
      });
      expect(
        api.getSceneElements().some((element) => element.type === "freedraw"),
      ).toBe(true);
      expect(graph().id).toBe(before.id);
      act(() => {
        api.setActiveTool({ type: "selection" });
        api.updateScene({ appState: objectSelection([graph()]) });
      });
      await act(async () => {
        await classroomCommands.execute({
          name: "canvas.action",
          args: {
            action: action === "sendBackward" ? "bringForward" : "bringToFront",
          },
        });
      });
      expect(graph().customData?.fcPlot.layer).toBe("floating");
      expect(
        document.getElementById(`fc-inline-function-${before.id}`),
      ).not.toBeNull();
    } finally {
      stop();
    }
  },
);

it.each(["pointerup", "pointercancel"] as const)(
  "keeps palm erasure on a floating graph in the shared scene eraser through %s",
  async (end) => {
    const { api, graph } = await setup();
    const before = graph();
    act(() => {
      api.setActiveTool({ type: "freedraw" });
      api.updateScene({
        appState: {
          selectedElementIds: {},
          selectedGroupIds: {},
          eraserMode: "object",
        },
      });
    });
    const surface = document.getElementById(`fc-inline-function-${before.id}`)!;
    const x = before.x + before.width / 2;
    const y = before.y + before.height / 2;
    fireEvent.pointerDown(surface, {
      pointerId: 81,
      pointerType: "touch",
      button: 0,
      clientX: x,
      clientY: y,
      width: 90,
      height: 80,
    });
    expect(api.getSceneElements()).toHaveLength(0);
    expect(document.querySelector(".fc-inline-function canvas")).toBeNull();
    fireEvent(
      window,
      new PointerEvent(end, {
        pointerId: 81,
        pointerType: "touch",
        clientX: x,
        clientY: y,
        bubbles: true,
      }),
    );
    expect(api.getAppState().cursorButton).toBe("up");
    if (end === "pointerup") {
      expect(api.getSceneElements()).toHaveLength(0);
      act(() => api.executeAction("undo"));
    }
    if (end === "pointercancel") {
      expect(api.getSceneElements()).toEqual([before]);
    } else {
      const { version: _version, versionNonce: _nonce, ...semantic } = before;
      expect(api.getSceneElements()).toHaveLength(1);
      expect(api.getSceneElements()[0]).toMatchObject(semantic);
      expect(api.getSceneElements()[0].version).toBeGreaterThan(before.version);
    }
  },
);
