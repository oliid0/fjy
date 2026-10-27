import { t } from "@excalidraw/excalidraw/i18n";
import { act, fireEvent, screen } from "@testing-library/react";

import { render } from "./test/render";
import { classroomCommands } from "./commands";
import { Spotlight } from "./Spotlight";

it("moves and resizes one spotlight, cancels interrupted dragging and retains keyboard controls", async () => {
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
  send(overlay, "pointermove", 280, 300);
  expect(ring.style.left).toBe("180px");
  expect(ring.style.top).toBe("200px");
  send(overlay, "pointercancel", 280, 300);
  send(overlay, "pointermove", 500, 500);
  expect(ring.style.left).toBe("180px");
  expect(ring.style.top).toBe("200px");
  const resize = screen.getByRole("slider", {
    name: t("fcboard.spotlight_size"),
  });
  send(resize, "pointerdown", 350, 370);
  send(resize, "pointermove", 460, 300);
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
