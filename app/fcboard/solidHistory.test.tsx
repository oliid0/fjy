import { Fcboard } from "@fcboard/fcboard";

import { render, act } from "@fcboard/fcboard/tests/test-utils";
import { Keyboard, Pointer } from "@fcboard/fcboard/tests/helpers/ui";
import { API } from "@fcboard/fcboard/tests/helpers/api";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { animateSolid } from "./solidAnimation";
import { readWidgets, renderWidget, widgetDefaults } from "./widgets";
import { objectSelection } from "./board";

afterEach(() => vi.useRealTimers());

it.each([false, true])(
  "keeps a double-clicked factory solid grouped with unified toolbar %s",
  async (unifiedToolbar) => {
    let api!: FcboardImperativeAPI;
    const activate = vi.fn();
    await render(
      <Fcboard
        UIOptions={{ unifiedToolbar }}
        onObjectDoubleClick={activate}
        onMount={({ excalidrawAPI }) => {
          api = excalidrawAPI;
        }}
      />,
    );
    act(() => {
      renderWidget(api, {
        id: "solid",
        kind: "cube",
        params: widgetDefaults(),
        position: { x: 200, y: 200 },
      });
    });
    const parts = api.getSceneElements();
    act(() =>
      api.setActiveTool({ type: unifiedToolbar ? "lasso" : "selection" }),
    );
    API.setAppState(objectSelection(parts));
    const edge = parts.find(
      (element) => element.type === "line" && !element.customData?.fcSolidFace,
    )!;
    new Pointer("mouse").doubleClickAt(edge.x, edge.y);
    expect(activate).toHaveBeenCalledWith(
      expect.objectContaining({
        customData: expect.objectContaining({
          fcWidget: expect.objectContaining({ id: "solid" }),
        }),
      }),
    );
    expect(window.h.state.editingGroupId).toBeNull();
    expect(window.h.state.selectedLinearElement).toBeNull();
    expect(Object.keys(window.h.state.selectedElementIds).sort()).toEqual(
      parts.map((element) => element.id).sort(),
    );
  },
);

it("undoes the entire animated pose in the actual editor history, rather than its last frame", async () => {
  let api!: FcboardImperativeAPI;
  await render(
    <Fcboard
      handleKeyboardGlobally
      onMount={({ excalidrawAPI }) => {
        api = excalidrawAPI;
      }}
    />,
  );
  act(() => {
    renderWidget(api, {
      id: "solid",
      kind: "cube",
      params: widgetDefaults(),
      position: { x: 200, y: 200 },
    });
  });
  const original = readWidgets(api)[0];
  const count = API.getUndoStack().length;
  vi.useFakeTimers();
  const pending = animateSolid(
    api,
    original,
    {
      ...original,
      params: {
        ...original.params,
        solid: { ...original.params.solid, unfold: 1 },
      },
    },
    new AbortController().signal,
    160,
  );
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });
  }
  await pending;
  expect(readWidgets(api)[0].params.solid.unfold).toBe(1);
  expect(API.getUndoStack()).toHaveLength(count + 1);
  Keyboard.undo();
  expect(readWidgets(api)[0].params.solid.unfold).toBe(0);
  Keyboard.redo();
  expect(readWidgets(api)[0].params.solid.unfold).toBe(1);
});
