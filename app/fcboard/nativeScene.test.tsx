import { act, waitFor } from "@testing-library/react";
import { Fcboard } from "@fcboard/fcboard";
import { newElementWith } from "@fcboard/element";
import { pointFrom } from "@fcboard/math";
import { traceFactoryBrush } from "@fcboard/element/factoryBrush";
import { API } from "@fcboard/fcboard/tests/helpers/api";
import { selectedRegion } from "@fcboard/fcboard/lasso/region";
import { render } from "@fcboard/fcboard/tests/test-utils";

import { createNativeSceneRenderer } from "./nativeScene";
import { classroomCommands } from "./commands";

const native = vi.hoisted(() => ({ synchronize: vi.fn(), remove: vi.fn() }));
vi.mock("@capacitor/core", () => ({ registerPlugin: () => native }));
beforeEach(() => {
  native.synchronize.mockReset().mockResolvedValue(undefined);
  native.remove.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  document.documentElement.classList.remove("fc-native-scene");
});
const ink = (x: number) =>
  newElementWith(
    API.createElement({
      type: "freedraw",
      x,
      y: 120,
      width: 100,
      height: 20,
      points: [pointFrom(0, 0), pointFrom(100, 20)],
      strokeWidth: 4,
    }),
    {
      customData: {
        fcInk: { version: 2, pen: "hard", centerline: true, finished: true },
      },
    },
  );
