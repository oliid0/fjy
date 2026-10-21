import { t } from "@excalidraw/excalidraw/i18n";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { ToolButton } from "./ToolButton";

vi.mock("./App", () => ({
  useExcalidrawContainer: () => ({ id: "factory-toolbar" }),
}));

afterEach(() => vi.useRealTimers());

it("opens a button's settings once on long press and suppresses its following touch click", () => {
  vi.useFakeTimers();
  const open = vi.fn();
  const click = vi.fn();
  render(
    <ToolButton
      type="button"
      aria-label={t("fcboard.画笔")}
      onLongPress={open}
      onClick={click}
    />,
  );
  const pen = screen.getByRole("button", { name: t("fcboard.画笔") });
  fireEvent.pointerDown(pen, { button: 0, clientX: 50, clientY: 50 });
  act(() => vi.advanceTimersByTime(450));
  fireEvent.contextMenu(pen);
  fireEvent.pointerUp(pen);
  fireEvent.click(pen, { detail: 1 });
  expect(open).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledWith(pen);
  expect(click).not.toHaveBeenCalled();
  // A subsequent tap and keyboard activation must still work.
  fireEvent.pointerDown(pen, { button: 0 });
  fireEvent.pointerUp(pen);
  fireEvent.click(pen, { detail: 1 });
  fireEvent.click(pen, { detail: 0 });
  expect(click).toHaveBeenCalledTimes(2);
});

it.each(["move", "cancel", "leave", "unmount"])(
  "cancels pending long press on %s",
  (reason) => {
    vi.useFakeTimers();
    const open = vi.fn();
    const view = render(
      <ToolButton
        type="button"
        aria-label={t("fcboard.橡皮")}
        onLongPress={open}
      />,
    );
    const eraser = screen.getByRole("button", { name: t("fcboard.橡皮") });
    fireEvent.pointerDown(eraser, { button: 0, clientX: 20, clientY: 20 });
    if (reason === "move") {
      fireEvent.pointerMove(eraser, { clientX: 40, clientY: 20 });
    } else if (reason === "cancel") {
      fireEvent.pointerCancel(eraser);
    } else if (reason === "leave") {
      fireEvent.pointerLeave(eraser);
    } else {
      view.unmount();
    }
    act(() => vi.advanceTimersByTime(500));
    expect(open).not.toHaveBeenCalled();
  },
);
