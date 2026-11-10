import { t } from "../i18n";
import { Fcboard } from "../index";

import { act, fireEvent, render, screen, within } from "./test-utils";

const { h } = window;
const tap = (target: Element) => {
  fireEvent.pointerDown(target, {
    pointerId: 1,
    pointerType: "touch",
    button: 0,
  });
  fireEvent.pointerUp(target, {
    pointerId: 1,
    pointerType: "touch",
    button: 0,
  });
  fireEvent.click(target);
};

it("toggles the pen menu with real pointer-down taps and offers all twelve pens together", async () => {
  await render(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  act(() => h.app.setActiveTool({ type: "freedraw" }));
  const pen = screen.getByRole("button", { name: t("fcboard.pen") });
  tap(pen);
  let dialog = screen.getByRole("dialog", {
    name: t("fcboard.pen_and_object_properties"),
  });
  const penTypes = within(dialog).getAllByRole("group", {
    name: t("fcboard.pen_type"),
  })[0];
  expect(within(penTypes).getAllByRole("button")).toHaveLength(12);
  expect(
    within(dialog).queryByRole("button", {
      name: t("fcboard.calculation_pen"),
    }),
  ).toBeInTheDocument();
  tap(pen);
  expect(
    screen.queryByRole("dialog", {
      name: t("fcboard.pen_and_object_properties"),
    }),
  ).toBeNull();
  tap(pen);
  dialog = screen.getByRole("dialog", {
    name: t("fcboard.pen_and_object_properties"),
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: t("fcboard.calculation_pen") }),
  );
  expect(h.state.currentItemInkAssist).toBe("calculation");
  expect(h.state.activeTool.type).toBe("freedraw");
  expect(dialog).toBeInTheDocument();
  tap(pen);
  expect(
    screen.queryByRole("dialog", {
      name: t("fcboard.pen_and_object_properties"),
    }),
  ).toBeNull();
  tap(pen);
  dialog = screen.getByRole("dialog", {
    name: t("fcboard.pen_and_object_properties"),
  });
  expect(
    within(dialog).getByRole("button", { name: t("fcboard.calculation_pen") }),
  ).toHaveAttribute("aria-pressed", "true");
});

it("closes after choosing an eraser mode, preserves size, and reopens on a later tap", async () => {
  await render(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  let time = 1000;
  const clock = vi.spyOn(Date, "now").mockImplementation(() => time);
  try {
    const eraser = screen.getByRole("button", { name: t("fcboard.eraser") });
    tap(eraser);
    const size = h.state.eraserSize;
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.erase_entire_object") }),
    );
    expect(h.state.eraserMode).toBe("region");
    expect(
      screen.queryByRole("dialog", { name: t("fcboard.eraser_settings") }),
    ).toBeNull();
    time += 400;
    tap(eraser);
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.erase_part_of_a_stroke") }),
    );
    expect(h.state.eraserMode).toBe("stroke");
    expect(h.state.eraserSize).toBe(size);
    expect(
      screen.queryByRole("dialog", { name: t("fcboard.eraser_settings") }),
    ).toBeNull();
  } finally {
    clock.mockRestore();
  }
});

it("keeps the expanded palette, applies gradients to the pen and restores solid color", async () => {
  await render(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  act(() => h.app.setActiveTool({ type: "freedraw" }));
  tap(screen.getByRole("button", { name: t("fcboard.pen") }));
  const colors = screen.getByRole("group", { name: t("fcboard.pen_colour") });
  const buttons = within(colors).getAllByRole("button");
  expect(buttons).toHaveLength(14);
  expect(
    within(colors).getByRole("button", {
      name: t("fcboard.custom_pen_colour"),
    }),
  ).toBeInTheDocument();
  fireEvent.click(buttons[11]);
  expect(h.state.currentItemInkGradient).toBe("mint");
  expect(buttons[11]).toHaveAttribute("aria-pressed", "true");
  expect(
    screen
      .getByRole("img", { name: t("fcboard.current_pen_preview") })
      .querySelectorAll("stop"),
  ).toHaveLength(2);
  fireEvent.click(buttons[12]);
  expect(h.state.currentItemInkGradient).toBe("spectrum");
  act(() =>
    h.app.api.updateScene({ appState: { currentItemStrokeColor: "#112233" } }),
  );
  expect(h.state.currentItemInkGradient).toBeUndefined();
  fireEvent.click(buttons[12]);
  expect(h.state.currentItemInkGradient).toBe("spectrum");
  fireEvent.click(buttons[5]);
  expect(h.state.currentItemInkGradient).toBeUndefined();
  expect(h.state.currentItemStrokeColor).toBe("#ff0000");
});

it("uses fine 2 and thick 4, retains each adjusted width and writes the selected actual stroke width", async () => {
  const view = await render(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  act(() => h.app.setActiveTool({ type: "freedraw" }));
  tap(screen.getByRole("button", { name: t("fcboard.pen") }));
  const fine = () =>
    screen.getByRole("button", { name: t("fcboard.fine_pen") });
  const thick = () =>
    screen.getByRole("button", { name: t("fcboard.thick_pen") });
  const width = () =>
    screen.getByRole("slider", { name: t("fcboard.pen_thickness") });
  fireEvent.click(fine());
  expect(fine()).toHaveAttribute("aria-pressed", "true");
  expect(width()).toHaveValue("2");
  fireEvent.click(thick());
  expect(thick()).toHaveAttribute("aria-pressed", "true");
  expect(width()).toHaveValue("4");
  fireEvent.change(width(), { target: { value: "10" } });
  fireEvent.click(fine());
  expect(width()).toHaveValue("2");
  fireEvent.change(width(), { target: { value: "6" } });
  fireEvent.click(thick());
  expect(width()).toHaveValue("10");
  fireEvent.click(fine());
  expect(width()).toHaveValue("6");
  tap(screen.getByRole("button", { name: t("fcboard.pen") }));
  const canvas = view.container.querySelector("canvas.interactive")!;
  for (const [type, x] of [
    ["pointerdown", 100],
    ["pointermove", 180],
    ["pointerup", 220],
  ] as const) {
    fireEvent(
      canvas,
      Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
        pointerId: 1,
        pointerType: "pen",
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX: x,
        clientY: 150,
        pressure: 0.5,
        width: 1,
        height: 1,
      }),
    );
  }
  const stroke = h.elements.find((element) => element.type === "freedraw")!;
  expect(stroke.strokeWidth).toBe(6);
  expect(stroke.customData?.fcInk?.tip).toBe("fine");
});
