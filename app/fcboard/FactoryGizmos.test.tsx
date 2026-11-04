import { Fcboard } from "@fcboard/fcboard";
import { t } from "@fcboard/fcboard/i18n";

import { within } from "@testing-library/react";
import { getCommonBounds } from "@fcboard/element";

import { Keyboard } from "@fcboard/fcboard/tests/helpers/ui";
import { API } from "@fcboard/fcboard/tests/helpers/api";
import {
  render as editorRender,
  act,
  fireEvent,
} from "@fcboard/fcboard/tests/test-utils";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { render } from "./test/render";
import { registerCanvasCommands } from "./canvasCommands";
import { TeachingTools } from "./TeachingTools";
import { readWidgets, renderWidget, widgetDefaults } from "./widgets";
import { compassGeometry, gizmoPoint } from "./factoryGizmoShapes";

vi.mock("@fcboard/fcboard", async (original) => ({
  ...(await original<typeof import("@fcboard/fcboard")>()),
  ToolbarExtras: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

const pointer = (
  target: Element,
  type: string,
  x: number,
  y: number,
  id = 11,
) =>
  fireEvent(
    target,
    Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
      pointerId: id,
      pointerType: "touch",
      clientX: x,
      clientY: y,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
    }),
  );

it("moves a ruler as one undo, rolls back interrupted rotation, and draws one constrained editable stroke", async () => {
  let api!: FcboardImperativeAPI;
  await editorRender(
    <Fcboard
      handleKeyboardGlobally
      onMount={({ excalidrawAPI }) => {
        api = excalidrawAPI;
      }}
    />,
  );
  const commands = registerCanvasCommands(api);
  act(() =>
    renderWidget(api, {
      id: "ruler",
      kind: "ruler",
      params: widgetDefaults(),
      position: { x: 200, y: 200 },
    }),
  );
  act(() => api.setActiveTool({ type: "freedraw" }));
  const tools = render(<TeachingTools api={api} />);
  try {
    const group = tools.container.querySelector('[data-gizmo="ruler"]')!;
    const body = group.querySelector("rect")!;
    const count = API.getUndoStack().length;
    pointer(body, "pointerdown", 220, 220);
    pointer(body, "pointermove", 260, 250);
    pointer(body, "pointerup", 260, 250);
    expect(readWidgets(api)[0].position).toEqual({ x: 240, y: 230 });
    expect(API.getUndoStack()).toHaveLength(count + 1);
    Keyboard.undo();
    expect(readWidgets(api)[0].position).toEqual({ x: 200, y: 200 });
    Keyboard.redo();
    expect(readWidgets(api)[0].position).toEqual({ x: 240, y: 230 });
    const rotate = within(group as HTMLElement).getByRole("button", {
      name: t("fcboard.rotate_shape"),
    });
    pointer(rotate, "pointerdown", 535, 230);
    pointer(rotate, "pointermove", 255, 510);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(readWidgets(api)[0].params.rotation).toBeCloseTo(90);
    pointer(rotate, "pointercancel", 255, 510);
    expect(readWidgets(api)[0].params.rotation).toBe(0);
    const edge = group.querySelector("line")!;
    pointer(edge, "pointerdown", 270, 225);
    pointer(document.body, "pointermove", 570, 242);
    pointer(document.body, "pointerup", 570, 242);
    await act(async () => {});
    const ink = api
      .getSceneElements()
      .filter((element) => element.type === "freedraw");
    expect(ink).toHaveLength(1);
    expect(ink[0]).toMatchObject({
      x: 255,
      y: 224,
      points: [
        [0, 0],
        [315, 0],
      ],
    });
    Keyboard.undo();
    expect(
      api.getSceneElements().filter((element) => element.type === "freedraw"),
    ).toHaveLength(0);
    expect(readWidgets(api)[0].position).toEqual({ x: 240, y: 230 });
  } finally {
    tools.unmount();
    commands();
  }
});

it("keeps a scaled, rotated set-square edge in scene coordinates", async () => {
  let api!: FcboardImperativeAPI;
  await editorRender(
    <Fcboard
      onMount={({ excalidrawAPI }) => {
        api = excalidrawAPI;
      }}
    />,
  );
  const commands = registerCanvasCommands(api);
  act(() =>
    renderWidget(api, {
      id: "square",
      kind: "setSquare",
      params: { ...widgetDefaults(), rotation: 90, size: 0.75 },
      position: { x: 400, y: 200 },
    }),
  );
  act(() => api.setActiveTool({ type: "freedraw" }));
  const tools = render(<TeachingTools api={api} />);
  try {
    const square = readWidgets(api)[0];
    const edge = tools.container.querySelector('[data-gizmo="square"] line')!;
    const start = gizmoPoint(square, 40, -5);
    const end = gizmoPoint(square, 320, 8);
    pointer(edge, "pointerdown", ...start);
    pointer(edge, "pointermove", ...end);
    pointer(edge, "pointerup", ...end);
    await act(async () => {});
    const ink = api
      .getSceneElements()
      .find((element) => element.type === "freedraw")!;
    expect(ink.x).toBeCloseTo(square.position.x + 4.5);
    expect(ink.y).toBeCloseTo(square.position.y + 30);
    if (ink.type !== "freedraw") {
      throw new Error("Constrained stroke missing");
    }
    expect(ink.points.at(-1)![0]).toBeCloseTo(0);
    expect(ink.points.at(-1)![1]).toBeCloseTo(210);
  } finally {
    tools.unmount();
    commands();
  }
});

it("measures with the protractor needle and inserts the measured arc rather than a decorative control", async () => {
  let api!: FcboardImperativeAPI;
  await editorRender(
    <Fcboard
      onMount={({ excalidrawAPI }) => {
        api = excalidrawAPI;
      }}
    />,
  );
  const commands = registerCanvasCommands(api);
  act(() =>
    renderWidget(api, {
      id: "protractor",
      kind: "protractor",
      params: widgetDefaults(),
      position: { x: 500, y: 100 },
    }),
  );
  act(() => api.setActiveTool({ type: "freedraw" }));
  const tools = render(<TeachingTools api={api} />);
  try {
    const group = tools.container.querySelector('[data-gizmo="protractor"]')!;
    const needle = within(group as HTMLElement).getByRole("slider", {
      name: t("stats.angle"),
    });
    pointer(needle, "pointerdown", 870, 280);
    pointer(needle, "pointermove", 680, 90);
    pointer(needle, "pointerup", 680, 90);
    expect(readWidgets(api)[0].params.sweep).toBeCloseTo(90);
    const draw = within(group as HTMLElement).getByRole("button", {
      name: `${t("toolBar.freedraw")} 3`,
    });
    pointer(draw, "pointerdown", 750, 320);
    expect(tools.container.querySelector("polyline")).not.toBeNull();
    expect(draw.querySelector("image")?.getAttribute("href")).toContain(
      "draw_arc_down",
    );
    expect(
      api.getSceneElements().some((element) => element.type === "freedraw"),
    ).toBe(false);
    pointer(draw, "pointercancel", 750, 320);
    expect(tools.container.querySelector("polyline")).toBeNull();
    pointer(draw, "pointerdown", 750, 320);
    pointer(draw, "pointerup", 750, 320);
    // The browser's follow-up click must not insert the same arc twice.
    fireEvent.click(draw, { detail: 1 });
    await act(async () => {});
    const arc = api
      .getSceneElements()
      .find((element) => element.type === "freedraw")!;
    expect(arc).toMatchObject({ x: 860, y: 280 });
    if (arc.type !== "freedraw") {
      throw new Error("Arc missing");
    }
    expect(arc.points).toHaveLength(91);
    expect(arc.points.at(-1)![0]).toBeCloseTo(-180);
    expect(arc.points.at(-1)![1]).toBeCloseTo(-180);
    act(() => {
      const widget = readWidgets(api)[0];
      renderWidget(api, {
        ...widget,
        params: { ...widget.params, sweep: 270 },
      });
    });
    fireEvent.click(draw);
    await act(async () => {});
    const arcs = api
      .getSceneElements()
      .filter((element) => element.type === "freedraw");
    expect(arcs).toHaveLength(2);
    const below = arcs[1];
    if (below.type !== "freedraw") {
      throw new Error("Arc missing");
    }
    expect(below.points).toHaveLength(91);
    expect(below.points.at(-1)![1]).toBeCloseTo(180);
  } finally {
    tools.unmount();
    commands();
  }
});

it("opens both added native gizmos from the original toolbox page and draws a compass circle", async () => {
  let api!: FcboardImperativeAPI;
  await editorRender(
    <Fcboard
      onMount={({ excalidrawAPI }) => {
        api = excalidrawAPI;
      }}
    />,
  );
  const commands = registerCanvasCommands(api);
  act(() => api.setActiveTool({ type: "freedraw" }));
  const tools = render(<TeachingTools api={api} />);
  try {
    const toolbar = within(tools.container);
    fireEvent.click(
      toolbar.getByRole("button", { name: t("fcboard.teaching_tools") }),
    );
    fireEvent.click(
      toolbar.getByRole("button", {
        name: t("fcboard.insert_name", { name: t("fcboard.compass") }),
      }),
    );
    const widget = readWidgets(api)[0];
    expect(widget.kind).toBe("compass");
    const group = tools.container.querySelector(`[data-gizmo="${widget.id}"]`)!;
    const draw = within(group as HTMLElement).getByRole("button", {
      name: t("toolBar.freedraw"),
    });
    const center = gizmoPoint(widget, 0, 300);
    pointer(draw, "pointerdown", center[0] + 200, center[1]);
    for (const degree of [90, 180, 270, 359]) {
      pointer(
        draw,
        "pointermove",
        center[0] + 200 * Math.cos((degree * Math.PI) / 180),
        center[1] + 200 * Math.sin((degree * Math.PI) / 180),
      );
    }
    pointer(draw, "pointerup", center[0] + 200, center[1]);
    await act(async () => {});
    const circle = api
      .getSceneElements()
      .find((element) => element.type === "freedraw")!;
    if (circle.type !== "freedraw") {
      throw new Error("Circle missing");
    }
    expect(circle.points.length).toBeGreaterThanOrEqual(360);
    expect(circle.points.at(-1)![0]).toBeCloseTo(0);
    expect(circle.points.at(-1)![1]).toBeCloseTo(0);
    fireEvent.click(
      toolbar.getByRole("button", { name: t("fcboard.teaching_tools") }),
    );
    fireEvent.click(
      toolbar.getByRole("button", {
        name: t("fcboard.insert_name", { name: t("fcboard.set_square") }),
      }),
    );
    expect(readWidgets(api).some((widget) => widget.kind === "setSquare")).toBe(
      true,
    );
  } finally {
    tools.unmount();
    commands();
  }
});

it.each(["ruler", "setSquare", "compass", "protractor"] as const)(
  "circles, moves and scales the whole %s through the native operation frame, then keeps the new pose in its own controls",
  async (kind) => {
    let api!: FcboardImperativeAPI;
    const editor = await editorRender(
      <Fcboard
        UIOptions={{ unifiedToolbar: true }}
        onMount={({ excalidrawAPI }) => {
          api = excalidrawAPI;
        }}
      />,
    );
    const commands = registerCanvasCommands(api);
    act(() => {
      api.updateScene({ appState: { width: 1600, height: 1000 } });
      renderWidget(api, {
        id: "selected-gizmo",
        kind,
        params: { ...widgetDefaults(), size: 0.6 },
        position: { x: 300, y: 300 },
      });
      api.setActiveTool({ type: "lasso" });
    });
    const tools = render(<TeachingTools api={api} />);
    const canvas =
      editor.container.querySelector<HTMLCanvasElement>("canvas.interactive")!;
    try {
      expect(tools.container.querySelector(".fc-factory-gizmos")).toHaveStyle({
        visibility: "hidden",
        display: "none",
      });
      // A visible child overrides an SVG ancestor's visibility:hidden, so
      // source icons must inherit the selection mode instead of stealing hits.
      for (const icon of tools.container.querySelectorAll<SVGImageElement>(
        ".fc-factory-gizmos image",
      )) {
        expect(icon.style.visibility).not.toBe("visible");
      }
      const all = api
        .getSceneElements()
        .filter(
          (element) => element.customData?.fcWidget?.id === "selected-gizmo",
        );
      const [left, top, right, bottom] = getCommonBounds(all);
      pointer(canvas, "pointerdown", left - 30, top - 30);
      for (const [x, y] of [
        [right + 30, top - 30],
        [right + 30, bottom + 30],
        [left - 30, bottom + 30],
      ]) {
        pointer(canvas, "pointermove", x, y);
      }
      pointer(canvas, "pointerup", left - 30, top - 30);
      expect(api.getAppState().whiteboardSelection?.elementIds).toHaveLength(
        all.length,
      );
      const context = canvas.getContext("2d")!;
      expect(context.strokeRect).toHaveBeenCalledWith(
        api.getAppState().whiteboardSelection!.bounds.left,
        api.getAppState().whiteboardSelection!.bounds.top,
        expect.any(Number),
        expect.any(Number),
      );
      pointer(canvas, "pointerdown", (left + right) / 2, (top + bottom) / 2);
      pointer(
        canvas,
        "pointermove",
        (left + right) / 2 + 40,
        (top + bottom) / 2 + 30,
      );
      pointer(
        canvas,
        "pointerup",
        (left + right) / 2 + 40,
        (top + bottom) / 2 + 30,
      );
      expect(readWidgets(api)[0].position).toEqual({ x: 340, y: 330 });
      const box = api.getAppState().whiteboardSelection!.bounds;
      pointer(canvas, "pointerdown", box.right, box.bottom);
      pointer(canvas, "pointermove", box.right + 50, box.bottom + 50);
      pointer(canvas, "pointerup", box.right + 50, box.bottom + 50);
      const scaled = readWidgets(api)[0];
      expect(scaled.params.size).toBeGreaterThan(0.6);
      act(() => api.setActiveTool({ type: "freedraw" }));
      expect(tools.container.querySelector(".fc-factory-gizmos")).toHaveStyle({
        visibility: "visible",
      });
      const group = tools.container.querySelector(
        '[data-gizmo="selected-gizmo"]',
      )!;
      const body = group.querySelector("rect,polygon,path")!;
      pointer(body, "pointerdown", 350, 350);
      pointer(body, "pointermove", 370, 360);
      pointer(body, "pointerup", 370, 360);
      expect(readWidgets(api)[0].params.size).toBeCloseTo(scaled.params.size);
      expect(readWidgets(api)[0].position.x).toBeCloseTo(
        scaled.position.x + 20,
      );
    } finally {
      tools.unmount();
      commands();
    }
  },
);

it("stretches only the ruler width on its rotated axis and restores a cancelled stretch", async () => {
  let api!: FcboardImperativeAPI;
  await editorRender(
    <Fcboard
      onMount={({ excalidrawAPI }) => {
        api = excalidrawAPI;
      }}
    />,
  );
  const commands = registerCanvasCommands(api);
  const original = {
    id: "ruler-width",
    kind: "ruler" as const,
    params: { ...widgetDefaults(), size: 0.8, rotation: 30 },
    position: { x: 300, y: 200 },
  };
  act(() => {
    renderWidget(api, original);
    api.setActiveTool({ type: "freedraw" });
  });
  const tools = render(<TeachingTools api={api} />);
  try {
    const group = tools.container.querySelector('[data-gizmo="ruler-width"]')!;
    const resize = within(group as HTMLElement).getByRole("button", {
      name: t("fcboard.size"),
    });
    const start = gizmoPoint(original, 336, 150);
    const end = gizmoPoint(original, 456, 350);
    pointer(resize, "pointerdown", ...start);
    pointer(resize, "pointerup", ...end);
    const next = readWidgets(api)[0];
    expect(next.params.size).toBe(0.8);
    expect(next.params.stretchX).toBeCloseTo(480 / 360);
    expect(next.position).toEqual(original.position);
    const rect = api
      .getSceneElements()
      .find((element) => element.type === "rectangle")!;
    expect(rect.height).toBeCloseTo(120 * 0.8);
    expect(rect.width).toBeCloseTo(480 * 0.8);
    pointer(resize, "pointerdown", ...end);
    pointer(resize, "pointermove", ...gizmoPoint(original, -500, 350));
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(readWidgets(api)[0].params.stretchX).toBeCloseTo(240 / 360);
    pointer(resize, "pointercancel", ...end);
    expect(readWidgets(api)[0].params.stretchX).toBeCloseTo(480 / 360);
  } finally {
    tools.unmount();
    commands();
  }
});

it("pinches the native protractor around its center, reverses immediately at its limit and records one undo", async () => {
  let api!: FcboardImperativeAPI;
  await editorRender(
    <Fcboard
      handleKeyboardGlobally
      onMount={({ excalidrawAPI }) => {
        api = excalidrawAPI;
      }}
    />,
  );
  const commands = registerCanvasCommands(api);
  const original = {
    id: "pinch",
    kind: "protractor" as const,
    params: {
      ...widgetDefaults(),
      size: 0.7,
      gizmo: { unit: 1, scaleUnit: 1, needle: 600, ball: 80 },
    },
    position: { x: 500, y: 100 },
  };
  act(() => {
    api.updateScene({ appState: { width: 1600, height: 1000 } });
    renderWidget(api, original, true, { exact: true });
    api.setActiveTool({ type: "freedraw" });
  });
  const tools = render(<TeachingTools api={api} />);
  const center = gizmoPoint(original, 180, 180);
  const frame = () =>
    act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
  try {
    const group = tools.container.querySelector('[data-gizmo="pinch"]')!;
    const body = group.querySelector("rect")!;
    expect(
      within(group as HTMLElement).queryByRole("button", {
        name: t("fcboard.size"),
      }),
    ).toBeNull();
    expect(api.getSceneElements()).toHaveLength(4);
    const images = api
      .getSceneElements()
      .filter((element) => element.type === "image");
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(api.getFiles()[image.fileId!].dataURL).toMatch(
        /^data:image\/png;base64,/,
      );
    }
    pointer(body, "pointerdown", 540, 180, 11);
    pointer(body, "pointerdown", 640, 180, 12);
    pointer(body, "pointermove", 740, 180, 12);
    await frame();
    expect(readWidgets(api)[0].params.size).toBeCloseTo(1.4);
    pointer(body, "pointermove", 840, 180, 12);
    await frame();
    expect(readWidgets(api)[0].params.size).toBeCloseTo(1.5);
    pointer(body, "pointermove", 830, 180, 12);
    await frame();
    expect(readWidgets(api)[0].params.size).toBeCloseTo(1.45);
    pointer(body, "pointerup", 830, 180, 12);
    const next = readWidgets(api)[0];
    expect(gizmoPoint(next, 180, 180)).toEqual(center);
    expect(next.params.gizmo?.unit).toBe(1);
    expect(api.getAppState().zoom.value).toBe(1);
    Keyboard.undo();
    expect(readWidgets(api)[0].params.size).toBeCloseTo(0.7);
    expect(gizmoPoint(readWidgets(api)[0], 180, 180)).toEqual(center);
    pointer(body, "pointerdown", 540, 180, 11);
    pointer(body, "pointerdown", 640, 180, 12);
    pointer(body, "pointermove", 700, 180, 12);
    await frame();
    pointer(body, "pointercancel", 700, 180, 12);
    expect(readWidgets(api)[0].params.size).toBeCloseTo(0.7);
  } finally {
    tools.unmount();
    commands();
  }
});

