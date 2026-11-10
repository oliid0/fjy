import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { Fcboard } from "@fcboard/fcboard";
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
import { functionGraphResource } from "./functionGraphResource";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const setup = async () => {
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
    ids = drawPlot(
      api,
      { ...defaultPlot, expression: "x" },
      { x: 350, y: 300 },
    );
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

it("inserts a selectable iframe object with real range controls and Vega pan/pinch signals", async () => {
  const { graph, frame } = await setup();
  expect(graph().type).toBe("iframe");
  expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  const resource = graph().customData!.fcInteractiveResource;
  const html = new DOMParser().parseFromString(resource.html, "text/html");
  expect(html.querySelectorAll("input[data-bound]")).toHaveLength(4);
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
