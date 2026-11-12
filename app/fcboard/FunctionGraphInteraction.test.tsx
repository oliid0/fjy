import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { Fcboard } from "@fcboard/fcboard";
import { convertToFcboardElements } from "@fcboard/fcboard";
import { newFreeDrawElement } from "@fcboard/element";
import { pointFrom } from "@fcboard/math";
import { render as renderEditor } from "@fcboard/fcboard/tests/test-utils";
import {
  EditorJotaiProvider,
  editorJotaiStore,
} from "@fcboard/fcboard/editor-jotai";
import { createInlineVegaView } from "@fcboard/fcboard/visualizationRuntime";

import type { Spec } from "@fcboard/fcboard/visualizationRuntime";

import { drawPlot, objectSelection } from "./board";
import { defaultPlot } from "./math";
import { localMathResult } from "./mathRecognition";
import { FunctionGraphInteraction } from "./FunctionGraphInteraction";
import {
  functionGraphResource,
  restoreDocumentFunctionGraphs,
} from "./functionGraphResource";
import { functionGraphImage } from "./functionVisualization";
import { documentStrokeBounds } from "./documents";
import * as ocr from "./ocr";

import type { DocumentInk, InkStroke } from "./documents";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const setup = async (expression = "x") => {
  await renderEditor(
    <EditorJotaiProvider store={editorJotaiStore}>
      <Fcboard UIOptions={{ unifiedToolbar: true }} />
    </EditorJotaiProvider>,
  );
  window.h.state.width = 1600;
  window.h.state.height = 900;
  const api = window.h.app.api;
  let ids: string[] = [];
  act(() => {
    ids = drawPlot(api, { ...defaultPlot, expression }, { x: 350, y: 300 });
    api.setActiveTool({ type: "selection" });
    api.updateScene({
      appState: objectSelection(
        api.getSceneElements().filter((element) => ids.includes(element.id)),
      ),
    });
  });
  const { render } = await import("./test/render");
  render(<FunctionGraphInteraction api={api} />);
  const graph = () =>
    api.getSceneElements().find((element) => ids.includes(element.id))!;
  let frame!: HTMLIFrameElement;
  await waitFor(() => {
    frame = document.querySelector(
      `iframe[data-resource-object-id="${ids[0]}"]`,
    )!;
    expect(frame).not.toBeNull();
    expect(frame).toHaveAttribute("aria-busy", "false");
  });
  const reply = vi
    .spyOn(frame.contentWindow!, "postMessage")
    .mockImplementation(() => {});
  const send = (
    type: string,
    extra: Record<string, unknown> = {},
    source = frame.contentWindow,
  ) => {
    act(() =>
      fireEvent(
        window,
        new MessageEvent("message", {
          source,
          data: {
            channel: "fc-function-graph",
            id: graph().customData!.fcInteractiveResource.id,
            request: 1,
            type,
            view: { left: -10, right: 10, bottom: -10, top: 10 },
            ...extra,
          },
        }),
      ),
    );
  };
  return { api, graph, frame, reply, send };
};

it("inserts transparent axes without range chrome and preserves Vega pan/pinch signals", async () => {
  const { graph, frame } = await setup();
  expect(graph().type).toBe("iframe");
  expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  const resource = graph().customData!.fcInteractiveResource;
  const html = new DOMParser().parseFromString(resource.html, "text/html");
  expect(html.querySelectorAll("input[data-bound]")).toHaveLength(0);
  expect(html.querySelector("nav")?.childElementCount).toBe(0);
  expect(html.querySelector("output")?.textContent).toBe("");
  expect(
    [...html.querySelectorAll("style")].some((style) =>
      style.textContent?.includes("nav:empty,output:empty{display:none}"),
    ),
  ).toBe(true);
  expect(html.querySelector("output")).not.toBeNull();
  expect(html.querySelector("svg .mark-line path")).not.toBeNull();
  const view = createInlineVegaView(resource.visualization.spec as Spec);
  try {
    view.run();
    expect(view.signal("xdom")).toEqual([-10, 10]);
    view.signal("xdom", [-2, 3]).run();
    expect(view.scale("x")(-2)).toBeCloseTo(0);
    expect(view.scale("x")(3)).toBeCloseTo(view.width());
  } finally {
    view.finalize();
  }
});

