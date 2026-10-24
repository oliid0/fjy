import { pointFrom } from "@excalidraw/math";

import { Excalidraw } from "../index";
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
    h.app.lassoTrail.endPath();
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
    h.app.lassoTrail.endPath();
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
  event("pointerdown", 130, 120);
  event("pointermove", 170, 150);
  event("pointerup", 170, 150);
  expect(h.elements.map(({ x, y }) => [x, y])).toEqual([
    [140, 130],
    [140, 180],
  ]);
  expect(h.state.whiteboardSelection?.bounds.left).toBe(
    before.bounds.left + 40,
  );
  expect(h.state.selectedLinearElement).toBeNull();
});

it("does not select a bounding-box corner outside the circled triangle", async () => {
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
    h.app.lassoTrail.endPath();
  });
  expect(h.state.selectedElementIds).toEqual({ [inside.id]: true });
});
