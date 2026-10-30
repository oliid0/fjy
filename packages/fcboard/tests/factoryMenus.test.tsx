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

it("toggles the pen menu with real pointer-down taps and keeps the original eight pens together", async () => {
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
  expect(within(penTypes).getAllByRole("button")).toHaveLength(8);
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

it("switches eraser modes horizontally without leaving the menu or changing its selected size", async () => {
  await render(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  const eraser = screen.getByRole("button", { name: t("fcboard.eraser") });
  tap(eraser);
  tap(eraser);
  const dialog = screen.getByRole("dialog", {
    name: t("fcboard.eraser_settings"),
  });
  const modes = within(dialog).getByRole("group", {
    name: t("fcboard.erase_mode"),
  });
  const size = h.state.eraserSize;
  fireEvent.keyDown(modes, { key: "ArrowRight" });
  expect(h.state.eraserMode).toBe("object");
  expect(dialog).toBeInTheDocument();
  fireEvent.keyDown(modes, { key: "ArrowLeft" });
  expect(h.state.eraserMode).toBe("stroke");
  expect(h.state.eraserSize).toBe(size);
  tap(eraser);
  expect(
    screen.queryByRole("dialog", { name: t("fcboard.eraser_settings") }),
  ).toBeNull();
});
