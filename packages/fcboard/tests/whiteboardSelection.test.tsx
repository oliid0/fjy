import { pointFrom } from "@fcboard/math";
import { CaptureUpdateAction } from "@fcboard/element";

import { interactiveResource } from "../../../app/fcboard/test/interactiveResource";
import {
  insertionDefaults,
  renderInsertion,
} from "../../../app/fcboard/insertObjects";

import { Fcboard } from "../index";
import { AnimationFrameHandler } from "../animation-frame-handler";
import { LassoTrail } from "../lasso";
import { t } from "../i18n";
import { actionDuplicateSelection } from "../actions/actionDuplicateSelection";
import { actionDeleteSelected } from "../actions/actionDeleteSelected";
import {
  clearAppStateForLocalStorage,
  cleanAppStateForExport,
  clearAppStateForDatabase,
} from "../appState";

import { API } from "./helpers/api";
import { act, fireEvent, render } from "./test-utils";

const { h } = window;

it("allows direct interaction with a teaching resource in the selector and gives drawing gestures the canvas", async () => {
  const { container, getByTitle } = await render(
    <Fcboard UIOptions={{ unifiedToolbar: true }} />,
  );
  h.state.width = 1600;
  h.state.height = 900;
  const resource = {
    ...API.createElement({
      type: "iframe",
      x: 100,
      y: 100,
      width: 400,
      height: 300,
    }),
    customData: { fcInteractiveResource: interactiveResource },
  };
  API.updateScene({ elements: [resource] });
  act(() => h.app.setActiveTool({ type: "lasso" }));
  const frame = getByTitle(interactiveResource.title);
  const inner = frame.closest(".fcboard__embeddable-container__inner")!;
  expect(inner).toHaveStyle({ pointerEvents: "all" });
  expect(h.state.activeEmbeddable).toBeNull();
  act(() => h.app.setActiveTool({ type: "freedraw" }));
  expect(inner).toHaveStyle({ pointerEvents: "none" });
  act(() => h.app.setActiveTool({ type: "lasso" }));
  const canvas = container.querySelector("canvas.interactive")!;
  regionPointer(canvas, "pointerdown", 40, 40);
  expect(inner).toHaveStyle({ pointerEvents: "none" });
  regionPointer(canvas, "pointercancel", 40, 40);
  expect(inner).toHaveStyle({ pointerEvents: "all" });
});

