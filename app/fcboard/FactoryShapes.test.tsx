import { Fcboard } from "@fcboard/fcboard";
import { t } from "@fcboard/fcboard/i18n";
import { getCommonBounds } from "@fcboard/element";

import { getNormalizedZoom } from "@fcboard/fcboard/scene";

import { within } from "@testing-library/react";

import { API } from "@fcboard/fcboard/tests/helpers/api";
import { Keyboard } from "@fcboard/fcboard/tests/helpers/ui";

import {
  render as editorRender,
  act,
  fireEvent,
} from "@fcboard/fcboard/tests/test-utils";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { render } from "./test/render";
import { FactoryShapes } from "./FactoryShapes";
import { factoryShapeCatalog } from "./factoryShapeGeometry";
import { readWidgets } from "./widgets";
import { classroomCommands } from "./commands";
import { registerCanvasCommands } from "./canvasCommands";
import { objectSelection } from "./board";
import { shapeInk } from "./documents";

import type { InkStroke } from "./documents";

vi.mock("@fcboard/fcboard", async (original) => ({
  ...(await original<typeof import("@fcboard/fcboard")>()),
  ToolbarExtras: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

const pointer = (target: Element, type: string, x: number, y: number) =>
  fireEvent(
    target,
    Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
      pointerId: 12,
      pointerType: "touch",
      clientX: x,
      clientY: y,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
    }),
  );
const setup = async () => {
  let api!: FcboardImperativeAPI;
  await editorRender(
    <Fcboard
      handleKeyboardGlobally
      onMount={({ excalidrawAPI }) => {
        api = excalidrawAPI;
      }}
    />,
  );
  const stop = registerCanvasCommands(api);
  const view = render(<FactoryShapes api={api} />);
  const choose = (kind: string) =>
    fireEvent.click(view.getByTestId(`factory-shape-${kind}`));
  const surface = () =>
    view.container.querySelector(".fc-factory-shape-drawing")!;
  return {
    api,
    view,
    choose,
    surface,
    close: () => {
      view.unmount();
      stop();
    },
  };
};

it("offers exactly the photographed twenty shapes and commits each drag as one grouped object after release", async () => {
  const { api, view, choose, surface, close } = await setup();
  try {
    const grid = view.container.querySelector(".fc-factory-shape-grid")!;
    expect(within(grid as HTMLElement).getAllByRole("button")).toHaveLength(20);
    for (const [kind] of factoryShapeCatalog) {
      choose(kind);
      const before = api.getSceneElements().length;
      pointer(surface(), "pointerdown", 300, 150);
      pointer(surface(), "pointermove", 540, 330);
      expect(surface().querySelector("g")!.children.length).toBeGreaterThan(0);
      expect(api.getSceneElements()).toHaveLength(before);
      pointer(surface(), "pointerup", 540, 330);
      const widget = readWidgets(api).at(-1)!;
      const parts = api
        .getSceneElements()
        .filter((element) => element.customData?.fcWidget?.id === widget.id);
      expect(parts.length).toBeGreaterThan(0);
      expect(
        parts.every((element) => element.groupIds.at(-1) === widget.id),
      ).toBe(true);
      expect(api.getAppState().activeTool.type).toBe("custom");
    }
    expect(readWidgets(api)).toHaveLength(20);
    Keyboard.undo();
    expect(readWidgets(api)).toHaveLength(19);
    Keyboard.redo();
    expect(readWidgets(api)).toHaveLength(20);
  } finally {
    close();
  }
});

it("keeps a shape tool ready for rapid taps and retains the last dragged aspect ratio", async () => {
  const { api, choose, surface, close } = await setup();
  try {
    choose("cube");
    pointer(surface(), "pointerdown", 100, 100);
    pointer(surface(), "pointermove", 400, 160);
    pointer(surface(), "pointerup", 400, 160);
    for (const x of [500, 850]) {
      pointer(surface(), "pointerdown", x, 100);
      pointer(surface(), "pointerup", x, 100);
    }
    const widgets = readWidgets(api);
    expect(widgets).toHaveLength(3);
    expect(new Set(widgets.map((widget) => widget.id)).size).toBe(3);
    for (const widget of widgets) {
      const bounds = getCommonBounds(
        api
          .getSceneElements()
          .filter((element) => element.customData?.fcWidget?.id === widget.id),
      );
      expect(bounds[2] - bounds[0]).toBeCloseTo(300);
      expect(bounds[3] - bounds[1]).toBeCloseTo(60);
    }
    expect(api.getAppState().activeTool.type).toBe("custom");
    Keyboard.undo();
    expect(readWidgets(api)).toHaveLength(2);
  } finally {
    close();
  }
});

it("keeps the drag position at zoom, cancels without objects, and copies a flat shape with an independent identity", async () => {
  const { api, choose, surface, close } = await setup();
  try {
    act(() =>
      API.setAppState({
        zoom: { value: getNormalizedZoom(1.5) },
        scrollX: 20,
        scrollY: -10,
      }),
    );
    choose("trapezoid");
    pointer(surface(), "pointerdown", 150, 150);
    pointer(surface(), "pointermove", 450, 450);
    pointer(surface(), "pointercancel", 450, 450);
    expect(api.getSceneElements()).toHaveLength(0);
    pointer(surface(), "pointerdown", 150, 150);
    pointer(surface(), "pointermove", 450, 450);
    pointer(surface(), "pointerup", 450, 450);
    expect(readWidgets(api)[0].position.x).toBeCloseTo(80);
    expect(readWidgets(api)[0].position.y).toBeCloseTo(110);
    const parts = api.getSceneElements();
    const bounds = getCommonBounds(parts);
    expect(bounds[0]).toBeCloseTo(80);
    expect(bounds[1]).toBeCloseTo(110);
    expect(bounds[2] - bounds[0]).toBeCloseTo(200);
    act(() => api.updateScene({ appState: objectSelection(parts) }));
    act(() => api.executeAction("duplicateSelection"));
    const copied = readWidgets(api);
    expect(copied).toHaveLength(2);
    expect(copied[0].id).not.toBe(copied[1].id);
    const clone = api
      .getSceneElements()
      .find((element) => element.customData?.fcWidget?.id === copied[1].id)!;
    await act(async () => {
      await classroomCommands.execute({
        name: "canvas.erase",
        args: { ids: [clone.id] },
      });
    });
    expect(readWidgets(api).map((widget) => widget.id)).toEqual([copied[0].id]);
    choose("hexagon");
    pointer(surface(), "pointerdown", 200, 200);
    pointer(surface(), "pointermove", 400, 400);
    fireEvent(window, new Event("blur"));
    pointer(surface(), "pointerup", 400, 400);
    expect(readWidgets(api)).toHaveLength(1);
  } finally {
    close();
  }
});

it("uses the chosen fill and real hemisphere hidden edge, and retains cube unfolding metadata", async () => {
  const { api, view, choose, surface, close } = await setup();
  try {
    fireEvent.click(
      view.getByRole("button", {
        name: t("fcboard.pen_colour_color", { color: "#f90000" }),
      }),
    );
    fireEvent.click(view.getByRole("button", { name: t("labels.fill") }));
    choose("pentagon");
    pointer(surface(), "pointerdown", 200, 200);
    pointer(surface(), "pointermove", 400, 400);
    pointer(surface(), "pointerup", 400, 400);
    expect(api.getSceneElements()[0]).toMatchObject({
      backgroundColor: "#f90000",
      strokeColor: "#f90000",
    });
    choose("hemisphere");
    pointer(surface(), "pointerdown", 500, 200);
    pointer(surface(), "pointermove", 700, 350);
    pointer(surface(), "pointerup", 700, 350);
    const hemisphere = readWidgets(api).find(
      (widget) => widget.kind === "hemisphere",
    )!;
    const edges = api
      .getSceneElements()
      .filter((element) => element.customData?.fcWidget?.id === hemisphere.id);
    expect(edges).toHaveLength(3);
    expect(
      edges.filter((element) => element.strokeStyle === "dashed"),
    ).toHaveLength(1);
    choose("cube");
    pointer(surface(), "pointerdown", 300, 400);
    pointer(surface(), "pointermove", 600, 580);
    pointer(surface(), "pointerup", 600, 580);
    const cube = readWidgets(api).find((widget) => widget.kind === "cube")!;
    expect(cube.params.solid.unfold).toBe(0);
    expect(cube.params.stretchX).not.toBe(cube.params.stretchY);
    expect(
      api
        .getSceneElements()
        .filter((element) => element.customData?.fcWidget?.id === cube.id)
        .some((element) => element.customData?.fcSolidFace),
    ).toBe(true);
  } finally {
    close();
  }
});

it("routes a visible document drag atomically and rejects a late release after changing pages", async () => {
  const { api, choose, close } = await setup();
  const stage = document.createElement("div");
  stage.className = "fc-document-stage";
  document.body.append(stage);
  vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({
    left: 20,
    top: 30,
    width: 500,
    height: 350,
    right: 520,
    bottom: 380,
    x: 20,
    y: 30,
    toJSON: () => ({}),
  });
  let page = 1;
  let publish = () => {};
  act(() => {
    publish = classroomCommands.context("document", () => ({
      id: "visible",
      page,
      ink: [],
      pen: { color: "#123456", penWidth: 3, opacity: 100 },
    }));
  });
  const commit = vi.fn();
  const command = classroomCommands.register(
    "document.widget",
    "@internal",
    commit,
  );
  try {
    choose("rectangle");
    const surface = () => stage.querySelector(".fc-factory-shape-drawing")!;
    expect(surface()).toBeInTheDocument();
    pointer(surface(), "pointerdown", 70, 80);
    pointer(surface(), "pointermove", 170, 180);
    expect(commit).not.toHaveBeenCalled();
    pointer(surface(), "pointerup", 170, 180);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0][0]).toMatchObject({
      widget: {
        kind: "shape",
        position: { x: 100, y: 100 },
        params: { shape: { end: [200, 200] } },
      },
      remember: true,
    });
    expect(api.getSceneElements()).toHaveLength(0);
    pointer(surface(), "pointerdown", 70, 80);
    pointer(surface(), "pointermove", 170, 180);
    act(() => {
      page = 2;
      classroomCommands.changed("document");
    });
    pointer(surface(), "pointerup", 170, 180);
    expect(commit).toHaveBeenCalledTimes(1);
  } finally {
    close();
    command();
    publish();
    stage.remove();
    vi.restoreAllMocks();
  }
});