it("opens the compass along its rotated baseline with fixed legs and foot, and deletes only after release", async () => {
  let api!: FcboardImperativeAPI;
  await editorRender(
    <Fcboard
      handleKeyboardGlobally
      onMount={({ excalidrawAPI }) => {
        api = excalidrawAPI;
      }}
    />,
  );
  const commands = registerCanvasCommands(api);
  const original = {
    id: "fixed-compass",
    kind: "compass" as const,
    params: {
      ...widgetDefaults(),
      rotation: 90,
      size: 0.8,
      gizmo: { unit: 0.8, leg: 260, opening: 200 },
    },
    position: { x: 500, y: 100 },
  };
  act(() => {
    renderWidget(api, original);
    api.setActiveTool({ type: "freedraw" });
  });
  const tools = render(<TeachingTools api={api} />);
  try {
    const geometry = compassGeometry(original);
    const group = tools.container.querySelector(
      '[data-gizmo="fixed-compass"]',
    )!;
    const controls = within(group as HTMLElement);
    const resize = controls.getByRole("button", { name: t("fcboard.size") });
    const start = gizmoPoint(original, ...geometry.stretch);
    const end = gizmoPoint(
      original,
      geometry.stretch[0] + 100,
      geometry.stretch[1] + 150,
    );
    pointer(resize, "pointerdown", ...start);
    pointer(resize, "pointerup", ...end);
    const next = readWidgets(api)[0];
    const opened = compassGeometry(next);
    expect(opened.radius).toBeCloseTo(300);
    expect(opened.leg).toBe(260);
    expect(Math.hypot(opened.hinge[0], 300 - opened.hinge[1])).toBeCloseTo(260);
    expect(
      Math.hypot(opened.radius - opened.hinge[0], 300 - opened.hinge[1]),
    ).toBeCloseTo(260);
    expect(gizmoPoint(next, 0, 300)).toEqual(gizmoPoint(original, 0, 300));
    Keyboard.undo();
    expect(compassGeometry(readWidgets(api)[0]).radius).toBeCloseTo(200);
    const remove = controls.getByRole("button", { name: t("labels.delete") });
    const removePoint = gizmoPoint(original, ...geometry.remove);
    pointer(remove, "pointerdown", ...removePoint);
    expect(readWidgets(api)).toHaveLength(1);
    pointer(remove, "pointercancel", ...removePoint);
    expect(readWidgets(api)).toHaveLength(1);
    pointer(remove, "pointerdown", ...removePoint);
    pointer(remove, "pointerup", ...removePoint);
    await act(async () => {});
    expect(readWidgets(api)).toHaveLength(0);
  } finally {
    tools.unmount();
    commands();
  }
});

