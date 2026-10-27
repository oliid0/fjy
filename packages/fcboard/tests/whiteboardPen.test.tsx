import { factoryBrushWidths } from "@excalidraw/element/factoryBrush";

import {
  canvasConfigurationPatch,
  canvasConfigurationSnapshot,
} from "../../../app/fcboard/canvasConfiguration";
import { Excalidraw } from "../index";
import { whiteboardInkStyle } from "../whiteboardPen";
import { getDefaultAppState } from "../appState";

import { API } from "./helpers/api";
import { act, fireEvent, render } from "./test-utils";

import type { ExcalidrawImperativeAPI, UIOptions } from "../types";

const { h } = window;
const profile: NonNullable<UIOptions["inkProfile"]> = {
  hardPenWidth: 4,
  brushPenWidth: 15,
  eraserSize: 150,
  hardNibAvailable: true,
  hardNib: true,
  touchPressure: true,
};

it("simulates touch pressure without the explicit firmware capability, preserving real pen pressure", () => {
  for (const device of [undefined, { ...profile, touchPressure: false }]) {
    for (const pointerType of ["touch", "mouse", "pen"]) {
      expect(
        whiteboardInkStyle(
          getDefaultAppState(),
          { pointerType, width: 1, height: 1 },
          device,
          1,
        ).simulatePressure,
      ).toBe(pointerType !== "pen");
    }
  }
});

it("retains firmware touch pressure and applies the independent hard-nib setting only to the next hard stroke", async () => {
  let api!: ExcalidrawImperativeAPI;
  const { container } = await render(
    <Excalidraw
      UIOptions={{ unifiedToolbar: true, inkProfile: profile }}
      onExcalidrawAPI={(value) => {
        api = value;
      }}
    />,
  );
  const canvas = container.querySelector("canvas.interactive")!;
  const draw = (y: number) => {
    for (const [index, [x, pressure]] of [
      [100, 0.2],
      [200, 0.4],
      [300, 0.8],
      [310, 0],
    ].entries()) {
      fireEvent(
        canvas,
        Object.assign(
          new Event(
            index === 0
              ? "pointerdown"
              : index === 3
              ? "pointerup"
              : "pointermove",
            { bubbles: true, cancelable: true },
          ),
          {
            pointerId: 1,
            pointerType: "touch",
            button: 0,
            buttons: index === 3 ? 0 : 1,
            width: 2,
            height: 2,
            pressure,
            clientX: x,
            clientY: y,
          },
        ),
      );
    }
  };
  act(() => {
    API.setAppState({
      currentItemPenMode: "brush",
      whiteboardHardNib: undefined,
    });
    h.app.setActiveTool({ type: "freedraw" });
  });
  draw(100);
  const brush = api
    .getSceneElements()
    .find((element) => element.type === "freedraw")!;
  expect(brush.simulatePressure).toBe(false);
  expect(brush.pressures).toEqual([0.2, 0.4, 0.8, 0]);
  expect(brush.customData?.fcInk).toMatchObject({
    pen: "brush",
    finished: true,
  });
  expect(brush.customData?.fcInk?.nib).toBeUndefined();
  expect(factoryBrushWidths(brush).at(-1)).toBe(0);
  act(() => API.setAppState({ currentItemPenMode: "hard" }));
  draw(200);
  const enabled = api.getSceneElements().at(-1)!;
  expect(enabled.customData?.fcInk).toMatchObject({
    pen: "hard",
    nib: true,
    finished: true,
  });
  act(() =>
    api.updateScene({
      appState: canvasConfigurationPatch(api, { hardNib: false }, profile),
    }),
  );
  expect(
    canvasConfigurationSnapshot(api.getAppState(), profile).pen.hardNib,
  ).toBe(false);
  draw(300);
  expect(api.getSceneElements().at(-1)?.customData?.fcInk?.nib).toBe(false);
  expect(enabled.customData?.fcInk?.nib).toBe(true);
  expect(() =>
    canvasConfigurationPatch(
      api,
      { hardNib: true },
      { ...profile, hardNibAvailable: false },
    ),
  ).toThrow();
});