it("queries exact curve values and resamples another range without rewriting canvas objects or image files", async () => {
  const { api, graph, send, reply } = await setup();
  const before = graph();
  const files = Object.keys(api.getFiles());
  const zoom = api.getAppState().zoom.value;
  send("point", { point: [0.5, 0.5], width: 440, height: 400 });
  expect(reply).toHaveBeenLastCalledWith(
    expect.objectContaining({
      type: "point",
      point: { expression: "x", x: 0, y: 0 },
    }),
    "*",
  );
  send("sample", { view: { left: 10, right: 20, bottom: 10, top: 20 } });
  const data = reply.mock.lastCall![0].points as { x: number; y: number }[];
  expect(data.length).toBeGreaterThan(2);
  expect(data.every(({ x, y }) => x >= 10 && x <= 20 && y === x)).toBe(true);
  expect(graph()).toBe(before);
  expect(Object.keys(api.getFiles())).toEqual(files);
  expect(api.getAppState().zoom.value).toBe(zoom);
});

it("persists a completed range on the same movable/resizable object and undoes the whole gesture once", async () => {
  const { api, graph, frame, reply, send } = await setup();
  const before = graph();
  const documentBefore = frame.srcdoc;
  const bounds = { left: -2, right: 4, bottom: -3, top: 5 };
  send("commit", { view: bounds });
  await waitFor(() =>
    expect(graph().customData!.fcPlot.plot.view).toEqual(bounds),
  );
  expect(graph()).toMatchObject({
    id: before.id,
    x: before.x,
    y: before.y,
    width: before.width,
    height: before.height,
    groupIds: before.groupIds,
  });
  expect(
    document.querySelector(`iframe[data-resource-object-id="${before.id}"]`),
  ).toBe(frame);
  expect(frame.srcdoc).toBe(documentBefore);
  expect(graph().customData!.fcInteractiveResource.html).not.toBe(
    before.customData!.fcInteractiveResource.html,
  );
  expect(reply).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: "restore", view: bounds }),
    "*",
  );
  expect(Object.keys(api.getFiles())).toHaveLength(0);
  fireEvent.click(screen.getByTestId("button-undo"));
  await waitFor(() =>
    expect(graph().customData!.fcPlot.plot.view).toBeUndefined(),
  );
  expect(frame.srcdoc).toBe(documentBefore);
  expect(reply).toHaveBeenLastCalledWith(
    expect.objectContaining({
      type: "restore",
      view: { left: -10, right: 10, bottom: -10, top: 10 },
    }),
    "*",
  );
});

it("rejects forged sources and invalid domains without touching the board", async () => {
  const { graph, send, reply } = await setup();
  const before = graph();
  send("commit", { view: { left: 1, right: 1, bottom: -1, top: 1 } });
  send("point", { point: [0.5, 0.5], width: 440, height: 400 }, window);
  send("sample", {
    view: { left: -Infinity, right: 20, bottom: -10, top: 10 },
  });
  expect(reply).not.toHaveBeenCalled();
  expect(graph()).toBe(before);
});
it("updates a real parameter on the same iframe and restores it on undo", async () => {
  const { api, graph, frame, send, reply } = await setup("a*x+1");
  const html = frame.getAttribute("srcdoc");
  expect(html).toContain('data-parameter="a"');
  send("commit", { parameters: { a: 2 } });
  await waitFor(() => expect(graph().customData!.fcPlot.plot.a).toBe(2));
  expect(
    document.querySelector(`iframe[data-resource-object-id="${graph().id}"]`),
  ).toBe(frame);
  expect(frame.getAttribute("srcdoc")).toBe(html);
  expect(reply).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "restore",
      parameters: { a: 2, b: defaultPlot.b, c: defaultPlot.c },
    }),
    "*",
  );
  send("sample");
  const points = reply.mock.lastCall![0].points as { x: number; y: number }[];
  expect(points.every(({ x, y }) => Math.abs(y - (2 * x + 1)) < 1e-9)).toBe(
    true,
  );
  fireEvent.click(screen.getByTestId("button-undo"));
  await waitFor(() => expect(graph().customData!.fcPlot.plot.a).toBe(1));
  expect(frame.getAttribute("srcdoc")).toBe(html);
  expect(
    api
      .getSceneElements()
      .filter((element) => !element.isDeleted && element.type === "iframe"),
  ).toHaveLength(1);
});

