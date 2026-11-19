import { useState } from "react";
import { Fcboard } from "@fcboard/fcboard";
import { t } from "@fcboard/fcboard/i18n";
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@fcboard/fcboard/tests/test-utils";
import {
  saveToolbarItems,
  TOOLBAR_STORAGE,
} from "@fcboard/fcboard/toolbarPreferences";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { NativeToolbarItems } from "./NativeToolbarItems";
afterEach(() => {
  localStorage.removeItem(TOOLBAR_STORAGE);
  vi.restoreAllMocks();
});
it("pins a real multi/single toggle and changes actual two-contact writing on each click", async () => {
  let api!: FcboardImperativeAPI;
  const Harness = () => {
    const [current, setCurrent] = useState<FcboardImperativeAPI>();
    return (
      <Fcboard
        UIOptions={{ unifiedToolbar: true }}
        onFcboardAPI={(value) => {
          api = value;
          setCurrent(value);
        }}
      >
        {current && <NativeToolbarItems api={current} />}
      </Fcboard>
    );
  };
  saveToolbarItems(["multi"]);
  const view = await render(<Harness />);
  act(() => api.updateScene({ appState: { width: 1000, height: 700 } }));
  const canvas = view.container.querySelector("canvas.interactive")!;
  const row = () =>
    within(
      screen.getByRole("toolbar", { name: t("fcboard.whiteboard_toolbar") }),
    );
  fireEvent.click(
    row().getByRole("button", { name: t("fcboard.multi_touch_writing") }),
  );
  expect(api.getAppState().multiStroke).toBe(false);
  act(() => api.setActiveTool({ type: "freedraw" }));
  const pointer = (type: string, id: number, x: number, y: number) =>
    fireEvent(
      canvas,
      Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
        clientX: x,
        clientY: y,
        pointerId: id,
        pointerType: "touch",
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        pressure: 0.5,
        width: 1,
        height: 1,
        isPrimary: id === 1,
      }),
    );
  const icon = (label: string) => {
    const button = row().getByRole("button", { name: label });
    expect(button.querySelector("img")).toBeNull();
    const paths = button.querySelectorAll("svg path");
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path).toHaveAttribute("stroke", "currentColor");
    }
  };
  icon(t("fcboard.single_touch_writing"));
  const draw = () => {
    pointer("pointerdown", 1, 100, 200);
    pointer("pointermove", 1, 150, 200);
    pointer("pointerdown", 2, 100, 300);
    pointer("pointermove", 1, 300, 200);
    pointer("pointermove", 2, 300, 300);
    pointer("pointerup", 2, 300, 300);
    pointer("pointerup", 1, 300, 200);
  };
  draw();
  expect(
    api.getSceneElements().filter((item) => item.type === "freedraw"),
  ).toHaveLength(1);
  fireEvent.click(
    row().getByRole("button", { name: t("fcboard.single_touch_writing") }),
  );
  expect(api.getAppState().multiStroke).toBe(true);
  icon(t("fcboard.multi_touch_writing"));
  draw();
  expect(
    api.getSceneElements().filter((item) => item.type === "freedraw"),
  ).toHaveLength(3);
  const currentApi = api;
  for (const mode of [
    "text",
    "shape",
    "magic",
    "function",
    "calculation",
    "language",
  ] as const) {
    act(() =>
      currentApi.updateScene({
        appState: { currentItemInkAssist: mode, multiStroke: true },
      }),
    );
    expect(api.getAppState().multiStroke).toBe(false);
  }
  fireEvent.click(
    row().getByRole("button", { name: t("fcboard.single_touch_writing") }),
  );
  expect(api.getAppState().multiStroke).toBe(true);
  expect(api.getAppState().currentItemInkAssist).toBeUndefined();
  draw();
  expect(
    api.getSceneElements().filter((item) => item.type === "freedraw"),
  ).toHaveLength(5);
  act(() => saveToolbarItems([]));
  expect(
    row().queryByRole("button", { name: t("fcboard.multi_touch_writing") }),
  ).toBeNull();
});
