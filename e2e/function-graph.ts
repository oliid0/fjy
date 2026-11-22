import { expect } from "@playwright/test";

import type { Locator, Page } from "@playwright/test";

/** Exercise the same real CDP touch packets used by the device interaction tests. */
export const zoomFunctionGraph = async (
  page: Page,
  graph: Locator,
  renderer: "canvas" | "img" = "canvas",
) => {
  const surface = graph.locator(renderer);
  await expect(surface).toBeVisible();
  await expect(graph.locator("button,input,select,textarea")).toHaveCount(0);
  const snapshot = () =>
    renderer === "img"
      ? surface.getAttribute("src")
      : surface.evaluate((node: HTMLCanvasElement) => node.toDataURL());
  const initial = await snapshot();
  const box = (await surface.boundingBox())!;
  const session = await page.context().newCDPSession(page);
  const point = (id: number, dx: number) => ({
    id,
    x: box.x + box.width / 2 + dx,
    y: box.y + box.height / 2,
    radiusX: 2,
    radiusY: 2,
  });
  try {
    await session.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 5,
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point(1, -24)],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point(1, -24), point(2, 24)],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [point(1, -60), point(2, 60)],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect.poll(snapshot).not.toBe(initial);
  } finally {
    await session.send("Emulation.setTouchEmulationEnabled", {
      enabled: false,
    });
    await session.detach();
  }
};
