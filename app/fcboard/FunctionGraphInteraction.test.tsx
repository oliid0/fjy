import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { Fcboard, convertToFcboardElements } from "@fcboard/fcboard";
import { newFreeDrawElement } from "@fcboard/element";
import { pointFrom } from "@fcboard/math";
import { render as renderEditor } from "@fcboard/fcboard/tests/test-utils";
import { createInlineVegaView } from "@fcboard/fcboard/visualizationRuntime";
import { t } from "@fcboard/fcboard/i18n";

import { drawPlot, objectSelection, updateFunctionGraph } from "./board";
import { defaultPlot } from "./math";
import { localFunctionResult } from "./mathRecognition";
import { FunctionGraphInteraction } from "./FunctionGraphInteraction";
import { functionGraphSpec } from "./functionVisualization";
import { functionGraphNavigation } from "./functionGraphNavigation";
import * as ocr from "./ocr";

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
    });
  });
  const { render } = await import("./test/render");
  render(<FunctionGraphInteraction api={api} />);
  await waitFor(() =>
    expect(
      document.querySelector(".fc-inline-function svg .mark-line path"),
    ).not.toBeNull(),
  );
  const graph = () =>
    api.getSceneElements().find((element) => ids.includes(element.id))!;
  const svg = () =>
    document.querySelector<SVGSVGElement>(".fc-inline-function svg")!;
  return { api, graph, svg };
};
it("inserts one saved transparent SVG object and renders a direct Vega SVG with no iframe or window chrome", async () => {
  const { api, graph, svg } = await setup();
  expect(graph().type).toBe("image");
  expect(graph().customData!.fcPlot.renderer).toBe("vega");
  expect(graph().customData!.fcInteractiveResource).toBeUndefined();
  expect(document.querySelector("iframe[data-resource-object-id]")).toBeNull();
  expect(document.querySelector(".fc-resource-window")).toBeNull();
  expect(svg()).toHaveAttribute("viewBox", "0 0 500 440");
  expect(document.querySelector(".fc-inline-function")).toHaveAttribute(
    "aria-label",
    "y = x",
  );
  const element = graph();
  if (element.type !== "image" || !element.fileId) {
    throw new Error("Expected SVG image");
  }
  expect(api.getFiles()[element.fileId].mimeType).toBe("image/svg+xml");
});
it("queries a clicked curve and persists a real Vega wheel domain on the same object", async () => {
  const { graph, svg } = await setup();
  const before = graph();
  fireEvent.click(svg(), { clientX: 260, clientY: 220 });
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("y = x"),
  );
  expect(screen.getByRole("status")).toHaveTextContent("x = 0, y = 0");
  fireEvent.wheel(svg(), {
    clientX: 260,
    clientY: 220,
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
});
it("commits one parameter gesture and undoes the saved SVG without changing object bounds", async () => {
  const { api, graph } = await setup("a*x+1");
  const before = graph();
  const slider = screen.getByRole("slider", {
    name: t("fcboard.adjust_key", { key: "a" }),
  });
  fireEvent.input(slider, { target: { value: "2" } });
  expect(graph().customData!.fcPlot.plot.a).toBe(1);
  fireEvent.pointerUp(slider);
  await waitFor(() => expect(graph().customData!.fcPlot.plot.a).toBe(2));
  expect(graph()).toMatchObject({
    id: before.id,
    x: before.x,
    y: before.y,
    width: before.width,
    height: before.height,
  });
  act(() => {
    updateFunctionGraph(
      api,
      { ...graph().customData!.fcPlot.plot, a: 3 },
      { ids: [before.id] },
    );
  });
  await waitFor(() => expect(graph().customData!.fcPlot.plot.a).toBe(3));
  fireEvent.click(screen.getByTestId("button-undo"));
  await waitFor(() => expect(graph().customData!.fcPlot.plot.a).toBe(2));
});

it("keeps comparison curves in one coordinate system and preserves them through serialization", () => {
  const result = localFunctionResult("y=x\ny=x^2");
  if (result.kind !== "function") {
    throw new Error("Expected functions");
  }
  expect(result.plot.compare).toEqual(["x^2"]);
  const spec = functionGraphSpec(result.plot, "#000000");
  spec.signals = functionGraphNavigation(result.plot);
  const view = createInlineVegaView(spec);
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
    JSON.parse(JSON.stringify(spec)).signals.some(
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
it("automatically adds a nearby function-pen expression to the same axes without a selection", async () => {
  const { api } = await setup();
  act(() => api.updateScene({ elements: [] }));
  const first = localFunctionResult("y=x");
  const second = localFunctionResult("y=x^2");
  if (first.kind !== "function" || second.kind !== "function") {
    throw new Error("Invalid fixture");
  }
  const bounds = { left: 100, top: 100, right: 220, bottom: 140 };
  act(() => {
    drawPlot(api, first.plot, { x: 450, y: 300 }, [], "first", true, bounds);
  });
  const original = api
    .getSceneElements()
    .find((element) => element.type === "image")!;
  act(() => {
    drawPlot(api, second.plot, { x: 450, y: 380 }, [], "second", true, {
      ...bounds,
      top: 180,
      bottom: 220,
    });
  });
  const graphs = api
    .getSceneElements()
    .filter((element) => element.type === "image");
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
    api.getSceneElements().filter((element) => element.type === "image"),
  ).toHaveLength(2);
});
