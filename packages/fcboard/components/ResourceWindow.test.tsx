import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";

import { render } from "../tests/render";
import { t } from "../i18n";

import { ResourceWindow } from "./ResourceWindow";

import type { ResourceWindowBounds } from "./ResourceWindow";

const pointer = (
  node: Element,
  type: string,
  properties: Record<string, number>,
) =>
  fireEvent(
    node,
    Object.assign(
      new Event(type, { bubbles: true, cancelable: true }),
      properties,
    ),
  );

it.each([0.5, 1, 2])(
  "moves and resizes the same live iframe at zoom %s and commits once per gesture",
  (scale) => {
    const commit = vi.fn();
    const initial = { x: 50, y: 60, width: 720, height: 460 };
    const Window = () => {
      const [bounds, setBounds] = useState(initial);
      return (
        <ResourceWindow
          title="Newton"
          bounds={bounds}
          scale={scale}
          onCommit={(next) => {
            commit(next);
            setBounds(next);
          }}
          onClose={() => {}}
          onReload={() => {}}
        >
          <iframe title="Live experiment" srcDoc="<p>Experiment state</p>" />
        </ResourceWindow>
      );
    };
    render(<Window />);
    const frame = screen.getByTitle("Live experiment");
    const drag = screen.getByRole("button", { name: "Newton" });
    pointer(drag, "pointerdown", {
      pointerId: 7,
      clientX: 100,
      clientY: 100,
      button: 0,
    });
    pointer(drag, "pointermove", { pointerId: 7, clientX: 140, clientY: 120 });
    expect(commit).not.toHaveBeenCalled();
    expect(screen.getByTitle("Live experiment")).toBe(frame);
    pointer(drag, "pointerup", { pointerId: 7, clientX: 140, clientY: 120 });
    expect(commit).toHaveBeenCalledWith({
      ...initial,
      x: 50 + 40 / scale,
      y: 60 + 20 / scale,
    });
    const resize = screen.getByRole("button", { name: t("fcboard.size") });
    pointer(resize, "pointerdown", {
      pointerId: 8,
      clientX: 100,
      clientY: 100,
      button: 0,
    });
    pointer(resize, "pointermove", {
      pointerId: 8,
      clientX: 180,
      clientY: 160,
    });
    pointer(resize, "pointerup", { pointerId: 8, clientX: 180, clientY: 160 });
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenLastCalledWith({
      x: 50 + 40 / scale,
      y: 60 + 20 / scale,
      width: 720 + 80 / scale,
      height: 460 + 60 / scale,
    });
    expect(screen.getByTitle("Live experiment")).toBe(frame);
  },
);

it("cancels a drag without changing the board and clamps keyboard movement to the actual viewport", () => {
  const commit = vi.fn<(bounds: ResourceWindowBounds) => void>();
  const close = vi.fn();
  const reload = vi.fn();
  render(
    <ResourceWindow
      title="Newton"
      bounds={{ x: 20, y: 20, width: 280, height: 300 }}
      viewport={{ left: 0, top: 0, right: 320, bottom: 480 }}
      onCommit={commit}
      onClose={close}
      onReload={reload}
    >
      <iframe title="Live experiment" />
    </ResourceWindow>,
  );
  const drag = screen.getByRole("button", { name: "Newton" });
  pointer(drag, "pointerdown", {
    pointerId: 1,
    clientX: 100,
    clientY: 100,
    button: 0,
  });
  pointer(drag, "pointermove", { pointerId: 1, clientX: 200, clientY: 200 });
  pointer(drag, "pointercancel", { pointerId: 1 });
  expect(commit).not.toHaveBeenCalled();
  fireEvent.keyDown(drag, { key: "ArrowLeft" });
  expect(commit).toHaveBeenLastCalledWith({
    x: 4,
    y: 20,
    width: 280,
    height: 300,
  });
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.reset") }));
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.close_website") }),
  );
  expect(reload).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
});
