import { act } from "@testing-library/react";
import { CaptureUpdateAction } from "@fcboard/element";

import { Fcboard } from "../index";

import { render } from "./test-utils";
import { API } from "./helpers/api";

it("commits a completed native contact once with real pen metadata, composition events and reversible history", async () => {
  await render(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  const api = window.h.app.api;
  act(() => api.setActiveTool({ type: "freedraw" }));
  const phases: string[] = [];
  const committed = vi.fn();
  const stop = api.onInkProgress((_stroke, phase) => phases.push(phase));
  const stopCommit = api.onInkCommit(committed);
  const contact = {
    id: "native-contact",
    width: 2,
    height: 2,
    pointerType: "pen",
    points: [
      [100, 120, 0.3],
      [120, 140, 0.7],
    ] as [number, number, number][],
  };
  try {
    act(() =>
      api.nativeInk!({
        ...contact,
        phase: "start",
        points: contact.points.slice(0, 1),
      }),
    );
    expect(api.getSceneElements()).toHaveLength(0);
    expect(phases).toEqual(["start"]);
    await act(async () => {
      api.nativeInk!({ ...contact, phase: "end" });
      await Promise.resolve();
    });
    expect(api.getSceneElements()).toHaveLength(1);
    expect(api.getSceneElements()[0]).toMatchObject({
      type: "freedraw",
      points: [
        [0, 0],
        [20, 20],
      ],
      pressures: [0.3, 0.7],
      customData: { fcInk: { pen: "hard", finished: true } },
    });
    expect(committed).toHaveBeenCalledTimes(1);
    expect(phases).toEqual(["start", "settled"]);
    act(() => api.executeAction("undo"));
    expect(api.getSceneElements()).toHaveLength(0);
    act(() => api.executeAction("redo"));
    expect(api.getSceneElements()).toHaveLength(1);
  } finally {
    stop();
    stopCommit();
  }
});
it("cancels unfinished native ink without creating a saved object or undo entry", async () => {
  await render(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  const api = window.h.app.api;
  act(() => api.setActiveTool({ type: "freedraw" }));
  const contact = {
    id: "cancelled",
    width: 1,
    height: 1,
    pointerType: "touch",
    points: [[10, 10, 0.5]] as [number, number, number][],
  };
  const committed = vi.fn();
  const stop = api.onInkCommit(committed);
  try {
    act(() => {
      api.nativeInk!({ ...contact, phase: "start" });
      api.nativeInk!({ ...contact, phase: "cancel" });
    });
    expect(api.getSceneElements()).toHaveLength(0);
    expect(committed).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});

it("selects the actual native lasso path and preserves the operation frame", async () => {
  await render(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  const api = window.h.app.api;
  window.h.state.width = 1000;
  window.h.state.height = 800;
  const inside = API.createElement({
    type: "rectangle",
    x: 120,
    y: 120,
    width: 15,
    height: 15,
  });
  const outside = API.createElement({
    type: "rectangle",
    x: 240,
    y: 240,
    width: 15,
    height: 15,
  });
  API.updateScene({ elements: [inside, outside] });
  act(() => api.setActiveTool({ type: "lasso" }));
  const input = {
    id: "native-lasso",
    mode: "select" as const,
    points: [
      [80, 80, 0.5],
      [300, 80, 0.5],
      [80, 300, 0.5],
      [80, 80, 0.5],
    ] as [number, number, number][],
  };
  act(() => {
    api.nativeRegionGesture!({
      ...input,
      phase: "start",
      points: input.points.slice(0, 1),
    });
    api.nativeRegionGesture!({ ...input, phase: "end" });
  });
  expect(api.getAppState().selectedElementIds).toEqual({ [inside.id]: true });
  expect(api.getAppState().whiteboardSelection?.path).toEqual(
    input.points.map(([x, y]) => [x, y]),
  );
  expect(api.getSceneElements()).toHaveLength(2);
});
it("erases the native region once through normal geometry and supports undo and redo", async () => {
  await render(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  const api = window.h.app.api;
  const inside = API.createElement({
    type: "rectangle",
    x: 120,
    y: 120,
    width: 15,
    height: 15,
  });
  const outside = API.createElement({
    type: "rectangle",
    x: 400,
    y: 400,
    width: 15,
    height: 15,
  });
  API.updateScene({
    elements: [inside, outside],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  act(() => {
    api.setActiveTool({ type: "eraser" });
    api.updateScene({ appState: { eraserMode: "region" } });
  });
  const input = {
    id: "native-erase",
    mode: "regionErase" as const,
    points: [
      [80, 80, 0.5],
      [300, 80, 0.5],
      [300, 300, 0.5],
      [80, 300, 0.5],
      [80, 80, 0.5],
    ] as [number, number, number][],
  };
  await act(async () => {
    api.nativeRegionGesture!({
      ...input,
      phase: "start",
      points: input.points.slice(0, 1),
    });
    api.nativeRegionGesture!({ ...input, phase: "end" });
  });
  expect(api.getSceneElements().map((element) => element.id)).toEqual([
    outside.id,
  ]);
  act(() => api.executeAction("undo"));
  expect(api.getSceneElements().map((element) => element.id)).toEqual([
    inside.id,
    outside.id,
  ]);
  act(() => api.executeAction("redo"));
  expect(api.getSceneElements().map((element) => element.id)).toEqual([
    outside.id,
  ]);
});
