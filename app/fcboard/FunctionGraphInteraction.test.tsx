import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { Fcboard, CaptureUpdateAction } from "@fcboard/fcboard";
import { render as renderEditor } from "@fcboard/fcboard/tests/test-utils";
import {
  EditorJotaiProvider,
  editorJotaiStore,
} from "@fcboard/fcboard/editor-jotai";
import { t } from "@fcboard/fcboard/i18n";

import { drawPlot, objectSelection } from "./board";
import { defaultPlot } from "./math";
import { FunctionGraphInteraction } from "./FunctionGraphInteraction";

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
  const api = window.h.app.api;
  let ids: string[] = [];
  act(() => {
    ids = drawPlot(
      api,
      { ...defaultPlot, expression: "x" },
      { x: 350, y: 300 },
    );
    api.updateScene({
      appState: objectSelection(
        api.getSceneElements().filter((element) => ids.includes(element.id)),
      ),
    });
  });
  const { render } = await import("./test/render");
  const view = render(<FunctionGraphInteraction api={api} />);
  const graph = () =>
    api.getSceneElements().find((element) => ids.includes(element.id))!;
  const state = api.getAppState();
  const image = graph();
  const x =
    (image.x + image.width * 0.52 + state.scrollX) * state.zoom.value +
    state.offsetLeft;
  const y =
    (image.y + image.height * 0.5 + state.scrollY) * state.zoom.value +
    state.offsetTop;
  const canvas =
    document.querySelector<HTMLCanvasElement>("canvas.interactive")!;
  return { api, graph, x, y, canvas, view };
};

it("shows x/y on a curve tap, leaves empty-space drags with the editor and adds no sliders", async () => {
  const { x, y, canvas, graph } = await setup();
  const delegate = vi.fn();
  canvas.addEventListener("pointerdown", delegate);
  fireEvent.pointerDown(canvas, {
    clientX: x,
    clientY: y,
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
  });
  fireEvent.pointerUp(canvas, {
    clientX: x,
    clientY: y,
    pointerId: 1,
    pointerType: "mouse",
  });
  expect(
    screen.getByLabelText(t("fcboard.interactive_function_plot")),
  ).toHaveTextContent("x=0, y=0");
  expect(delegate).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("slider", {
      name: t("fcboard.adjust_key", { key: "x" }),
    }),
  ).toBeNull();
  fireEvent.pointerDown(canvas, {
    clientX: x - 80,
    clientY: y - 80,
    pointerId: 2,
    pointerType: "mouse",
    button: 0,
  });
  expect(delegate).toHaveBeenCalledOnce();
  fireEvent.pointerCancel(canvas, { pointerId: 2, pointerType: "mouse" });
  expect(graph().customData?.fcPlot.plot.view).toBeUndefined();
  canvas.removeEventListener("pointerdown", delegate);
});

it("resamples a wheel zoom while retaining object geometry and undoes the whole gesture once", async () => {
  const { api, x, y, canvas, graph } = await setup();
  const original = graph();
  fireEvent.wheel(canvas, { clientX: x, clientY: y, deltaY: -100 });
  await waitFor(() =>
    expect(graph().customData?.fcPlot.plot.view).toBeDefined(),
  );
  expect(graph()).toMatchObject({
    id: original.id,
    x: original.x,
    y: original.y,
    width: original.width,
    height: original.height,
    angle: original.angle,
    groupIds: original.groupIds,
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  fireEvent.click(screen.getByTestId("button-undo"));
  await waitFor(() =>
    expect(graph().customData?.fcPlot.plot.view).toBeUndefined(),
  );
  expect(api.getSceneElements()).toHaveLength(1);
});

it("takes over two touch contacts for graph zoom without zooming the board", async () => {
  const { api, x, y, canvas, graph } = await setup();
  const zoom = api.getAppState().zoom.value;
  fireEvent.pointerDown(canvas, {
    clientX: x,
    clientY: y,
    pointerId: 1,
    pointerType: "touch",
    button: 0,
  });
  fireEvent.pointerDown(canvas, {
    clientX: x + 40,
    clientY: y,
    pointerId: 2,
    pointerType: "touch",
    button: 0,
  });
  fireEvent.pointerMove(canvas, {
    clientX: x + 100,
    clientY: y,
    pointerId: 2,
    pointerType: "touch",
  });
  await waitFor(() =>
    expect(graph().customData?.fcPlot.plot.view).toBeDefined(),
  );
  fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "touch" });
  fireEvent.pointerUp(canvas, { pointerId: 2, pointerType: "touch" });
  expect(api.getAppState().zoom.value).toBe(zoom);
  expect(graph().customData?.fcPlot.plot.range).toBeLessThan(10);
});

