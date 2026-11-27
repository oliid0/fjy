import {
  act,
  cleanup,
  fireEvent,
  render as renderComponent,
  screen,
  waitFor,
} from "@testing-library/react";
import { Fcboard } from "@fcboard/fcboard";
import {
  saveToolbarItems,
  TOOLBAR_STORAGE,
} from "@fcboard/fcboard/toolbarPreferences";
import { t } from "@fcboard/fcboard/i18n";
import { CaptureUpdateAction } from "@fcboard/element";
import { render as editor } from "@fcboard/fcboard/tests/test-utils";

import { selectedRegion } from "@fcboard/fcboard/lasso/region";

import { API } from "@fcboard/fcboard/tests/helpers/api";

import { NativeInkInteraction } from "./NativeInkInteraction";
import { FunctionGraphInteraction } from "./FunctionGraphInteraction";
import { drawPlot } from "./board";
import { defaultPlot } from "./math";
import { classroomCommands } from "./commands";
import { render } from "./test/render";

const backend = vi.hoisted(() => ({
  ready: vi.fn(),
  configure: vi.fn(),
  remove: vi.fn(),
  acknowledge: vi.fn(),
  release: vi.fn(),
  synchronize: vi.fn(),
  erase: vi.fn(),
  listeners: new Set<(event: Record<string, unknown>) => void>(),
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => "android", isNativePlatform: () => true },
  registerPlugin: () => ({
    ...backend,
    addListener: (
      _event: string,
      callback: (event: Record<string, unknown>) => void,
    ) => {
      backend.listeners.add(callback);
      return Promise.resolve({
        remove: async () => {
          backend.listeners.delete(callback);
        },
      });
    },
  }),
}));
beforeEach(() => {
  localStorage.removeItem(TOOLBAR_STORAGE);
  backend.ready.mockReset().mockResolvedValue(undefined);
  backend.configure.mockReset().mockResolvedValue(undefined);
  backend.remove.mockReset().mockResolvedValue(undefined);
  backend.acknowledge.mockReset().mockResolvedValue(undefined);
  backend.release.mockReset().mockResolvedValue(undefined);
  backend.synchronize.mockReset().mockResolvedValue(undefined);
  backend.erase.mockReset().mockResolvedValue({ patches: [] });
});
afterEach(() => {
  cleanup();
  backend.listeners.clear();
});

it.each([
  "text",
  "shape",
  "magic",
  "function",
  "calculation",
  "language",
] as const)(
  "enforces single-contact native %s recognition and restores ordinary multipoint writing",
  async (mode) => {
    await editor(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
    const api = window.h.app.api;
    act(() => {
      api.updateScene({
        appState: {
          width: 1000,
          height: 700,
          currentItemInkAssist: mode,
          multiStroke: true,
        },
      });
      api.setActiveTool({ type: "freedraw" });
    });
    render(<NativeInkInteraction api={api} />);
    await waitFor(() =>
      expect(backend.configure.mock.calls.at(-1)?.[0]).toMatchObject({
        enabled: true,
        mode: "pen",
        multiStroke: false,
        recognitionEnabled: true,
      }),
    );
    act(() => api.updateScene({ appState: { multiStroke: false } }));
    await waitFor(() =>
      expect(backend.configure.mock.calls.at(-1)?.[0]).toMatchObject({
        enabled: true,
        mode: "pen",
        multiStroke: false,
        recognitionEnabled: true,
      }),
    );
    expect(api.getAppState().currentItemInkAssist).toBe(mode);
    act(() =>
      api.updateScene({
        appState: { currentItemInkAssist: undefined, multiStroke: true },
      }),
    );
    await waitFor(() =>
      expect(backend.configure.mock.calls.at(-1)?.[0]).toMatchObject({
        mode: "pen",
        multiStroke: true,
        recognitionEnabled: false,
      }),
    );
  },
);

it("reports toolbar readiness only after input configuration succeeds, once per owner", async () => {
  await editor(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  const api = window.h.app.api;
  window.h.state.width = 1000;
  window.h.state.height = 700;
  let configured!: () => void;
  backend.configure.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        configured = resolve;
      }),
  );
  render(<NativeInkInteraction api={api} />);
  await waitFor(() => expect(backend.configure).toHaveBeenCalled());
  expect(backend.ready).not.toHaveBeenCalled();
  await act(async () => configured());
  await waitFor(() =>
    expect(backend.ready).toHaveBeenCalledWith({
      owner: api.id,
      fallback: false,
    }),
  );
  act(() => api.updateScene({ appState: { currentItemOpacity: 60 } }));
  expect(backend.ready).toHaveBeenCalledTimes(1);
});

