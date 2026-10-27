import { Excalidraw } from "@excalidraw/excalidraw";
import { t } from "@excalidraw/excalidraw/i18n";
import {
  render as editorRender,
  act,
  fireEvent,
} from "@excalidraw/excalidraw/tests/test-utils";
import { Keyboard } from "@excalidraw/excalidraw/tests/helpers/ui";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { within } from "@testing-library/react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { render } from "./test/render";
import { registerCanvasCommands } from "./canvasCommands";
import { TeachingTools } from "./TeachingTools";
import { readWidgets, renderWidget, widgetDefaults } from "./widgets";
import { gizmoPoint } from "./factoryGizmoShapes";

vi.mock("@excalidraw/excalidraw", async (original) => ({
  ...(await original<typeof import("@excalidraw/excalidraw")>()),
  ToolbarExtras: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

const pointer = (target: Element, type: string, x: number, y: number) =>
  fireEvent(
    target,
    Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
      pointerId: 11,
      pointerType: "touch",
      clientX: x,
      clientY: y,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
    }),
  );

it("moves a ruler as one undo, rolls back interrupted rotation, and draws one constrained editable stroke", async () => {
  let api!: ExcalidrawImperativeAPI;
  await editorRender(
    <Excalidraw
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
      x: 270,
      y: 230,
      points: [
        [0, 0],
        [300, 0],
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
  let api!: ExcalidrawImperativeAPI;
  await editorRender(
    <Excalidraw
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
    expect(ink.x).toBeCloseTo(square.position.x);
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
  let api!: ExcalidrawImperativeAPI;
  await editorRender(
    <Excalidraw
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
    fireEvent.click(
      within(group as HTMLElement).getByRole("button", {
        name: `${t("toolBar.freedraw")} 3`,
      }),
    );
    await act(async () => {});
    const arc = api
      .getSceneElements()
      .find((element) => element.type === "freedraw")!;
    expect(arc).toMatchObject({ x: 835, y: 280 });
    if (arc.type !== "freedraw") {
      throw new Error("Arc missing");
    }
    expect(arc.points).toHaveLength(91);
    expect(arc.points.at(-1)![0]).toBeCloseTo(-155);
    expect(arc.points.at(-1)![1]).toBeCloseTo(-155);
  } finally {
    tools.unmount();
    commands();
  }
});

it("opens both added native gizmos from the original toolbox page and draws a compass circle", async () => {
  let api!: ExcalidrawImperativeAPI;
  await editorRender(
    <Excalidraw
      onMount={({ excalidrawAPI }) => {
        api = excalidrawAPI;
      }}
    />,
  );
  const commands = registerCanvasCommands(api);
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