it("inserts original pentagon and star through the AI command with real style, grouped copy and single-step history", async () => {
  const { api, close } = await setup();
  try {
    act(() =>
      API.setAppState({
        currentItemStrokeColor: "#f90000",
        currentItemBackgroundColor: "#f90000",
        currentItemStrokeWidth: 6,
        currentItemOpacity: 70,
      }),
    );
    let pentagon!: { id: string; ids: string[]; coordinates: string };
    await act(async () => {
      pentagon = (await classroomCommands.execute({
        name: "shapes.insert",
        args: {
          kind: "pentagon",
          start: [240, 180],
          end: [440, 340],
          revision: classroomCommands.revision,
        },
      })) as typeof pentagon;
    });
    expect(pentagon.coordinates).toBe("scene");
    const parts = api
      .getSceneElements()
      .filter((element) => pentagon.ids.includes(element.id));
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      strokeColor: "#f90000",
      backgroundColor: "#f90000",
      strokeWidth: 6,
      opacity: 70,
      groupIds: [pentagon.id],
      customData: {
        fcWidget: {
          id: pentagon.id,
          position: { x: 240, y: 180 },
          params: { shape: { kind: "pentagon", end: [200, 160] } },
        },
      },
    });
    const [left, top, right, bottom] = getCommonBounds(parts);
    expect(top).toBe(180);
    expect((left + right) / 2).toBe(340);
    expect(left).toBeGreaterThanOrEqual(240);
    expect(right).toBeLessThanOrEqual(440);
    expect(bottom).toBeLessThanOrEqual(340);
    await act(async () => {
      await classroomCommands.execute({
        name: "shapes.insert",
        args: {
          kind: "star",
          start: [500, 180],
          end: [700, 340],
          revision: classroomCommands.revision,
        },
      });
    });
    expect(readWidgets(api)).toHaveLength(2);
    Keyboard.undo();
    expect(readWidgets(api).map((widget) => widget.id)).toEqual([pentagon.id]);
    Keyboard.redo();
    expect(readWidgets(api)).toHaveLength(2);
    act(() => api.updateScene({ appState: objectSelection(parts) }));
    act(() => api.executeAction("duplicateSelection"));
    expect(readWidgets(api)).toHaveLength(3);
    expect(new Set(readWidgets(api).map((widget) => widget.id)).size).toBe(3);
  } finally {
    close();
  }
  expect(classroomCommands.has("shapes.insert")).toBe(false);
});