it("applies a changed display calibration without removing the active input surface", async () => {
  await editor(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  const api = window.h.app.api;
  window.h.state.width = 1000;
  window.h.state.height = 700;
  const view = renderComponent(<NativeInkInteraction api={api} />);
  await waitFor(() => expect(backend.ready).toHaveBeenCalledTimes(1));
  const removals = backend.remove.mock.calls.length;
  view.rerender(
    <NativeInkInteraction
      api={api}
      inkProfile={{
        hardPenWidth: 4,
        brushPenWidth: 15,
        eraserSize: 150,
        palmThreshold: 71,
      }}
    />,
  );
  await waitFor(() =>
    expect(backend.configure.mock.lastCall?.[0].palm).toBe(71),
  );
  expect(backend.remove).toHaveBeenCalledTimes(removals);
  expect(backend.ready).toHaveBeenCalledTimes(1);
});

it("releases startup into the visible error/fallback path when native configuration fails", async () => {
  await editor(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  const api = window.h.app.api;
  window.h.state.width = 1000;
  window.h.state.height = 700;
  backend.configure.mockRejectedValue(new Error("surface unavailable"));
  render(<NativeInkInteraction api={api} />);
  await waitFor(() =>
    expect(api.getAppState().errorMessage).toBe("surface unavailable"),
  );
  await waitFor(() =>
    expect(backend.ready).toHaveBeenCalledWith({
      owner: api.id,
      fallback: true,
    }),
  );
});
it("routes sideboard semantic buttons and leaves focused text input out of native shortcuts", async () => {
  await editor(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  const api = window.h.app.api;
  window.h.state.width = 1000;
  window.h.state.height = 700;
  act(() => api.setActiveTool({ type: "freedraw" }));
  const create = vi.fn();
  const save = vi.fn();
  const share = vi.fn();
  const stop = classroomCommands.register("board.new", "@internal", create);
  const stopSave = classroomCommands.register(
    "board.saveFile",
    "@internal",
    save,
  );
  const stopShare = classroomCommands.register(
    "board.share",
    "@internal",
    share,
  );
  const input = document.createElement("input");
  document.body.append(input);
  try {
    render(<NativeInkInteraction api={api} />);
    await waitFor(() =>
      expect(backend.configure.mock.calls.at(-1)?.[0].shortcutsEnabled).toBe(
        true,
      ),
    );
    await act(async () => {
      backend.listeners.forEach((listener) =>
        listener({ owner: api.id, action: "red" }),
      );
    });
    expect(api.getAppState().currentItemStrokeColor).toBe("#ff0000");
    await act(async () => {
      backend.listeners.forEach((listener) =>
        listener({ owner: api.id, action: "new" }),
      );
    });
    expect(create).toHaveBeenCalledTimes(1);
    for (const action of ["save", "share"]) {
      await act(async () => {
        backend.listeners.forEach((listener) =>
          listener({ owner: api.id, action }),
        );
      });
    }
    expect(save).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledTimes(1);
    act(() => {
      input.focus();
      fireEvent.focusIn(input);
    });
    await waitFor(() =>
      expect(backend.configure.mock.calls.at(-1)?.[0].shortcutsEnabled).toBe(
        false,
      ),
    );
    act(() => {
      input.blur();
      fireEvent.focusOut(input);
    });
    await waitFor(() =>
      expect(backend.configure.mock.calls.at(-1)?.[0].shortcutsEnabled).toBe(
        true,
      ),
    );
  } finally {
    input.remove();
    stopSave();
    stopShare();
    stop();
  }
});
it.each(["MuiModal-root MuiModal-hidden", "MuiPaper-root"])(
  "ignores hidden %s and pauses native input for a visible modal",
  async (className) => {
    await editor(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
    const api = window.h.app.api;
    window.h.state.width = 1000;
    window.h.state.height = 700;
    act(() => api.setActiveTool({ type: "freedraw" }));
    const modal = document.createElement("div");
    modal.className = className;
    modal.setAttribute("role", "dialog");
    if (className === "MuiPaper-root") {
      modal.setAttribute("aria-modal", "true");
    }
    modal.style.visibility = "hidden";
    vi.spyOn(modal, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 1000, 700),
    );
    document.body.append(modal);
    try {
      render(<NativeInkInteraction api={api} />);
      await waitFor(() =>
        expect(backend.configure.mock.calls.at(-1)?.[0].enabled).toBe(true),
      );
      expect(
        backend.configure.mock.calls.at(-1)![0].blocked,
      ).not.toContainEqual([0, 0, 1000, 700]);
      modal.classList.remove("MuiModal-hidden");
      modal.style.visibility = "visible";
      await waitFor(() =>
        expect(backend.configure.mock.calls.at(-1)?.[0].enabled).toBe(false),
      );
      modal.style.visibility = "hidden";
      await waitFor(() =>
        expect(backend.configure.mock.calls.at(-1)?.[0].enabled).toBe(true),
      );
    } finally {
      modal.remove();
    }
  },
);
it.each([
  ["fcboard.eraser", "erase", ".fc-eraser-settings"],
  ["fcboard.pen", "pen", ".fc-pen-properties"],
  ["fcboard.toolbox", "pen", ".fc-combined-toolbox"],
  ["fcboard.shape", "pen", ".fc-insert-picker-expanded"],
  ["fcboard.aerial_view", "pen", ".fc-aerial-view"],
  ["buttons.menu", "pen", ".fc-material-menu"],
] as const)(
  "captures the first board contact outside the %s palette",
  async (tool, mode, selector) => {
    if (tool === "fcboard.aerial_view") {
      saveToolbarItems(["aerial"]);
    }
    const { container } = await editor(
      <Fcboard UIOptions={{ unifiedToolbar: true }} />,
    );
    const api = window.h.app.api;
    window.h.state.width = 1000;
    window.h.state.height = 700;
    act(() => api.setActiveTool({ type: "freedraw" }));
    fireEvent.click(screen.getByRole("button", { name: t(tool) }));
    const panel = container.querySelector(selector)!;
    const rect = new DOMRect(300, 400, 240, 120);
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(rect);
    const popper = panel.closest(".MuiPopper-root");
    if (popper) {
      vi.spyOn(popper, "getBoundingClientRect").mockReturnValue(rect);
    }
    render(<NativeInkInteraction api={api} />);
    await waitFor(() =>
      expect(backend.configure.mock.calls.at(-1)?.[0]).toMatchObject({
        enabled: true,
        mode,
        blocked: expect.arrayContaining([[300, 400, 540, 520]]),
      }),
    );
    const contact = {
      owner: api.id,
      id: "press-outside-panel",
      token: backend.configure.mock.calls.at(-1)![0].token,
      mode,
      width: 50,
      height: 60,
      pointerType: "touch",
      nativeSequence: mode === "erase" ? 1 : 0,
      points: [[200, 150, 0.5]],
    };
    await act(async () =>
      backend.listeners.forEach((listener) =>
        listener({ ...contact, phase: "start" }),
      ),
    );
    await waitFor(() => expect(panel).not.toBeInTheDocument());
    expect(api.getAppState().cursorButton).toBe("down");
    expect(backend.erase).not.toHaveBeenCalled();
    await act(async () =>
      backend.listeners.forEach((listener) =>
        listener({ ...contact, phase: "end" }),
      ),
    );
    expect(api.getAppState().cursorButton).toBe("up");
  },
);
it("keeps movable SVG geometry controls and the split screen out of main native ink", async () => {
  await editor(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  const api = window.h.app.api;
  window.h.state.width = 1000;
  window.h.state.height = 700;
  act(() => api.setActiveTool({ type: "freedraw" }));
  const layer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  layer.classList.add("fc-factory-gizmos");
  const gizmo = document.createElementNS(layer.namespaceURI, "g");
  gizmo.setAttribute("data-gizmo", "ruler");
  gizmo.setAttribute("style", "visibility: visible; pointer-events: auto");
  const bounds = vi
    .spyOn(gizmo, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(100, 120, 320, 190));
  layer.append(gizmo);
  const split = document.createElement("div");
  split.className = "fc-split-board";
  render(<NativeInkInteraction api={api} />);
  try {
    document.body.append(layer);
    await waitFor(() =>
      expect(backend.configure.mock.calls.at(-1)?.[0].blocked).toContainEqual([
        100, 120, 420, 310,
      ]),
    );
    bounds.mockReturnValue(new DOMRect(400, 300, 190, 320));
    gizmo.setAttribute("transform", "translate(400 300) rotate(90)");
    await waitFor(() =>
      expect(backend.configure.mock.calls.at(-1)?.[0].blocked).toContainEqual([
        400, 300, 590, 620,
      ]),
    );
    document.body.append(split);
    await waitFor(() =>
      expect(backend.configure.mock.calls.at(-1)?.[0].enabled).toBe(false),
    );
    split.remove();
    await waitFor(() =>
      expect(backend.configure.mock.calls.at(-1)?.[0].enabled).toBe(true),
    );
  } finally {
    split.remove();
    layer.remove();
  }
});

it("keeps brush and gradient previews native with the calibrated style", async () => {
  await editor(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  const api = window.h.app.api;
  window.h.state.width = 1000;
  window.h.state.height = 700;
  act(() => {
    api.setActiveTool({ type: "freedraw" });
    api.updateScene({
      appState: {
        currentItemPenMode: "brush",
        currentItemInkGradient: "mint",
        whiteboardBrushVariation: 25,
      },
    });
  });
  render(
    <NativeInkInteraction
      api={api}
      inkProfile={{
        hardPenWidth: 4,
        brushPenWidth: 15,
        palmThreshold: 36,
        eraserSize: 60,
      }}
    />,
  );
  await waitFor(() => expect(backend.configure).toHaveBeenCalled());
  const options = backend.configure.mock.calls.at(-1)![0];
  expect(options.enabled).toBe(true);
  expect(options.penWidth).toBe(15);
  expect(options.appearance).toMatchObject({
    pen: "brush",
    variation: 25,
    gradient: { colors: ["#4dd7af", "#3b52c8"] },
  });
});

it("keeps native lasso continuous across object bounds without scanning scene elements during configure", async () => {
  await editor(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  const api = window.h.app.api;
  window.h.state.width = 1000;
  window.h.state.height = 700;
  const shape = API.createElement({
    type: "rectangle",
    x: 100,
    y: 100,
    width: 20,
    height: 20,
  });
  act(() => {
    api.updateScene({ elements: [shape] });
    api.setActiveTool({ type: "lasso" });
  });
  const scan = vi.spyOn(api, "getSceneElements").mockImplementation(() => {
    throw new Error("Native configure must use mutation bounds");
  });
  try {
    render(<NativeInkInteraction api={api} />);
    await waitFor(() =>
      expect(backend.configure.mock.calls.at(-1)?.[0].enabled).toBe(true),
    );
    act(() => api.mutateElement(shape, { x: 160 }));
    await waitFor(() =>
      expect(
        backend.configure.mock.calls.at(-1)?.[0].blocked,
      ).not.toContainEqual([148, 88, 192, 132]),
    );
    expect(backend.configure.mock.calls.at(-1)![0].blocked).not.toContainEqual([
      88, 88, 132, 132,
    ]);
    expect(scan).not.toHaveBeenCalled();
  } finally {
    scan.mockRestore();
  }
});
it("uses calibrated dual-tip native styles and rejects a late completed contact after surface invalidation", async () => {
  await editor(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  const api = window.h.app.api;
  window.h.state.width = 1000;
  window.h.state.height = 700;
  act(() => api.setActiveTool({ type: "freedraw" }));
  render(
    <NativeInkInteraction
      api={api}
      inkProfile={{
        hardPenWidth: 4,
        brushPenWidth: 15,
        palmThreshold: 36,
        eraserSize: 60,
        dualPen: true,
        thickThreshold: 10,
      }}
    />,
  );
  await waitFor(() => expect(backend.configure).toHaveBeenCalled());
  const options = backend.configure.mock.calls.at(-1)![0];
  expect(options.enabled).toBe(true);
  expect(options.thickThreshold).toBe(10);
  expect(options.penWidth).toBeLessThan(options.thick.penWidth);
  const contact = {
    owner: api.id,
    id: "native-contact",
    token: options.token,
    phase: "start",
    width: 2,
    height: 2,
    pointerType: "pen",
    points: [[100, 100, 0.5]],
  };
  act(() => backend.listeners.forEach((listener) => listener(contact)));
  expect(api.getSceneElements()).toHaveLength(0);
  act(() => classroomCommands.invalidate());
  act(() =>
    backend.listeners.forEach((listener) =>
      listener({
        ...contact,
        phase: "end",
        points: [
          [100, 100, 0.5],
          [120, 120, 0.5],
        ],
      }),
    ),
  );
  expect(api.getSceneElements()).toHaveLength(0);
  expect(api.getAppState().errorMessage).toBeNull();
  expect(backend.remove).toHaveBeenCalledWith({ owner: api.id });
});

it.each(["select", "regionErase"] as const)(
  "completes the native %s path after switching tools without pointermove replay",
  async (mode) => {
    await editor(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
    const api = window.h.app.api;
    window.h.state.width = 1000;
    window.h.state.height = 700;
    const target = API.createElement({
      type: "rectangle",
      x: 120,
      y: 120,
      width: 15,
      height: 15,
    });
    API.updateScene({ elements: [target] });
    act(() => {
      api.setActiveTool({ type: mode === "select" ? "lasso" : "eraser" });
      api.updateScene({ appState: { eraserMode: "region" } });
    });
    render(<NativeInkInteraction api={api} />);
    await waitFor(() => expect(backend.configure).toHaveBeenCalled());
    const options = backend.configure.mock.calls.at(-1)![0];
    expect(options.enabled).toBe(true);
    expect(options.mode).toBe(mode);
    if (mode === "select") {
      expect(options.blocked).not.toContainEqual([108, 108, 147, 147]);
    }
    const contact = {
      owner: api.id,
      id: "region",
      token: options.token,
      mode,
      phase: "start",
      width: 1,
      height: 1,
      pointerType: "pen",
      points: [[80, 80, 0.5]],
    };
    act(() => backend.listeners.forEach((listener) => listener(contact)));
    act(() => api.setActiveTool({ type: "freedraw" }));
    await waitFor(() =>
      expect(backend.configure.mock.calls.at(-1)?.[0]).toMatchObject({
        mode: "pen",
        inputSpace: options.inputSpace,
      }),
    );
    act(() =>
      backend.listeners.forEach((listener) =>
        listener({
          ...contact,
          phase: "end",
          points: [
            [80, 80, 0.5],
            [300, 80, 0.5],
            [300, 300, 0.5],
            [80, 300, 0.5],
            [80, 80, 0.5],
          ],
        }),
      ),
    );
    if (mode === "select") {
      expect(api.getAppState().selectedElementIds).toEqual({
        [target.id]: true,
      });
    } else {
      expect(api.getSceneElements()).toHaveLength(0);
    }
    expect(api.getAppState().errorMessage).toBeNull();
  },
);

it("binds completed native preview to the real canonical element before delayed raster installation", async () => {
  await editor(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  const api = window.h.app.api;
  window.h.state.width = 1000;
  window.h.state.height = 700;
  act(() => api.setActiveTool({ type: "freedraw" }));
  backend.synchronize.mockReturnValue(new Promise(() => {}));
  render(<NativeInkInteraction api={api} />);
  await waitFor(() => expect(backend.configure).toHaveBeenCalled());
  const options = backend.configure.mock.calls.at(-1)![0];
  const contact = {
    owner: api.id,
    id: "handoff",
    token: options.token,
    mode: "pen",
    phase: "start",
    width: 2,
    height: 2,
    pointerType: "pen",
    points: [[100, 100, 0.5]],
  };
  act(() => backend.listeners.forEach((listener) => listener(contact)));
  act(() =>
    backend.listeners.forEach((listener) =>
      listener({
        ...contact,
        phase: "end",
        points: [
          [100, 100, 0.5],
          [200, 150, 0.5],
        ],
      }),
    ),
  );
  expect(api.getSceneElements()).toHaveLength(1);
  expect(backend.acknowledge).toHaveBeenCalledWith({
    owner: api.id,
    id: "handoff",
    elementId: api.getSceneElements()[0].id,
    complete: true,
  });
});

it("acknowledges empty native eraser batches before lift and falls back visibly on geometry failure", async () => {
  await editor(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  const api = window.h.app.api;
  window.h.state.width = 1000;
  window.h.state.height = 700;
  act(() => api.setActiveTool({ type: "eraser" }));
  render(<NativeInkInteraction api={api} />);
  await waitFor(() =>
    expect(document.documentElement).toHaveClass("fc-native-scene"),
  );
  await waitFor(() => expect(backend.configure).toHaveBeenCalled());
  const options = backend.configure.mock.calls.at(-1)![0];
  const contact = {
    owner: api.id,
    id: "empty",
    token: options.token,
    mode: "erase",
    phase: "start",
    width: 60,
    height: 72,
    pointerType: "touch",
    nativeSequence: 1,
    points: [[100, 100, 0.5]],
  };
  await act(async () =>
    backend.listeners.forEach((listener) => listener(contact)),
  );
  expect(backend.erase).not.toHaveBeenCalled();
  expect(backend.synchronize.mock.calls.at(-1)![0].eraseThrough).toBe(0);
  expect(api.getSceneElements()).toHaveLength(0);
  await act(async () =>
    backend.listeners.forEach((listener) =>
      listener({
        ...contact,
        phase: "move",
        nativeSequence: 2,
        points: [[200, 100, 0.5]],
      }),
    ),
  );
  await waitFor(() =>
    expect(backend.synchronize.mock.calls.at(-1)![0].eraseThrough).toBe(2),
  );
  expect(backend.synchronize.mock.calls.at(-1)![0].nodes).toEqual([]);
  backend.erase.mockRejectedValueOnce(new Error("native geometry unavailable"));
  await act(async () =>
    backend.listeners.forEach((listener) =>
      listener({
        ...contact,
        phase: "move",
        nativeSequence: 3,
        points: [[300, 100, 0.5]],
      }),
    ),
  );
  await waitFor(() =>
    expect(document.documentElement).not.toHaveClass("fc-native-scene"),
  );
  expect(api.getAppState().errorMessage).toBe("native geometry unavailable");
  expect(api.getAppState().cursorButton).toBe("up");
});

it("commits native selection movement and uniform scale only on release and restores it with one undo", async () => {
  await editor(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  const api = window.h.app.api;
  const target = API.createElement({
    type: "rectangle",
    x: 100,
    y: 100,
    width: 80,
    height: 60,
  });
  act(() => {
    api.setActiveTool({ type: "lasso" });
    api.updateScene({
      elements: [target],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      appState: {
        width: 1000,
        height: 700,
        selectedElementIds: { [target.id]: true },
        whiteboardSelection: selectedRegion([target], undefined, 1),
      },
    });
  });
  render(<NativeInkInteraction api={api} />);
  await waitFor(() =>
    expect(
      backend.configure.mock.calls.at(-1)?.[0].selectionBounds,
    ).toBeDefined(),
  );
  await waitFor(() =>
    expect(backend.synchronize.mock.calls.at(-1)?.[0].selectionIds).toEqual([
      target.id,
    ]),
  );
  const options = backend.configure.mock.calls.at(-1)![0];
  const before = api.getSceneElements()[0];
  const bounds = options.selectionBounds as number[];
  const contact = {
    owner: api.id,
    id: "native-transform",
    token: options.token,
    mode: "transform",
    phase: "start",
    width: 2,
    height: 2,
    pointerType: "touch",
    points: [[140, 130, 0.5]],
    transform: {
      scale: 1,
      dx: 0,
      dy: 0,
      anchorX: bounds[0],
      anchorY: bounds[1],
    },
  };
  act(() => backend.listeners.forEach((listener) => listener(contact)));
  expect(api.getSceneElements()[0]).toBe(before);
  expect(document.documentElement).toHaveClass("fc-native-selection-transform");
  await act(async () =>
    backend.listeners.forEach((listener) =>
      listener({
        ...contact,
        phase: "end",
        transform: { ...contact.transform, scale: 2, dx: 30, dy: 20 },
      }),
    ),
  );
  await waitFor(() => expect(api.getSceneElements()[0].width).toBe(160));
  expect(api.getSceneElements()[0].x).toBe(
    bounds[0] + (100 - bounds[0]) * 2 + 30,
  );
  await waitFor(() =>
    expect(document.documentElement).not.toHaveClass(
      "fc-native-selection-transform",
    ),
  );
  expect(backend.synchronize.mock.calls.at(-1)![0].selectionThrough).toBe(
    "native-transform",
  );
  fireEvent.click(document.querySelector('[data-testid="button-undo"]')!);
  await waitFor(() => expect(api.getSceneElements()[0].width).toBe(80));
  expect(api.getSceneElements()[0].x).toBe(100);
});

it("keeps native lasso active outside a selected calculator while its frame uses live editor movement", async () => {
  await editor(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  const api = window.h.app.api;
  const calculator = API.createElement({
    type: "iframe",
    x: 100,
    y: 150,
    width: 220,
    height: 200,
  });
  const region = selectedRegion([calculator], undefined, 1)!;
  act(() => {
    api.setActiveTool({ type: "lasso" });
    api.updateScene({
      elements: [calculator],
      appState: {
        width: 1000,
        height: 700,
        selectedElementIds: { [calculator.id]: true },
        whiteboardSelection: region,
      },
    });
  });
  render(<NativeInkInteraction api={api} />);
  await waitFor(() =>
    expect(backend.configure.mock.calls.at(-1)?.[0]).toMatchObject({
      enabled: true,
      mode: "select",
      selectionBounds: undefined,
      blocked: expect.arrayContaining([[68, 118, 352, 382]]),
    }),
  );
});

it("does not overwrite an object edited while a native selection preview is in flight", async () => {
  await editor(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  const api = window.h.app.api;
  const target = API.createElement({
    type: "rectangle",
    x: 100,
    y: 100,
    width: 80,
    height: 60,
  });
  act(() => {
    api.setActiveTool({ type: "lasso" });
    api.updateScene({
      elements: [target],
      appState: {
        width: 1000,
        height: 700,
        selectedElementIds: { [target.id]: true },
        whiteboardSelection: selectedRegion([target], undefined, 1),
      },
    });
  });
  render(<NativeInkInteraction api={api} />);
  await waitFor(() => expect(backend.configure).toHaveBeenCalled());
  const options = backend.configure.mock.calls.at(-1)![0];
  const contact = {
    owner: api.id,
    id: "stale-transform",
    token: options.token,
    mode: "transform",
    phase: "start",
    width: 2,
    height: 2,
    pointerType: "touch",
    points: [[140, 130, 0.5]],
    transform: { scale: 1, dx: 0, dy: 0, anchorX: 0, anchorY: 0 },
  };
  act(() => backend.listeners.forEach((listener) => listener(contact)));
  act(() => api.mutateElement(target, { x: 420 }));
  await act(async () =>
    backend.listeners.forEach((listener) =>
      listener({
        ...contact,
        phase: "end",
        transform: { ...contact.transform, dx: 30 },
      }),
    ),
  );
  await waitFor(() =>
    expect(document.documentElement).not.toHaveClass(
      "fc-native-selection-transform",
    ),
  );
  expect(api.getSceneElements()[0].x).toBe(420);
});

it("cancels every active native writer when geometry failure returns control to WebView", async () => {
  await editor(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  const api = window.h.app.api;
  window.h.state.width = 1000;
  window.h.state.height = 700;
  act(() => api.setActiveTool({ type: "freedraw" }));
  render(<NativeInkInteraction api={api} />);
  await waitFor(() => expect(backend.configure).toHaveBeenCalled());
  const token = backend.configure.mock.calls.at(-1)![0].token;
  const progress: string[] = [];
  const stop = api.onInkProgress((stroke, phase) =>
    progress.push(`${stroke.id}:${phase}`),
  );
  const emit = async (id: string, mode = "pen", phase = "start") =>
    act(async () => {
      backend.listeners.forEach((listener) =>
        listener({
          owner: api.id,
          id,
          token,
          mode,
          phase,
          palm: mode === "erase",
          width: 60,
          height: 72,
          pointerType: "touch",
          points: [[100, 100, 0.5]],
        }),
      );
    });
  try {
    await emit("left");
    await emit("right");
    expect(api.getAppState().cursorButton).toBe("down");
    backend.erase.mockRejectedValueOnce(new Error("worker unavailable"));
    await emit("palm", "erase");
    await waitFor(() =>
      expect(api.getAppState().errorMessage).toBe("worker unavailable"),
    );
    expect(progress.filter((item) => item.endsWith(":cancel"))).toHaveLength(2);
    expect(api.getAppState().cursorButton).toBe("up");
    await emit("left", "pen", "end");
    expect(api.getSceneElements()).toHaveLength(0);
  } finally {
    stop();
  }
});

it.each([false, true])(
  "cancels an awaiting eraser start, accepts fresh input immediately, and ignores old failure=%s",
  async (failure) => {
    await editor(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
    const api = window.h.app.api;
    window.h.state.width = 1000;
    window.h.state.height = 700;
    act(() => api.setActiveTool({ type: "eraser" }));
    render(<NativeInkInteraction api={api} />);
    await waitFor(() => expect(backend.configure).toHaveBeenCalled());
    const token = backend.configure.mock.calls.at(-1)![0].token;
    let finish!: (value: { patches: [] }) => void;
    let reject!: (error: Error) => void;
    backend.erase.mockReturnValueOnce(
      new Promise((resolve, fail) => {
        finish = resolve;
        reject = fail;
      }),
    );
    const contact = {
      owner: api.id,
      id: "awaiting",
      token,
      mode: "erase",
      phase: "start",
      width: 60,
      height: 72,
      pointerType: "touch",
      points: [[100, 100, 0.5]],
    };
    await act(async () =>
      backend.listeners.forEach((listener) => listener(contact)),
    );
    await waitFor(() => expect(backend.erase).toHaveBeenCalledTimes(1));
    const configured = backend.configure.mock.calls.length;
    act(() => {
      backend.listeners.forEach((listener) =>
        listener({ ...contact, id: "queued-old" }),
      );
      classroomCommands.invalidate();
    });
    expect(api.getAppState().cursorButton).toBe("up");
    await waitFor(() =>
      expect(backend.configure.mock.calls.length).toBeGreaterThan(configured),
    );
    const freshToken = backend.configure.mock.calls.at(-1)![0].token;
    expect(freshToken).not.toBe(token);
    await act(async () =>
      backend.listeners.forEach((listener) =>
        listener({ ...contact, id: "late-old" }),
      ),
    );
    await act(async () =>
      backend.listeners.forEach((listener) =>
        listener({ ...contact, id: "fresh", token: freshToken }),
      ),
    );
    await waitFor(() => expect(backend.erase).toHaveBeenCalledTimes(2));
    expect(api.getAppState().cursorButton).toBe("down");
    await act(async () =>
      backend.listeners.forEach((listener) =>
        listener({ ...contact, id: "fresh", token: freshToken, phase: "end" }),
      ),
    );
    await waitFor(() => expect(api.getAppState().cursorButton).toBe("up"));
    await act(async () => {
      if (failure) {
        reject(new Error("old board worker failed"));
      } else {
        finish({ patches: [] });
      }
    });
    expect(backend.erase).toHaveBeenCalledTimes(3);
    expect(api.getAppState().errorMessage).toBeNull();
  },
);

it("routes idle floating graph touches to its DOM plane, then restores native writing after a layer action", async () => {
  await editor(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  const api = window.h.app.api;
  let ids: string[] = [];
  act(() => {
    api.updateScene({ appState: { width: 1000, height: 700 } });
    ids = drawPlot(
      api,
      { ...defaultPlot, expression: "x" },
      { x: 300, y: 250 },
    );
    api.setActiveTool({ type: "freedraw" });
  });
  render(<FunctionGraphInteraction api={api} />);
  const surface = document.getElementById(`fc-inline-function-${ids[0]}`)!;
  vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(
    new DOMRect(120, 100, 300, 250),
  );
  render(<NativeInkInteraction api={api} />);
  await waitFor(() =>
    expect(backend.configure.mock.calls.at(-1)?.[0].blocked).toContainEqual([
      120, 100, 420, 350,
    ]),
  );
  expect(surface.querySelector("canvas")).toBeNull();
  act(() => {
    api.updateScene({ appState: { selectedElementIds: { [ids[0]]: true } } });
  });
  expect(api.getAppState().selectedElementIds[ids[0]]).toBe(true);
  act(() => {
    api.executeAction("sendToBack");
    api.setActiveTool({ type: "freedraw" });
    api.updateScene({
      appState: { selectedElementIds: {}, selectedGroupIds: {} },
    });
  });
  expect(api.getSceneElements()[0].customData?.fcPlot.layer).toBe("board");
  expect(document.getElementById(`fc-inline-function-${ids[0]}`)).toBeNull();
  await waitFor(() =>
    expect(backend.configure.mock.calls.at(-1)?.[0].blocked).not.toContainEqual(
      [120, 100, 420, 350],
    ),
  );
  expect(backend.configure.mock.calls.at(-1)?.[0]).toMatchObject({
    enabled: true,
    mode: "pen",
  });
  expect(document.getElementById(`fc-inline-function-${ids[0]}`)).toBeNull();
});
