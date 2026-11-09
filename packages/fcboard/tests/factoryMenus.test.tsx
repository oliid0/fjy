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

it("toggles the pen menu with real pointer-down taps and keeps the original seven visible pens together", async () => {
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
  expect(within(penTypes).getAllByRole("button")).toHaveLength(7);
  expect(
    within(dialog).queryByRole("button", {
      name: t("fcboard.calculation_pen"),
    }),
  ).toBeNull();
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
    within(dialog).getByRole("button", { name: t("fcboard.next_page") }),
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: t("fcboard.calculation_pen") }),
  );
  expect(h.state.currentItemInkAssist).toBe("calculation");
  expect(h.state.activeTool.type).toBe("freedraw");
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

it("keeps the native twelve-slot palette, applies gradients to the pen and restores solid color", async () => {
  await render(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  act(() => h.app.setActiveTool({ type: "freedraw" }));
  tap(screen.getByRole("button", { name: t("fcboard.pen") }));
  const colors = screen.getByRole("group", { name: t("fcboard.pen_colour") });
  const buttons = within(colors).getAllByRole("button");
  expect(buttons).toHaveLength(11);
  expect(
    within(colors).getByLabelText(t("fcboard.custom_pen_colour")),
  ).toBeInTheDocument();
  fireEvent.click(buttons[9]);
  expect(h.state.currentItemInkGradient).toBe("mint");
  expect(buttons[9]).toHaveAttribute("aria-pressed", "true");
  expect(
    screen
      .getByRole("img", { name: t("fcboard.current_pen_preview") })
      .querySelectorAll("stop"),
  ).toHaveLength(2);
  fireEvent.click(buttons[10]);
  expect(h.state.currentItemInkGradient).toBe("spectrum");
  act(() =>
    h.app.api.updateScene({ appState: { currentItemStrokeColor: "#112233" } }),
  );
  expect(h.state.currentItemInkGradient).toBeUndefined();
  fireEvent.click(buttons[10]);
  expect(h.state.currentItemInkGradient).toBe("spectrum");
  fireEvent.click(buttons[5]);
  expect(h.state.currentItemInkGradient).toBeUndefined();
  expect(h.state.currentItemStrokeColor).toBe("#ff0000");
});