it("keeps comparison curves in one coordinate system and preserves them through serialization", () => {
  const result = localMathResult("y=x\ny=x^2", "function");
  if (result.kind !== "function") {
    throw new Error("Expected functions");
  }
  expect(result.plot.compare).toEqual(["x^2"]);
  const resource = functionGraphResource(result.plot, "#000000", "comparison");
  const view = createInlineVegaView(resource.visualization!.spec as Spec);
  try {
    view.run();
    const points = view.data("curves") as {
      expression: string;
      color: string;
    }[];
    expect(new Set(points.map((point) => point.expression)).size).toBe(2);
    expect(new Set(points.map((point) => point.color)).size).toBe(2);
  } finally {
    view.finalize();
  }
  expect(
    JSON.parse(JSON.stringify(resource)).visualization.spec.signals.some(
      (signal: { name: string }) => signal.name === "dist2",
    ),
  ).toBe(true);
});
it("automatically compares two selected expressions in function mode without deleting their source", async () => {
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
    type: "iframe",
    customData: { fcPlot: { plot: { expression: "x", compare: ["x^2"] } } },
  });
  expect(api.getSceneElements().slice(0, 2)).toEqual(source);
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(
    api.getSceneElements().filter((element) => element.type === "iframe"),
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
    await waitFor(() => expect(recognize).toHaveBeenCalledTimes(2));
    expect(api.getSceneElements()).toEqual(source);
    if (erase) {
      act(() => api.updateScene({ elements: [] }));
    }
    await act(async () => {
      pending[1]("y=x^2");
      pending[0]("y=x");
    });
    if (erase) {
      expect(api.getSceneElements()).toEqual([]);
    } else {
      await waitFor(() =>
        expect(
          api.getSceneElements().filter((element) => element.type === "iframe"),
        ).toHaveLength(1),
      );
      expect(
        api.getSceneElements().find((element) => element.type === "iframe")
          ?.customData?.fcPlot.plot.compare,
      ).toEqual(["x^2"]);
    }
  },
);
it("restores saved courseware SVG graphs as interactive objects without moving them or changing unrelated ink", () => {
  const legacy: InkStroke = {
    id: "old-graph",
    color: "#123456",
    width: 0,
    points: [[240, 180]],
    anchor: { x: 240, y: 180 },
    image: functionGraphImage(defaultPlot, "#123456"),
    imageWidth: 490,
    imageHeight: 440,
    plot: {
      id: "plot-group",
      renderer: "vega",
      plot: defaultPlot,
      origin: { x: 100, y: 100 },
      position: { x: 345, y: 320 },
    },
  };
  const note: InkStroke = {
    id: "note",
    color: "#000000",
    width: 2,
    points: [
      [10, 10],
      [30, 30],
    ],
  };
  const original: DocumentInk = { 0: [legacy, note] };
  const restored = restoreDocumentFunctionGraphs(original);
  expect(restored[0][0]).toMatchObject({
    id: legacy.id,
    shapeType: "iframe",
    resource: { id: "plot-group", width: 490, height: 440 },
    plot: { renderer: "iframe" },
  });
  expect(documentStrokeBounds(restored[0][0])).toEqual(
    documentStrokeBounds(legacy),
  );
  expect(restored[0][1]).toBe(note);
  expect(original[0][0]).toBe(legacy);
  expect(restoreDocumentFunctionGraphs(restored)).toBe(restored);
  const invalid = {
    ...legacy,
    plot: {
      ...legacy.plot!,
      plot: { ...defaultPlot, expression: "unknown(x)" },
    },
  };
  expect(restoreDocumentFunctionGraphs({ 0: [invalid] })[0][0]).toBe(invalid);
});

it("automatically adds a nearby function-pen expression to the same axes without a selection", async () => {
  const { api } = await setup();
  act(() => api.updateScene({ elements: [] }));
  const first = localMathResult("y=x", "function");
  const second = localMathResult("y=x^2", "function");
  if (first.kind !== "function" || second.kind !== "function") {
    throw new Error("Invalid fixture");
  }
  const bounds = { left: 100, top: 100, right: 220, bottom: 140 };
  act(() => {
    drawPlot(api, first.plot, { x: 450, y: 300 }, [], "first", true, bounds);
  });
  const original = api
    .getSceneElements()
    .find((element) => element.type === "iframe")!;
  act(() => {
    drawPlot(api, second.plot, { x: 450, y: 380 }, [], "second", true, {
      ...bounds,
      top: 180,
      bottom: 220,
    });
  });
  const graphs = api
    .getSceneElements()
    .filter((element) => element.type === "iframe");
  expect(graphs).toHaveLength(1);
  expect(graphs[0]).toMatchObject({
    id: original.id,
    x: original.x,
    y: original.y,
    width: original.width,
    height: original.height,
    customData: { fcPlot: { plot: { expression: "x", compare: ["x^2"] } } },
  });
  act(() => {
    drawPlot(api, second.plot, { x: 750, y: 380 }, [], "far", true, {
      left: 800,
      top: 100,
      right: 900,
      bottom: 140,
    });
  });
  expect(
    api.getSceneElements().filter((element) => element.type === "iframe"),
  ).toHaveLength(2);
});
