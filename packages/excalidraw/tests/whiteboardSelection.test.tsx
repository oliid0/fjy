import { pointFrom } from "@excalidraw/math";

import { Excalidraw } from "../index";
import {
  clearAppStateForLocalStorage,
  cleanAppStateForExport,
  clearAppStateForDatabase,
} from "../appState";

import { API } from "./helpers/api";
import { act, render } from "./test-utils";

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