it("draws one open continuous lasso from the travelled area, clears it on lift and starts the next gesture cleanly", async () => {
  await render(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  h.state.width = 1600;
  h.state.height = 900;
  API.updateScene({
    elements: [
      API.createElement({
        type: "rectangle",
        x: 150,
        y: 140,
        width: 10,
        height: 10,
      }),
    ],
  });
  const frames: FrameRequestCallback[] = [];
  const raf = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
  const frame = () => frames.splice(0).forEach((callback) => callback(0));
  const trail = new LassoTrail(new AnimationFrameHandler(), h.app);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  act(() => {
    trail.start(svg);
    trail.startPath(100, 100);
    frame();
  });
  expect(svg.querySelector("path")?.getAttribute("d")).toBe("");
  act(() => {
    trail.addPointToPath(180, 90);
    trail.addPointToPath(240, 180);
    trail.addPointToPath(140, 230);
    frame();
  });
  const path = svg.querySelector("path")!;
  expect(svg.querySelectorAll("path")).toHaveLength(1);
  expect(path.getAttribute("d")?.match(/M/g)).toHaveLength(1);
  expect(path.getAttribute("d")).not.toContain("Z");
  expect(path.getAttribute("d")).toContain("L140,230");
  expect(path.getAttribute("fill")).toBe("none");
  act(() => {
    trail.finishPath();
    frame();
  });
  expect(svg.querySelector("path")).toBeNull();
  expect(h.state.whiteboardSelection?.path).toEqual([
    [100, 100],
    [180, 90],
    [240, 180],
    [140, 230],
  ]);
  act(() => {
    trail.startPath(500, 500);
    trail.addPointToPath(550, 550);
    frame();
  });
  expect(svg.querySelectorAll("path")).toHaveLength(1);
  expect(svg.querySelector("path")?.getAttribute("d")).toMatch(/^M500,500 /);
  expect(svg.querySelector("path")?.getAttribute("d")).not.toContain("100,100");
  trail.endPath();
  frame();
  raf.mockRestore();
});

it("selects a factory composite as one object when its lasso touches only one internal line", async () => {
  await render(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  h.state.width = 1600;
  h.state.height = 900;
  const parts = [100, 300].map((y) => ({
    ...API.createElement({
      type: "line",
      x: 100,
      y,
      points: [pointFrom(0, 0), pointFrom(100, 0)],
    }),
    customData: { fcWidget: { id: "one-widget", kind: "cube" } },
  }));
  API.updateScene({ elements: parts });
  act(() => {
    h.app.setActiveTool({ type: "lasso" });
    h.app.lassoTrail.startPath(90, 80);
    h.app.lassoTrail.addPointToPath(220, 80);
    h.app.lassoTrail.addPointToPath(220, 120);
    h.app.lassoTrail.addPointToPath(90, 120);
    h.app.lassoTrail.finishPath();
  });
  expect(h.state.selectedElementIds).toEqual(
    Object.fromEntries(parts.map((part) => [part.id, true])),
  );
  expect(h.state.selectedLinearElement).toBeNull();
  expect(h.elements.map((element) => element.id)).toEqual(
    parts.map((part) => part.id),
  );
});

it("keeps an open whiteboard gesture's region when it touches only part of a long stroke", async () => {
  await render(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  h.state.width = 1600;
  h.state.height = 900;
  const ink = API.createElement({
    type: "freedraw",
    x: 0,
    y: 100,
    width: 1000,
    height: 0,
    points: [pointFrom(0, 0), pointFrom(1000, 0)],
  });
  const outside = API.createElement({
    type: "rectangle",
    x: 500,
    y: 80,
    width: 20,
    height: 20,
  });
  API.updateScene({ elements: [ink, outside] });
  act(() => {
    h.app.setActiveTool({ type: "lasso" });
    h.app.lassoTrail.startPath(100, 80);
    h.app.lassoTrail.addPointToPath(100, 140);
    h.app.lassoTrail.addPointToPath(300, 140);
    h.app.lassoTrail.finishPath();
  });
  expect(h.state.selectedElementIds).toEqual({ [ink.id]: true });
  expect(h.state.whiteboardSelection).toEqual({
    bounds: { left: -20, top: 80, right: 1020, bottom: 120 },
    elementIds: [ink.id],
    path: expect.any(Array),
  });
  expect(clearAppStateForLocalStorage(h.state)).not.toHaveProperty(
    "whiteboardSelection",
  );
  expect(cleanAppStateForExport(h.state)).not.toHaveProperty(
    "whiteboardSelection",
  );
  expect(clearAppStateForDatabase(h.state)).not.toHaveProperty(
    "whiteboardSelection",
  );
});

it("moves a circled region as one selection without editing its individual lines", async () => {
  const { container } = await render(
    <Fcboard UIOptions={{ unifiedToolbar: true }} />,
  );
  h.state.width = 1600;
  h.state.height = 900;
  const lines = [100, 150].map((y) =>
    API.createElement({
      type: "line",
      x: 100,
      y,
      width: 100,
      height: 0,
      points: [pointFrom(0, 0), pointFrom(100, 0)],
    }),
  );
  API.updateScene({ elements: lines });
  act(() => {
    h.app.setActiveTool({ type: "lasso" });
    h.app.lassoTrail.startPath(80, 80);
    h.app.lassoTrail.addPointToPath(220, 80);
    h.app.lassoTrail.addPointToPath(220, 180);
    h.app.lassoTrail.addPointToPath(80, 180);
    h.app.lassoTrail.finishPath();
  });
  expect(Object.keys(h.state.selectedElementIds)).toHaveLength(2);
  expect(h.state.selectedLinearElement).toBeNull();
  const before = h.state.whiteboardSelection!;
  const canvas = container.querySelector("canvas.interactive")!;
  const event = (type: string, x: number, y: number) =>
    fireEvent(
      canvas,
      Object.assign(new Event(type, { bubbles: true }), {
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: "mouse",
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
      }),
    );
  event("pointerdown", 140, 80);
  event("pointermove", 180, 110);
  event("pointerup", 180, 110);
  expect(h.elements.map(({ x, y }) => [x, y])).toEqual([
    [140, 130],
    [140, 180],
  ]);
  expect(h.state.whiteboardSelection?.bounds.left).toBe(
    before.bounds.left + 40,
  );
  expect(h.state.selectedLinearElement).toBeNull();
});

it("selects the actual freeform area and excludes the empty operation-frame corner", async () => {
  await render(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  h.state.width = 1600;
  h.state.height = 900;
  const outside = API.createElement({
    type: "rectangle",
    x: 265,
    y: 265,
    width: 20,
    height: 20,
  });
  const inside = API.createElement({
    type: "rectangle",
    x: 120,
    y: 120,
    width: 20,
    height: 20,
  });
  API.updateScene({ elements: [outside, inside] });
  act(() => {
    h.app.setActiveTool({ type: "lasso" });
    h.app.lassoTrail.startPath(100, 100);
    h.app.lassoTrail.addPointToPath(300, 100);
    h.app.lassoTrail.addPointToPath(100, 300);
    h.app.lassoTrail.addPointToPath(100, 100);
    h.app.lassoTrail.finishPath();
  });
  expect(h.state.selectedElementIds).toEqual({
    [inside.id]: true,
  });
});

const regionPointer = (canvas: Element, type: string, x: number, y: number) =>
  fireEvent(
    canvas,
    Object.assign(new Event(type, { bubbles: true }), {
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
    }),
  );

const selectedRegion = async () => {
  const view = await render(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  h.state.width = 1600;
  h.state.height = 900;
  const first = API.createElement({
    type: "rectangle",
    x: 100,
    y: 100,
    width: 40,
    height: 40,
    groupIds: ["existing"],
  });
  const second = API.createElement({
    type: "rectangle",
    x: 300,
    y: 100,
    width: 40,
    height: 40,
    groupIds: ["existing"],
  });
  API.updateScene({
    elements: [first, second],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  act(() => {
    h.app.setActiveTool({ type: "lasso" });
    h.app.lassoTrail.startPath(80, 80);
    h.app.lassoTrail.addPointToPath(160, 80);
    h.app.lassoTrail.addPointToPath(160, 160);
    h.app.lassoTrail.addPointToPath(80, 160);
    h.app.lassoTrail.finishPath();
  });
  return {
    ...view,
    canvas: view.container.querySelector("canvas.interactive")!,
    first,
    second,
  };
};

it("keeps the visible region and existing objects intact when double-clicked or long-pressed", async () => {
  const { canvas, first, second } = await selectedRegion();
  const before = h.state.whiteboardSelection;
  expect(h.state.selectedElementIds).toEqual({ [first.id]: true });
  fireEvent.doubleClick(canvas, { clientX: 120, clientY: 120 });
  fireEvent.contextMenu(canvas, { clientX: 120, clientY: 120 });
  expect(h.state.whiteboardSelection).toEqual(before);
  expect(h.state.editingGroupId).toBeNull();
  expect(h.state.selectedLinearElement).toBeNull();
  expect(h.state.contextMenu).toBeNull();
  expect(h.elements.map((element) => [element.id, element.groupIds])).toEqual([
    [first.id, ["existing"]],
    [second.id, ["existing"]],
  ]);
});

it.each([false, true])(
  "suppresses canvas context menus without selecting objects (view mode: %s)",
  async (viewModeEnabled) => {
    const { container } = await render(
      <Fcboard
        UIOptions={{ unifiedToolbar: true }}
        viewModeEnabled={viewModeEnabled}
      />,
    );
    const element = API.createElement({
      type: "rectangle",
      x: 100,
      y: 100,
      width: 40,
      height: 40,
    });
    API.updateScene({ elements: [element] });
    const canvas = container.querySelector("canvas.interactive")!;
    for (const [clientX, clientY] of [
      [120, 120],
      [500, 500],
    ]) {
      expect(fireEvent.contextMenu(canvas, { clientX, clientY })).toBe(false);
      expect(h.state.contextMenu).toBeNull();
      expect(h.state.whiteboardSelection).toBeUndefined();
      expect(h.state.selectedElementIds).toEqual({});
    }
    expect(h.elements).toEqual([element]);
  },
);

it("scales the selected objects from a corner without adding neighbouring objects and records one undo step", async () => {
  const { canvas, first, second } = await selectedRegion();
  regionPointer(canvas, "pointerdown", 160, 160);
  regionPointer(canvas, "pointermove", 200, 200);
  expect(h.elements.find((element) => element.id === first.id)).toMatchObject({
    x: 110,
    y: 110,
    width: 60,
    height: 60,
  });
  regionPointer(canvas, "pointerup", 240, 240);
  expect(h.state.whiteboardSelection?.bounds).toEqual({
    left: 80,
    top: 80,
    right: 240,
    bottom: 240,
  });
  expect(h.state.selectedElementIds).toEqual({ [first.id]: true });
  expect(h.elements.find((element) => element.id === first.id)).toMatchObject({
    x: 120,
    y: 120,
    width: 80,
    height: 80,
  });
  expect(h.elements.find((element) => element.id === second.id)).toMatchObject({
    x: 300,
    y: 100,
    width: 40,
    height: 40,
  });
  const before = h.state.whiteboardSelection;
  regionPointer(canvas, "pointermove", 700, 700);
  expect(h.state.whiteboardSelection).toEqual(before);
  fireEvent.click(document.querySelector('[data-testid="button-undo"]')!);
  expect(h.elements.find((element) => element.id === first.id)).toMatchObject({
    x: 100,
    y: 100,
    width: 40,
    height: 40,
  });
});

it("keeps native tables fixed during a corner gesture and still allows movement", async () => {
  let api!: import("../types").FcboardImperativeAPI;
  const view = await render(
    <Fcboard
      UIOptions={{ unifiedToolbar: true }}
      onFcboardAPI={(value) => {
        api = value;
      }}
    />,
  );
  h.state.width = 1600;
  h.state.height = 900;
  await act(async () => {
    await renderInsertion(api, insertionDefaults("table", { x: 100, y: 100 }));
  });
  act(() => {
    api.setActiveTool({ type: "lasso" });
    h.app.lassoTrail.startPath(80, 80);
    h.app.lassoTrail.addPointToPath(480, 80);
    h.app.lassoTrail.addPointToPath(480, 300);
    h.app.lassoTrail.addPointToPath(80, 300);
    h.app.lassoTrail.finishPath();
  });
  const before = JSON.stringify(api.getSceneElements());
  const bounds = h.state.whiteboardSelection!.bounds;
  const canvas = view.container.querySelector("canvas.interactive")!;
  regionPointer(canvas, "pointerdown", bounds.right, bounds.bottom);
  regionPointer(canvas, "pointermove", bounds.right + 100, bounds.bottom + 100);
  regionPointer(canvas, "pointerup", bounds.right + 100, bounds.bottom + 100);
  expect(JSON.stringify(api.getSceneElements())).toBe(before);
  expect(h.state.whiteboardSelection!.bounds).toEqual(bounds);
  expect(h.state.toast?.message).toBe(t("fcboard.table_zoom_instructions"));
  regionPointer(canvas, "pointerdown", 125, 125);
  regionPointer(canvas, "pointerup", 165, 155);
  expect(api.getSceneElements()[0]).toMatchObject({
    x: 140,
    y: 130,
    width: 360,
    height: 180,
  });
});

it.each(["pointercancel", "lostpointercapture", "blur"])(
  "rolls back whole-region movement on %s",
  async (reason) => {
    const { canvas, first } = await selectedRegion();
    const before = h.state.whiteboardSelection;
    regionPointer(canvas, "pointerdown", 120, 80);
    regionPointer(canvas, "pointermove", 160, 110);
    expect(h.elements[0].x).toBe(140);
    if (reason === "blur") {
      fireEvent(window, new Event("blur"));
    } else {
      regionPointer(canvas, reason, 160, 110);
    }
    expect(h.elements[0].x).toBe(100);
    expect(h.state.whiteboardSelection).toEqual(before);
    expect(h.state.selectedElementIds).toEqual({ [first.id]: true });
    regionPointer(canvas, "pointermove", 500, 500);
    expect(h.elements[0].x).toBe(100);
  },
);

it("moves the entire selection from inside its frame without editing or splitting its objects", async () => {
  const { canvas, first, second } = await selectedRegion();
  const before = h.state.whiteboardSelection!;
  regionPointer(canvas, "pointerdown", 120, 120);
  regionPointer(canvas, "pointermove", 160, 150);
  expect(h.state.selectedElementIds).toEqual({ [first.id]: true });
  regionPointer(canvas, "pointerup", 160, 150);
  expect(h.state.whiteboardSelection?.bounds).toEqual({
    left: before.bounds.left + 40,
    top: before.bounds.top + 30,
    right: before.bounds.right + 40,
    bottom: before.bounds.bottom + 30,
  });
  expect(h.elements).toHaveLength(2);
  expect(h.elements.find((element) => element.id === first.id)?.x).toBe(140);
  expect(h.elements.find((element) => element.id === second.id)?.x).toBe(300);
});

it.each(["pointercancel", "lostpointercapture", "blur"])(
  "restores all selected geometry after a corner scale is cancelled by %s",
  async (reason) => {
    const { canvas, first } = await selectedRegion();
    const before = h.state.whiteboardSelection;
    regionPointer(canvas, "pointerdown", 160, 160);
    regionPointer(canvas, "pointermove", 240, 240);
    expect(h.elements.find((element) => element.id === first.id)?.width).toBe(
      80,
    );
    if (reason === "blur") {
      fireEvent(window, new Event("blur"));
    } else {
      regionPointer(canvas, reason, 240, 240);
    }
    expect(h.elements.find((element) => element.id === first.id)).toMatchObject(
      { x: 100, y: 100, width: 40, height: 40 },
    );
    expect(h.state.whiteboardSelection).toEqual(before);
    regionPointer(canvas, "pointermove", 500, 500);
    expect(h.elements.find((element) => element.id === first.id)?.width).toBe(
      40,
    );
  },
);

it("clears the previous frame on a new outside pointer down and leaves no selection after a tap or a straight drag", async () => {
  const { canvas } = await selectedRegion();
  regionPointer(canvas, "pointerdown", 600, 400);
  expect(h.state.whiteboardSelection).toBeUndefined();
  expect(h.state.selectedElementIds).toEqual({});
  regionPointer(canvas, "pointerup", 600, 400);
  expect(h.state.whiteboardSelection).toBeUndefined();
  regionPointer(canvas, "pointerdown", 90, 90);
  regionPointer(canvas, "pointermove", 160, 160);
  regionPointer(canvas, "pointerup", 170, 170);
  expect(h.state.selectedElementIds).toEqual({});
  expect(h.state.whiteboardSelection).toBeUndefined();
});

it("does not switch the whiteboard selector back to the legacy object editor on repeated clicks", async () => {
  const { getByRole } = await selectedRegion();
  const select = getByRole("button", { name: t("fcboard.select") });
  fireEvent.click(select);
  fireEvent.click(select);
  expect(h.state.activeTool.type).toBe("lasso");
  expect(h.state.selectedLinearElement).toBeNull();
});

it("keeps all coalesced circle samples in scene coordinates at a changed zoom and offset", async () => {
  const { canvas } = await selectedRegion();
  act(() => {
    h.app.setState({
      zoom: { value: 2 as typeof h.state.zoom.value },
      scrollX: 10 as typeof h.state.scrollX,
      scrollY: -20 as typeof h.state.scrollY,
      offsetLeft: 30,
      offsetTop: 40,
      whiteboardSelection: undefined,
    });
  });
  regionPointer(canvas, "pointerdown", 230, 200);
  fireEvent(
    canvas,
    Object.assign(new Event("pointermove", { bubbles: true }), {
      clientX: 230,
      clientY: 200,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      buttons: 1,
      getCoalescedEvents: () => [
        { clientX: 630, clientY: 400 },
        { clientX: 230, clientY: 400 },
        { clientX: 230, clientY: 200 },
      ],
    }),
  );
  regionPointer(canvas, "pointerup", 230, 200);
  expect(h.state.whiteboardSelection?.bounds).toEqual({
    left: 90,
    top: 90,
    right: 150,
    bottom: 150,
  });
});

it("keeps duplicated contents in one translated region and clears it when deleting the whole copy", async () => {
  const { first } = await selectedRegion();
  const before = h.state.whiteboardSelection!;
  API.executeAction(actionDuplicateSelection);
  expect(h.elements).toHaveLength(3);
  const copy = h.elements.find(
    (element) => element.id !== first.id && element.x > 100 && element.x < 200,
  )!;
  expect(h.state.selectedElementIds).toEqual({ [copy.id]: true });
  expect(h.state.whiteboardSelection?.bounds.left).toBe(
    before.bounds.left + copy.x - first.x,
  );
  expect(h.state.whiteboardSelection?.elementIds).toEqual([copy.id]);
  expect(h.state.selectedLinearElement).toBeNull();
  API.executeAction(actionDeleteSelected);
  expect(h.state.whiteboardSelection).toBeUndefined();
  expect(h.elements.filter((element) => !element.isDeleted)).toHaveLength(2);
});

it("restores frame contents as well as the selected frame when a region drag is cancelled", async () => {
  const { container } = await render(
    <Fcboard UIOptions={{ unifiedToolbar: true }} />,
  );
  h.state.width = 1600;
  h.state.height = 900;
  const frame = API.createElement({
    type: "frame",
    x: 100,
    y: 100,
    width: 200,
    height: 200,
  });
  const child = API.createElement({
    type: "rectangle",
    x: 150,
    y: 150,
    width: 40,
    height: 40,
    frameId: frame.id,
  });
  API.updateScene({ elements: [child, frame] });
  act(() => {
    h.app.setActiveTool({ type: "lasso" });
    h.app.lassoTrail.startPath(80, 80);
    h.app.lassoTrail.addPointToPath(320, 80);
    h.app.lassoTrail.addPointToPath(320, 320);
    h.app.lassoTrail.addPointToPath(80, 320);
    h.app.lassoTrail.finishPath();
  });
  const canvas = container.querySelector("canvas.interactive")!;
  expect(h.state.selectedElementIds).toEqual({ [frame.id]: true });
  regionPointer(canvas, "pointerdown", 200, 80);
  regionPointer(canvas, "pointermove", 240, 110);
  expect(h.elements.find((element) => element.id === child.id)?.x).toBe(190);
  regionPointer(canvas, "pointercancel", 240, 110);
  expect(h.elements.find((element) => element.id === child.id)?.x).toBe(150);
  expect(h.elements.find((element) => element.id === frame.id)?.x).toBe(100);
});

it("restores a container's bound label and attached arrow without reverting unrelated objects", async () => {
  const { container } = await render(
    <Fcboard UIOptions={{ unifiedToolbar: true }} />,
  );
  h.state.width = 1600;
  h.state.height = 900;
  const box = API.createElement({
    type: "rectangle",
    id: "box",
    x: 100,
    y: 100,
    width: 100,
    height: 100,
    boundElements: [
      { id: "label", type: "text" },
      { id: "attached", type: "arrow" },
    ],
  });
  const label = API.createElement({
    type: "text",
    id: "label",
    x: 110,
    y: 130,
    text: "abc",
    containerId: box.id,
  });
  const arrow = API.createElement({
    type: "arrow",
    id: "attached",
    x: 210,
    y: 150,
    width: 200,
    height: 0,
    points: [pointFrom(0, 0), pointFrom(200, 0)],
    startBinding: { elementId: box.id, fixedPoint: [1.1, 0.5], mode: "orbit" },
  });
  const outside = API.createElement({ type: "rectangle", x: 600, y: 400 });
  API.updateScene({ elements: [box, label, arrow, outside] });
  const originalArrow = {
    x: arrow.x,
    y: arrow.y,
    points: arrow.points.map(([x, y]) => [x, y]),
  };
  act(() => {
    h.app.setActiveTool({ type: "lasso" });
    h.app.lassoTrail.startPath(80, 80);
    h.app.lassoTrail.addPointToPath(170, 80);
    h.app.lassoTrail.addPointToPath(170, 220);
    h.app.lassoTrail.addPointToPath(80, 220);
    h.app.lassoTrail.finishPath();
  });
  expect(h.state.selectedElementIds).toEqual({ [box.id]: true });
  const canvas = container.querySelector("canvas.interactive")!;
  regionPointer(canvas, "pointerdown", 125, 80);
  regionPointer(canvas, "pointermove", 165, 110);
  expect(label.x).toBe(150);
  expect({ x: arrow.x, y: arrow.y, points: arrow.points }).not.toEqual(
    originalArrow,
  );
  act(() => h.app.scene.mutateElement(outside, { strokeColor: "#ff0000" }));
  regionPointer(canvas, "pointercancel", 165, 110);
  expect(label.x).toBe(110);
  expect({ x: arrow.x, y: arrow.y, points: arrow.points }).toEqual(
    originalArrow,
  );
  expect(outside.strokeColor).toBe("#ff0000");
});

it.each(["language", "cube", "cylinder"] as const)(
  "opens a %s object on double click in the original lasso tool without entering its internal paths",
  async (kind) => {
    const onObjectDoubleClick = vi.fn();
    const view = await render(
      <Fcboard
        UIOptions={{ unifiedToolbar: true }}
        onObjectDoubleClick={onObjectDoubleClick}
      />,
    );
    h.state.width = 1600;
    h.state.height = 900;
    const source = {
      ...API.createElement({
        type: "rectangle",
        x: 100,
        y: 100,
        width: 80,
        height: 40,
        groupIds: ["bilingual"],
      }),
      customData:
        kind === "language"
          ? { fcLanguage: { group: "bilingual", source: true } }
          : { fcWidget: { id: "solid", kind } },
    };
    API.updateScene({ elements: [source] });
    act(() => h.app.setActiveTool({ type: "lasso" }));
    fireEvent.doubleClick(view.container.querySelector("canvas.interactive")!, {
      clientX: 100,
      clientY: 120,
    });
    expect(onObjectDoubleClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: source.id }),
    );
    expect(h.state.editingGroupId).toBeNull();
    expect(h.state.selectedLinearElement).toBeNull();
  },
);