it("extends set-square catheti while retaining button size, tick spacing and its origin", async () => {
  let api!: FcboardImperativeAPI;
  await editorRender(
    <Fcboard
      onMount={({ excalidrawAPI }) => {
        api = excalidrawAPI;
      }}
    />,
  );
  const commands = registerCanvasCommands(api);
  const original = {
    id: "triangle-width",
    kind: "setSquare" as const,
    params: widgetDefaults(),
    position: { x: 300, y: 200 },
  };
  act(() => {
    api.updateScene({ appState: { width: 1600, height: 1000 } });
    renderWidget(api, original, true, { exact: true });
    api.setActiveTool({ type: "freedraw" });
  });
  const tools = render(<TeachingTools api={api} />);
  try {
    const group = tools.container.querySelector(
      '[data-gizmo="triangle-width"]',
    )!;
    const resize = within(group as HTMLElement).getByRole("button", {
      name: t("fcboard.size"),
    });
    const buttonSize = resize.querySelector("image")!.getAttribute("width");
    pointer(resize, "pointerdown", 504, 404);
    pointer(resize, "pointerup", 624, 504);
    const next = readWidgets(api)[0];
    expect(next.params.size).toBe(1);
    expect(next.params.stretchX).toBeCloseTo(480 / 360);
    expect(next.position).toEqual(original.position);
    expect(group.querySelector("polygon")).toHaveAttribute(
      "points",
      "0,0 480,0 0,480",
    );
    expect(resize.querySelector("image")).toHaveAttribute("width", buttonSize);
    expect(resize.querySelector("image")).toHaveAttribute(
      "x",
      String(480 - 156 - 24),
    );
    const text = api
      .getSceneElements()
      .find((element) => element.type === "text" && element.text === "1")!;
    expect(text.customData!.fcWidget.params.size).toBe(1);
  } finally {
    tools.unmount();
    commands();
  }
});

it("preserves the saved compass geometry when the display density changes", () => {
  const widget = {
    id: "saved-compass",
    kind: "compass" as const,
    params: {
      ...widgetDefaults(),
      gizmo: { unit: 0.5, density: 2, leg: 260, opening: 200 },
    },
    position: { x: 0, y: 0 },
  };
  const original = compassGeometry(widget);
  vi.stubGlobal("devicePixelRatio", 3);
  try {
    expect(compassGeometry(widget)).toEqual(original);
  } finally {
    vi.unstubAllGlobals();
  }
});
