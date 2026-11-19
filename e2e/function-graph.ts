import { expect } from "@playwright/test";

import type { Locator, Page } from "@playwright/test";

/** Exercise the same real CDP touch packets used by the device interaction tests. */
export const zoomFunctionGraph = async (page: Page, graph: Locator) => {
  const canvas = graph.locator("canvas");
  await expect(canvas).toBeVisible();
  await expect(graph.locator("button,input,select,textarea")).toHaveCount(0);
  const initial = await canvas.evaluate((node: HTMLCanvasElement) =>
    node.toDataURL(),
  );
  const box = (await canvas.boundingBox())!;
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
    await expect
      .poll(() =>
        canvas.evaluate((node: HTMLCanvasElement) => node.toDataURL()),
      )
      .not.toBe(initial);
  } finally {
    await session.send("Emulation.setTouchEmulationEnabled", {
      enabled: false,
    });
    await session.detach();
  }
};
