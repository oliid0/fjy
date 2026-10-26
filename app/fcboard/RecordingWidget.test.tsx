import { fireEvent, render, screen } from "@testing-library/react";
import { t } from "@excalidraw/excalidraw/i18n";

import { RecordingWidget } from "./RecordingWidget";

const pointer = (node: Element, type: string, x: number, y: number) =>
  fireEvent(
    node,
    Object.assign(new Event(type, { bubbles: true }), {
      pointerId: 1,
      clientX: x,
      clientY: y,
    }),
  );
it("drags within the screen, rolls back cancellation and keeps the three controls independent", () => {
  const pause = vi.fn();
  const stop = vi.fn();
  const restore = vi.fn();
  const view = render(
    <RecordingWidget
      paused={false}
      elapsed={61}
      disabled={false}
      pauseDisabled={false}
      onPause={pause}
      onStop={stop}
      onRestore={restore}
    />,
  );
  const panel = screen.getByRole("toolbar", { name: t("fcboard.recording") });
  const grip = panel.querySelector(".fc-recording-drag")!;
  Object.assign(grip, { setPointerCapture: vi.fn() });
  pointer(grip, "pointerdown", 10, 10);
  pointer(grip, "pointermove", 5000, 5000);
  pointer(grip, "pointerup", 5000, 5000);
  expect(parseFloat(panel.style.left)).toBeLessThanOrEqual(innerWidth - 288);
  expect(parseFloat(panel.style.top)).toBeLessThanOrEqual(innerHeight - 60);
  const before = { left: panel.style.left, top: panel.style.top };
  pointer(grip, "pointerdown", 50, 50);
  pointer(grip, "pointermove", 100, 100);
  pointer(grip, "pointercancel", 100, 100);
  expect({ left: panel.style.left, top: panel.style.top }).toEqual(before);
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.recording_pause") }),
  );
  expect(pause).toHaveBeenCalledTimes(1);
  expect(stop).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.restore_recording_window") }),
  );
  expect(restore).toHaveBeenCalledTimes(1);
  view.rerender(
    <RecordingWidget
      paused
      elapsed={61}
      disabled={false}
      pauseDisabled={false}
      onPause={pause}
      onStop={stop}
      onRestore={restore}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.recording_resume") }),
  );
  expect(pause).toHaveBeenCalledTimes(2);
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.stop_recording") }),
  );
  expect(stop).toHaveBeenCalledTimes(1);
});

it("keeps its location when restored, reclamps on resize, and allows stop while pause is draining", () => {
  const stop = vi.fn();
  const props = {
    paused: false,
    elapsed: 4,
    disabled: false,
    pauseDisabled: true,
    onPause: vi.fn(),
    onStop: stop,
    onRestore: vi.fn(),
  };
  const view = render(<RecordingWidget {...props} />);
  const panel = screen.getByRole("toolbar");
  Object.defineProperty(panel, "offsetWidth", {
    configurable: true,
    get: () => (panel.hidden ? 0 : 240),
  });
  const grip = panel.querySelector(".fc-recording-drag")!;
  Object.assign(grip, { setPointerCapture: vi.fn() });
  pointer(grip, "pointerdown", 10, 10);
  pointer(grip, "pointermove", 5000, 10);
  pointer(grip, "pointerup", 5000, 10);
  const left = panel.style.left;
  expect(parseFloat(left)).toBe(innerWidth - 248);
  view.rerender(<RecordingWidget {...props} hidden />);
  expect(panel).not.toBeVisible();
  view.rerender(<RecordingWidget {...props} />);
  expect(panel).toBeVisible();
  expect(panel.style.left).toBe(left);
  expect(
    screen.getByRole("button", { name: t("fcboard.recording_pause") }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.stop_recording") }),
  );
  expect(stop).toHaveBeenCalledTimes(1);
  const width = innerWidth;
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 320,
  });
  try {
    fireEvent(window, new Event("resize"));
    expect(parseFloat(panel.style.left)).toBeLessThanOrEqual(72);
  } finally {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: width,
    });
  }
});