it("discards a pending zoom when a different graph is selected", async () => {
  const { api, x, y, canvas, graph } = await setup();
  let second: string[] = [];
  act(() => {
    second = drawPlot(
      api,
      { ...defaultPlot, expression: "x^2" },
      { x: 1100, y: 400 },
    );
  });
  fireEvent.wheel(canvas, { clientX: x, clientY: y, deltaY: -100 });
  act(() =>
    api.updateScene({
      appState: { selectedElementIds: { [second[0]]: true } },
      captureUpdate: CaptureUpdateAction.NEVER,
    }),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  expect(graph().customData?.fcPlot.plot.view).toBeUndefined();
  expect(
    api.getSceneElements().find((element) => second.includes(element.id))
      ?.customData?.fcPlot.plot,
  ).toMatchObject({ expression: "x^2", range: 10 });
});

it("reuses one preview file across many frames and keeps committed pixels for undo/redo", async () => {
  const { api, x, y, canvas, graph } = await setup();
  const original = graph();
  const initialHistory = window.h.history.undoStack.length;
  if (original.type !== "image" || !original.fileId) {
    throw new Error("Expected a function image");
  }
  const originalData = api.getFiles()[original.fileId].dataURL;
  const initialCount = Object.keys(api.getFiles()).length;
  const ids = new Set<string>();
  for (let index = 0; index < 8; index++) {
    const range = graph().customData!.fcPlot.plot.range;
    fireEvent.wheel(canvas, { clientX: x, clientY: y, deltaY: -10 });
    await waitFor(() =>
      expect(graph().customData!.fcPlot.plot.range).toBeLessThan(range),
    );
    const current = graph();
    if (current.type !== "image" || !current.fileId) {
      throw new Error("Expected a function image");
    }
    ids.add(current.fileId);
    expect(Object.keys(api.getFiles())).toHaveLength(initialCount + 1);
    expect(api.getFiles()[original.fileId].dataURL).toBe(originalData);
  }
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  expect(ids.size).toBe(1);
  expect(window.h.history.undoStack).toHaveLength(initialHistory + 1);
  expect(Object.keys(api.getFiles())).toHaveLength(initialCount + 1);
  const first = graph();
  if (first.type !== "image" || !first.fileId) {
    throw new Error("Expected a function image");
  }
  const firstData = api.getFiles()[first.fileId].dataURL;
  fireEvent.wheel(canvas, { clientX: x, clientY: y, deltaY: -30 });
  await waitFor(() =>
    expect(Object.keys(api.getFiles())).toHaveLength(initialCount + 2),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  expect(api.getFiles()[first.fileId].dataURL).toBe(firstData);
  expect(window.h.history.undoStack).toHaveLength(initialHistory + 2);
  fireEvent.click(screen.getByTestId("button-undo"));
  await waitFor(() => expect(graph()).toMatchObject({ fileId: first.fileId }));
  expect(api.getFiles()[first.fileId].dataURL).toBe(firstData);
  // The native toolbar suppresses the same command for 400 ms.
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 401);
  fireEvent.click(screen.getByTestId("button-undo"));
  await waitFor(() =>
    expect(graph()).toMatchObject({ fileId: original.fileId }),
  );
  fireEvent.click(screen.getByTestId("button-redo"));
  await waitFor(() => expect(graph()).toMatchObject({ fileId: first.fileId }));
  expect(api.getFiles()[first.fileId].dataURL).toBe(firstData);
});
