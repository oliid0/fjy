import { act } from "@testing-library/react";
import { CaptureUpdateAction } from "@fcboard/element";
import { pointFrom } from "@fcboard/math";

import type { LocalPoint } from "@fcboard/math";

import { Fcboard } from "../index";

import { render } from "./test-utils";
import { API } from "./helpers/api";

it("applies native object erasure while dragging, records one undo, and restores cancellation", async () => {
  await render(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  const api = window.h.app.api;
  const first = API.createElement({
    type: "rectangle",
    x: 100,
    y: 100,
    width: 20,
    height: 20,
  });
  const second = API.createElement({
    type: "rectangle",
    x: 200,
    y: 100,
    width: 20,
    height: 20,
  });
  API.updateScene({
    elements: [first, second],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  act(() => {
    api.setActiveTool({ type: "eraser" });
    api.updateScene({ appState: { eraserMode: "object" } });
  });
  const input = {
    id: "native-object",
    width: 10,
    height: 10,
    pointerType: "pen",
    points: [[100, 110, 0.5]] as [number, number, number][],
  };
  await act(async () => {
    api.nativeEraserGesture!({ ...input, phase: "start" });
  });
  expect(api.getSceneElements().map((element) => element.id)).toEqual([
    second.id,
  ]);
  await act(async () => {
    api.nativeEraserGesture!({
      ...input,
      phase: "move",
      points: [[200, 110, 0.5]],
    });
  });
  expect(api.getSceneElements()).toHaveLength(0);
  await act(async () => {
    api.nativeEraserGesture!({
      ...input,
      phase: "end",
      points: [[200, 110, 0.5]],
    });
  });
  act(() => api.executeAction("undo"));
  expect(api.getSceneElements().map((element) => element.id)).toEqual([
    first.id,
    second.id,
  ]);
  act(() => {
    api.nativeEraserGesture!({ ...input, id: "cancel", phase: "start" });
    api.nativeEraserGesture!({ ...input, id: "cancel", phase: "cancel" });
  });
  expect(api.getSceneElements().map((element) => element.id)).toEqual([
    first.id,
    second.id,
  ]);
});

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

it("applies native eraser patches to the latest scene and preserves another writer on cancellation", async () => {
  await render(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  const api = window.h.app.api;
  const ink = API.createElement({
    type: "freedraw",
    x: 100,
    y: 100,
    points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(100, 0)],
  });
  API.updateScene({ elements: [ink] });
  act(() => api.setActiveTool({ type: "eraser" }));
  let finish!: (
    updates: import("../eraser/stroke").NativeEraseUpdate[],
  ) => void;
  const backend = vi.fn(
    () =>
      new Promise<import("../eraser/stroke").NativeEraseUpdate[]>((resolve) => {
        finish = resolve;
      }),
  );
  const unregister = api.registerNativeEraserBackend!(backend);
  const input = {
    id: "worker",
    width: 10,
    height: 12,
    points: [[150, 100, 0.5]] as [number, number, number][],
  };
  let pending: void | Promise<void>;
  act(() => {
    pending = api.nativeEraserGesture!({ ...input, phase: "start" });
  });
  expect(api.getSceneElements()).toHaveLength(1);
  const other = API.createElement({
    type: "freedraw",
    x: 400,
    y: 300,
    points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(50, 50)],
  });
  API.updateScene({ elements: [ink, other] });
  await act(async () => {
    finish([
      {
        source: ink,
        version: ink.version,
        nonce: ink.versionNonce,
        survivors: [],
      },
    ]);
    await pending;
  });
  expect(api.getSceneElements().map((e) => e.id)).toEqual([other.id]);
  act(() => api.nativeEraserGesture!({ ...input, phase: "cancel" }));
  expect(api.getSceneElements().map((e) => e.id)).toEqual([ink.id, other.id]);
  unregister();
});

it("rejects a native cut if the source was moved while the worker was running", async () => {
  await render(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  const api = window.h.app.api;
  const ink = API.createElement({
    type: "freedraw",
    x: 100,
    y: 100,
    points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(100, 0)],
  });
  API.updateScene({ elements: [ink] });
  act(() => api.setActiveTool({ type: "eraser" }));
  let finish!: (
    updates: import("../eraser/stroke").NativeEraseUpdate[],
  ) => void;
  const unregister = api.registerNativeEraserBackend!(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const input = {
    id: "stale",
    width: 10,
    height: 12,
    points: [[150, 100, 0.5]] as [number, number, number][],
  };
  let pending: void | Promise<void>;
  act(() => {
    pending = api.nativeEraserGesture!({ ...input, phase: "start" });
  });
  const moved = { ...ink, x: 600, version: ink.version + 1 };
  API.updateScene({ elements: [moved] });
  await act(async () => {
    finish([
      {
        source: ink,
        version: ink.version,
        nonce: ink.versionNonce,
        survivors: [],
      },
    ]);
    await pending;
  });
  expect(api.getSceneElements()).toHaveLength(1);
  expect(api.getSceneElements()[0].x).toBe(600);
  act(() => api.nativeEraserGesture!({ ...input, phase: "cancel" }));
  unregister();
});
