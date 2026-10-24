import { pointFrom } from "@excalidraw/math";

import { Excalidraw } from "../index";
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

it("keeps an open whiteboard gesture's region when it touches only part of a long stroke", async () => {
  await render(<Excalidraw UIOptions={{ unifiedToolbar: true }} />);
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
    bounds: { left: 88, top: 68, right: 312, bottom: 152 },
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
    <Excalidraw UIOptions={{ unifiedToolbar: true }} />,
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
  event("pointerdown", 140, 68);
  event("pointermove", 180, 98);
  event("pointerup", 180, 98);
  expect(h.elements.map(({ x, y }) => [x, y])).toEqual([
    [140, 130],
    [140, 180],
  ]);
  expect(h.state.whiteboardSelection?.bounds.left).toBe(
    before.bounds.left + 40,
  );
  expect(h.state.selectedLinearElement).toBeNull();
});

it("captures the complete rectangular region shown after a freeform gesture", async () => {
  await render(<Excalidraw UIOptions={{ unifiedToolbar: true }} />);
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
    [outside.id]: true,
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
  const view = await render(
    <Excalidraw UIOptions={{ unifiedToolbar: true }} />,
  );
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
  API.updateScene({ elements: [first, second] });
  act(() => {
    h.app.setActiveTool({ type: "lasso" });
    h.app.lassoTrail.startPath(80, 80);
    h.app.lassoTrail.addPointToPath(160, 160);
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

it("resizes only the selected region, selects its new contents on release and removes drag listeners", async () => {
  const { canvas, first, second } = await selectedRegion();
  regionPointer(canvas, "pointerdown", 172, 172);
  regionPointer(canvas, "pointermove", 360, 180);
  expect(h.state.selectedElementIds).toEqual({ [first.id]: true });
  regionPointer(canvas, "pointerup", 370, 190);
  expect(h.state.whiteboardSelection?.bounds).toEqual({
    left: 68,
    top: 68,
    right: 370,
    bottom: 190,
  });
  expect(h.state.selectedElementIds).toEqual({
    [first.id]: true,
    [second.id]: true,
  });
  const before = h.state.whiteboardSelection;
  regionPointer(canvas, "pointermove", 700, 700);
  expect(h.state.whiteboardSelection).toEqual(before);
  expect(h.elements.map(({ x, y }) => [x, y])).toEqual([
    [100, 100],
    [300, 100],
  ]);
});

it.each(["pointercancel", "lostpointercapture", "blur"])(
  "rolls back whole-region movement on %s",
  async (reason) => {
    const { canvas, first } = await selectedRegion();
    const before = h.state.whiteboardSelection;
    regionPointer(canvas, "pointerdown", 120, 68);
    regionPointer(canvas, "pointermove", 160, 98);
    expect(h.elements[0].x).toBe(140);
    if (reason === "blur") {
      fireEvent(window, new Event("blur"));
    } else {
      regionPointer(canvas, reason, 160, 98);
    }
    expect(h.elements[0].x).toBe(100);
    expect(h.state.whiteboardSelection).toEqual(before);
    expect(h.state.selectedElementIds).toEqual({ [first.id]: true });
    regionPointer(canvas, "pointermove", 500, 500);
    expect(h.elements[0].x).toBe(100);
  },
);

it("starts a new region from an interior drag and never edits or splits its objects", async () => {
  const { canvas, second } = await selectedRegion();
  regionPointer(canvas, "pointerdown", 120, 120);
  regionPointer(canvas, "pointermove", 350, 160);
  expect(h.state.selectedElementIds).toEqual({});
  regionPointer(canvas, "pointerup", 350, 160);
  expect(h.state.whiteboardSelection?.bounds).toEqual({
    left: 108,
    top: 108,
    right: 362,
    bottom: 172,
  });
  expect(h.state.selectedElementIds[second.id]).toBe(true);
  expect(h.elements).toHaveLength(2);
  expect(h.elements.map(({ x, y }) => [x, y])).toEqual([
    [100, 100],
    [300, 100],
  ]);
});

it("does not switch the whiteboard selector back to the legacy object editor on repeated clicks", async () => {
  const { getByRole } = await selectedRegion();
  const select = getByRole("button", { name: t("fcboard.选择") });
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
        { clientX: 230, clientY: 200 },
      ],
    }),
  );
  regionPointer(canvas, "pointerup", 230, 200);
  expect(h.state.whiteboardSelection?.bounds).toEqual({
    left: 84,
    top: 94,
    right: 296,
    bottom: 206,
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
