import { t } from "@fcboard/fcboard/i18n";
import { act, fireEvent, screen } from "@testing-library/react";

import { render } from "./test/render";
import { classroomCommands } from "./commands";
import { Spotlight } from "./Spotlight";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("moves and resizes one spotlight, cancels interrupted dragging and retains keyboard controls", async () => {
  vi.useFakeTimers();
  render(<Spotlight />);
  await act(async () => {
    await classroomCommands.execute({
      name: "tools.spotlight",
      args: { x: 200, y: 200, radius: 100 },
    });
  });
  const overlay = screen.getByRole("region", { name: t("fcboard.spotlight") });
  const ring = overlay.querySelector<HTMLElement>(".fc-spotlight-ring")!;
  const send = (target: Element, type: string, x: number, y: number) =>
    fireEvent(
      target,
      Object.assign(new Event(type, { bubbles: true }), {
        pointerId: 7,
        clientX: x,
        clientY: y,
      }),
    );
  send(overlay, "pointerdown", 240, 260);
  expect(ring.style.left).toBe("100px");
  expect(ring.style.top).toBe("100px");
  send(overlay, "pointermove", 280, 300);
  await act(async () => vi.advanceTimersByTime(20));
  expect(ring.style.left).toBe("140px");
  expect(ring.style.top).toBe("140px");
  send(overlay, "pointercancel", 280, 300);
  send(overlay, "pointermove", 500, 500);
  expect(ring.style.left).toBe("140px");
  expect(ring.style.top).toBe("140px");
  const resize = screen.getByRole("slider", {
    name: t("fcboard.spotlight_size"),
  });
  send(resize, "pointerdown", 350, 370);
  send(resize, "pointermove", 420, 240);
  await act(async () => vi.advanceTimersByTime(20));
  expect(resize).toHaveAttribute("aria-valuenow", "180");
  send(resize, "lostpointercapture", 460, 300);
  send(resize, "pointermove", 800, 300);
  expect(resize).toHaveAttribute("aria-valuenow", "180");
  fireEvent.keyDown(resize, { key: "End" });
  expect(resize).toHaveAttribute("aria-valuenow", "600");
  fireEvent.keyDown(resize, { key: "Home" });
  expect(resize).toHaveAttribute("aria-valuenow", "48");
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.close_spotlight") }),
  );
  expect(
    screen.queryByRole("region", { name: t("fcboard.spotlight") }),
  ).toBeNull();
});

it("uses the original opaque backdrop, adjustable white aperture tint, shape chooser and outside-dismiss behavior", async () => {
  render(<Spotlight />);
  await act(async () => {
    await classroomCommands.execute({
      name: "tools.spotlight",
      args: { x: 200, y: 200, radius: 100 },
    });
  });
  const overlay = screen.getByRole("region", { name: t("fcboard.spotlight") });
  const backdrop = overlay.querySelector("svg > rect")!;
  expect(backdrop).toHaveAttribute("fill", "#000000");
  expect(backdrop).not.toHaveAttribute("fill-opacity");
  expect(overlay.querySelector("svg > g")).toHaveAttribute("fill-opacity", "0");
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.settings") }));
  fireEvent.click(screen.getByRole("button", { name: "#00a1ea" }));
  expect(backdrop).toHaveAttribute("fill", "#00a1ea");
  fireEvent.change(screen.getByRole("slider", { name: t("labels.opacity") }), {
    target: { value: "128" },
  });
  expect(
    Number(overlay.querySelector("svg > g")!.getAttribute("fill-opacity")),
  ).toBeCloseTo(128 / 255);
  fireEvent.pointerDown(overlay, { clientX: 900, clientY: 700 });
  expect(
    screen.queryByRole("group", { name: t("fcboard.settings") }),
  ).toBeNull();
  const ring = overlay.querySelector<HTMLElement>(".fc-spotlight-ring")!;
  expect(ring.style.left).toBe("100px");
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.spotlight_shape") }),
  );
  fireEvent.click(screen.getByRole("button", { name: "☆" }));
  expect(overlay.querySelector("mask polygon")).not.toBeNull();
  expect(
    screen.queryByRole("group", { name: t("fcboard.spotlight_shape") }),
  ).toBeNull();
});

it("coalesces dragging to one display frame and commits the final position before release", async () => {
  vi.useFakeTimers();
  render(<Spotlight />);
  await act(async () => {
    await classroomCommands.execute({
      name: "tools.spotlight",
      args: { x: 200, y: 200, radius: 100 },
    });
  });
  const overlay = screen.getByRole("region", { name: t("fcboard.spotlight") });
  const ring = overlay.querySelector<HTMLElement>(".fc-spotlight-ring")!;
  const frames = vi.spyOn(window, "requestAnimationFrame");
  const send = (type: string, x: number) =>
    fireEvent(
      overlay,
      Object.assign(new Event(type, { bubbles: true }), {
        pointerId: 7,
        clientX: x,
        clientY: 200,
      }),
    );
  send("pointerdown", 210);
  send("pointermove", 240);
  send("pointermove", 260);
  expect(frames).toHaveBeenCalledTimes(1);
  expect(ring.style.left).toBe("100px");
  send("pointerup", 260);
  expect(ring.style.left).toBe("150px");
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.close_spotlight") }),
  );
  await act(async () => vi.advanceTimersByTime(100));
  expect(
    screen.queryByRole("region", { name: t("fcboard.spotlight") }),
  ).toBeNull();
});