it("rejects invalid, stale or cancelled AI shape insertions before changing the canvas", async () => {
  const { api, close } = await setup();
  const args = {
    kind: "pentagon",
    start: [100, 100],
    end: [300, 250],
    revision: classroomCommands.revision,
  };
  try {
    for (const patch of [
      { kind: "unknown" },
      { start: [NaN, 2] },
      { end: [Infinity, 3] },
      { start: [0, 0, 2] },
      { end: [100, 100] },
      { signal: {} },
      { revision: args.revision + 1 },
      { arbitrary: "script" },
    ]) {
      await expect(
        classroomCommands.execute({
          name: "shapes.insert",
          args: { ...args, ...patch },
        }),
      ).rejects.toThrow();
    }
    const controller = new AbortController();
    controller.abort();
    await expect(
      classroomCommands.execute({
        name: "shapes.insert",
        args: { ...args, signal: controller.signal },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    classroomCommands.touch();
    await expect(
      classroomCommands.execute({ name: "shapes.insert", args }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(api.getSceneElements()).toHaveLength(0);
  } finally {
    close();
  }
});

it("awaits real visible-document shape commits, returns their ids and never reads the covered board", async () => {
  const { api, close } = await setup();
  let ink: InkStroke[] = [];
  const hidden = vi.spyOn(api, "getSceneElements").mockImplementation(() => {
    throw new Error("covered board");
  });
  let release = () => {};
  act(() => {
    release = classroomCommands.context("document", () => ({
      id: "visible",
      page: 1,
      ink,
      pen: { color: "#123456", penWidth: 3, opacity: 80 },
    }));
  });
  let commit!: () => void;
  const stop = classroomCommands.register(
    "document.widget",
    "@internal",
    (args) =>
      new Promise<void>((resolve) => {
        commit = () => {
          ink = (args.shapes as Parameters<typeof shapeInk>[0][]).map((shape) =>
            shapeInk(shape, "widget"),
          );
          classroomCommands.changed("document");
          resolve();
        };
      }),
  );
  try {
    let settled = false;
    const result = classroomCommands
      .execute({
        name: "shapes.insert",
        args: {
          kind: "star",
          start: [50, 60],
          end: [250, 220],
          revision: classroomCommands.revision,
        },
      })
      .then((value) => {
        settled = true;
        return value;
      });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(ink).toHaveLength(0);
    await act(async () => {
      commit();
    });
    const created = (await result) as {
      id: string;
      ids: string[];
      coordinates: string;
    };
    expect(created.coordinates).toBe("document");
    expect(created.ids).toEqual(ink.map((stroke) => stroke.id));
    expect(ink[0]).toMatchObject({
      color: "#123456",
      width: 3,
      opacity: 80,
      widget: { id: created.id, params: { shape: { kind: "star" } } },
    });
    expect(hidden).not.toHaveBeenCalled();
  } finally {
    stop();
    release();
    hidden.mockRestore();
    close();
  }
});

it("returns document commit failures and rejects a changed target instead of claiming a shape was inserted", async () => {
  const { api, close } = await setup();
  let page = 1;
  let release = () => {};
  act(() => {
    release = classroomCommands.context("document", () => ({
      id: "visible",
      page,
      ink: [],
      pen: { color: "#123456", penWidth: 3, opacity: 80 },
    }));
  });
  let finish!: () => void;
  const stop = classroomCommands.register(
    "document.widget",
    "@internal",
    vi
      .fn()
      .mockRejectedValueOnce(new Error("Document write failed"))
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
  );
  try {
    const args = {
      kind: "pentagon",
      start: [50, 60],
      end: [250, 220],
      revision: classroomCommands.revision,
    };
    await expect(
      classroomCommands.execute({ name: "shapes.insert", args }),
    ).rejects.toThrow("Document write failed");
    const pending = classroomCommands
      .execute({ name: "shapes.insert", args })
      .catch((failure) => failure);
    act(() => {
      page = 2;
      classroomCommands.touch();
      classroomCommands.changed("document");
    });
    finish();
    expect(await pending).toMatchObject({ name: "AbortError" });
    expect(api.getSceneElements()).toHaveLength(0);
  } finally {
    stop();
    release();
    close();
  }
});