const setup = async () => {
  await render(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  const api = window.h.app.api;
  act(() => api.updateScene({ appState: { width: 1000, height: 700 } }));
  return api;
};

it("keeps web display until native installation then sends only the changed object version", async () => {
  const api = await setup();
  const canvas = document.querySelector<HTMLCanvasElement>("canvas.static")!;
  expect(canvas.width).toBe(1);
  expect(canvas.style.width).toBe("1000px");
  const first = ink(100);
  const second = ink(300);
  const text = API.createElement({
    type: "text",
    text: "Preserved text",
    x: 200,
    y: 260,
  });
  act(() => api.updateScene({ elements: [first, second, text] }));
  await waitFor(() => expect(canvas.width).toBe(1000 * devicePixelRatio));
  let finish!: () => void;
  native.synchronize.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const errors = vi.fn();
  let controller!: NonNullable<ReturnType<typeof createNativeSceneRenderer>>;
  act(() => {
    controller = createNativeSceneRenderer(api, errors)!;
  });
  try {
    await waitFor(() => expect(native.synchronize).toHaveBeenCalledTimes(1));
    expect(document.documentElement).not.toHaveClass("fc-native-scene");
    const initial = native.synchronize.mock.calls[0][0];
    expect(
      initial.nodes.filter((node: { path?: string }) => node.path),
    ).toHaveLength(2);
    expect(
      initial.nodes.find((node: { id: string }) => node.id === text.id).bitmap,
    ).toMatch(/^data:image\/png/);
    await act(async () => finish());
    await waitFor(() =>
      expect(document.documentElement).toHaveClass("fc-native-scene"),
    );
    await waitFor(() => expect(canvas.width).toBe(1));
    native.synchronize.mockClear();
    act(() => api.mutateElement(first, { x: 140 }));
    await waitFor(() => expect(native.synchronize).toHaveBeenCalledTimes(1));
    expect(
      native.synchronize.mock.calls[0][0].nodes.map(
        (node: { id: string }) => node.id,
      ),
    ).toEqual([first.id]);
    expect(native.synchronize.mock.calls[0][0].background).toBeUndefined();
    expect(errors).not.toHaveBeenCalled();
  } finally {
    act(() => controller.dispose());
  }
  expect(document.documentElement).not.toHaveClass("fc-native-scene");
  await waitFor(() => expect(canvas.width).toBe(1000 * devicePixelRatio));
});

it("sends the actual styled brush stamps without SVG semicircle parsing", async () => {
  const api = await setup();
  const brush = newElementWith(ink(100), {
    strokeStyle: "dashed",
    customData: {
      fcInk: {
        version: 3,
        pen: "brush",
        unit: 1,
        finished: true,
        brushAngle: 0.4,
      },
    },
  });
  const stamps: number[] = [];
  traceFactoryBrush(brush, (point) => {
    stamps.push(point.x, point.y, point.width);
  });
  act(() => api.updateScene({ elements: [brush] }));
  let controller!: NonNullable<ReturnType<typeof createNativeSceneRenderer>>;
  act(() => {
    controller = createNativeSceneRenderer(api, vi.fn())!;
  });
  try {
    await waitFor(() => expect(native.synchronize).toHaveBeenCalled());
    const node = native.synchronize.mock.calls[0][0].nodes[0];
    expect(stamps.length).toBeGreaterThan(3);
    expect(node.brush).toEqual({ stamps, angle: 0.4 });
    expect(node.path).toBeUndefined();
    expect(node.strokeWidth).toBe(0);
  } finally {
    act(() => controller.dispose());
  }
});

it("updates selection membership without retransmitting unchanged scene geometry", async () => {
  const api = await setup();
  const chosen = ink(100);
  const history = Array.from({ length: 1000 }, (_, index) => ink(400 + index));
  act(() => api.updateScene({ elements: [chosen, ...history] }));
  let controller!: NonNullable<ReturnType<typeof createNativeSceneRenderer>>;
  act(() => {
    controller = createNativeSceneRenderer(api, vi.fn())!;
  });
  try {
    await waitFor(() =>
      expect(document.documentElement).toHaveClass("fc-native-scene"),
    );
    native.synchronize.mockClear();
    act(() => {
      api.setActiveTool({ type: "lasso" });
      api.updateScene({
        appState: {
          selectedElementIds: { [chosen.id]: true },
          whiteboardSelection: selectedRegion([chosen], undefined, 1),
        },
      });
    });
    await waitFor(() =>
      expect(native.synchronize.mock.calls.at(-1)?.[0].selectionIds).toEqual([
        chosen.id,
      ]),
    );
    expect(
      native.synchronize.mock.calls.every(
        ([request]) => request.nodes.length === 0,
      ),
    ).toBe(true);
    native.synchronize.mockClear();
    act(() =>
      api.updateScene({
        appState: { selectedElementIds: {}, whiteboardSelection: undefined },
      }),
    );
    await waitFor(() =>
      expect(native.synchronize.mock.calls.at(-1)?.[0].selectionIds).toEqual(
        [],
      ),
    );
    expect(native.synchronize.mock.calls.at(-1)?.[0].nodes).toEqual([]);
  } finally {
    act(() => controller.dispose());
  }
});

it("reconciles a viewport change made while a previous native snapshot is still in flight", async () => {
  const api = await setup();
  act(() => api.updateScene({ elements: [ink(100)] }));
  let finish!: () => void;
  native.synchronize.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  let controller!: NonNullable<ReturnType<typeof createNativeSceneRenderer>>;
  act(() => {
    controller = createNativeSceneRenderer(api, vi.fn())!;
  });
  try {
    await waitFor(() => expect(native.synchronize).toHaveBeenCalledTimes(1));
    act(() => api.updateScene({ appState: { scrollX: 100 } }));
    await act(async () => finish());
    await waitFor(() =>
      expect(native.synchronize.mock.calls.at(-1)?.[0].scrollX).toBe(100),
    );
    expect(native.synchronize.mock.calls.at(-1)![0].background).toBeUndefined();
    expect(
      native.synchronize.mock.calls.at(-1)![0].backgroundColor,
    ).toBeDefined();
  } finally {
    act(() => controller.dispose());
  }
});

it("rejects an old-page acknowledgement and restores web rendering on a real native failure", async () => {
  const api = await setup();
  const original = ink(100);
  const replacement = ink(400);
  act(() => api.updateScene({ elements: [original] }));
  let finish!: () => void;
  native.synchronize.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const errors = vi.fn();
  let controller!: NonNullable<ReturnType<typeof createNativeSceneRenderer>>;
  act(() => {
    controller = createNativeSceneRenderer(api, errors)!;
  });
  try {
    await waitFor(() => expect(native.synchronize).toHaveBeenCalledTimes(1));
    const epoch = native.synchronize.mock.calls[0][0].epoch;
    act(() => {
      controller.reset();
      api.updateScene({ elements: [replacement] });
    });
    native.synchronize.mockRejectedValueOnce(
      new Error("native raster unavailable"),
    );
    await act(async () => finish());
    await waitFor(() => expect(errors).toHaveBeenCalled());
    expect(native.synchronize.mock.calls.at(-1)![0].epoch).toBeGreaterThan(
      epoch,
    );
    expect(
      native.synchronize.mock.calls
        .at(-1)![0]
        .nodes.map((node: { id: string }) => node.id),
    ).toEqual([replacement.id]);
    expect(document.documentElement).not.toHaveClass("fc-native-scene");
    expect(api.getSceneElements().map((node) => node.id)).toEqual([
      replacement.id,
    ]);
  } finally {
    act(() => controller.dispose());
  }
});

it("restores retained ownership after temporary document drawing with no canonical scene changes", async () => {
  const api = await setup();
  act(() => api.updateScene({ elements: [ink(100)] }));
  let controller!: NonNullable<ReturnType<typeof createNativeSceneRenderer>>;
  act(() => {
    controller = createNativeSceneRenderer(api, vi.fn())!;
  });
  let stop: (() => void) | undefined;
  try {
    await waitFor(() =>
      expect(document.documentElement).toHaveClass("fc-native-scene"),
    );
    const installed = native.synchronize.mock.calls.length;
    act(() => {
      stop = classroomCommands.register("document.draw", "@internal", () => {});
      classroomCommands.changed("document");
    });
    await waitFor(() =>
      expect(document.documentElement).not.toHaveClass("fc-native-scene"),
    );
    act(() => {
      stop!();
      stop = undefined;
      classroomCommands.changed("document");
    });
    await waitFor(() =>
      expect(document.documentElement).toHaveClass("fc-native-scene"),
    );
    expect(native.synchronize).toHaveBeenCalledTimes(installed);
  } finally {
    stop?.();
    act(() => controller.dispose());
  }
});

it("gives an immediate remount a newer epoch than disposal even within one clock tick", async () => {
  const api = await setup();
  vi.spyOn(Date, "now").mockReturnValue(1000);
  let first!: NonNullable<ReturnType<typeof createNativeSceneRenderer>>;
  let second: typeof first | undefined;
  try {
    act(() => {
      first = createNativeSceneRenderer(api, vi.fn())!;
    });
    await waitFor(() =>
      expect(document.documentElement).toHaveClass("fc-native-scene"),
    );
    act(() => first.dispose());
    const removed = native.remove.mock.calls.at(-1)![0].epoch;
    act(() => {
      first.dispose();
      second = createNativeSceneRenderer(api, vi.fn())!;
    });
    await waitFor(() =>
      expect(native.synchronize.mock.calls.at(-1)![0].epoch).toBeGreaterThan(
        removed,
      ),
    );
    await waitFor(() =>
      expect(document.documentElement).toHaveClass("fc-native-scene"),
    );
    expect(native.remove).toHaveBeenCalledTimes(1);
  } finally {
    act(() => {
      first.dispose();
      second?.dispose();
    });
    vi.restoreAllMocks();
  }
});

it("waits for canonical render maps before acknowledging an erase that introduces new objects", async () => {
  const api = await setup();
  const original = ink(100);
  const replacement = ink(400);
  act(() => api.updateScene({ elements: [original] }));
  const register = api.registerNativeSceneRenderer!.bind(api);
  let paused = false;
  let release!: () => boolean;
  const nativeApi = {
    ...api,
    registerNativeSceneRenderer: (renderer: Parameters<typeof register>[0]) =>
      register((config) => {
        release = () => renderer(config);
        return paused ? true : renderer(config);
      }),
  };
  let controller!: NonNullable<ReturnType<typeof createNativeSceneRenderer>>;
  act(() => {
    controller = createNativeSceneRenderer(nativeApi, vi.fn())!;
  });
  try {
    await waitFor(() =>
      expect(document.documentElement).toHaveClass("fc-native-scene"),
    );
    native.synchronize.mockClear();
    paused = true;
    await act(async () => {
      api.updateScene({ elements: [replacement] });
      controller.acknowledgeErase(1);
    });
    expect(native.synchronize).not.toHaveBeenCalled();
    act(() => {
      paused = false;
      release();
    });
    await waitFor(() => expect(native.synchronize).toHaveBeenCalledTimes(1));
    expect(
      native.synchronize.mock.calls[0][0].nodes.map(
        (node: { id: string }) => node.id,
      ),
    ).toEqual([replacement.id]);
    expect(native.synchronize.mock.calls[0][0].eraseThrough).toBe(1);
  } finally {
    act(() => controller.dispose());
    vi.restoreAllMocks();
  }
});

it("retains the installed frame while a new board epoch is rasterized and sends plain background colors without PNG", async () => {
  const api = await setup();
  let controller!: NonNullable<ReturnType<typeof createNativeSceneRenderer>>;
  act(() => {
    controller = createNativeSceneRenderer(api, vi.fn())!;
  });
  try {
    await waitFor(() =>
      expect(document.documentElement).toHaveClass("fc-native-scene"),
    );
    expect(native.synchronize.mock.calls.at(-1)![0].background).toBeUndefined();
    expect(
      native.synchronize.mock.calls.at(-1)![0].backgroundColor,
    ).toBeDefined();
    native.remove.mockClear();
    let install!: () => void;
    native.synchronize.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          install = resolve;
        }),
    );
    act(() => {
      controller.reset();
      api.updateScene({ elements: [ink(450)] });
    });
    await waitFor(() => expect(install).toBeDefined());
    expect(native.remove).not.toHaveBeenCalled();
    expect(document.documentElement).toHaveClass("fc-native-scene");
    await act(async () => install());
    expect(document.documentElement).toHaveClass("fc-native-scene");
  } finally {
    act(() => controller.dispose());
  }
});
