import { act, cleanup, waitFor } from "@testing-library/react";
import { Fcboard } from "@fcboard/fcboard";
import { render as editor } from "@fcboard/fcboard/tests/test-utils";

import { API } from "@fcboard/fcboard/tests/helpers/api";

import { NativeInkInteraction } from "./NativeInkInteraction";
import { classroomCommands } from "./commands";
import { render } from "./test/render";

const backend = vi.hoisted(() => ({
  configure: vi.fn(),
  remove: vi.fn(),
  acknowledge: vi.fn(),
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
  backend.configure.mockReset().mockResolvedValue(undefined);
  backend.remove.mockReset().mockResolvedValue(undefined);
  backend.acknowledge.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  backend.listeners.clear();
});
it("ignores kept-mounted hidden dialogs and restores native input after a visible popup closes", async () => {
  await editor(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  const api = window.h.app.api;
  window.h.state.width = 1000;
  window.h.state.height = 700;
  act(() => api.setActiveTool({ type: "freedraw" }));
  const modal = document.createElement("div");
  modal.className = "MuiModal-root MuiModal-hidden";
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
    expect(backend.configure.mock.calls.at(-1)![0].blocked).not.toContainEqual([
      0, 0, 1000, 700,
    ]);
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
  "routes the completed %s path to the actual scene without pointermove replay",
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
      expect(options.blocked).toContainEqual([108, 108, 147, 147]);
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
