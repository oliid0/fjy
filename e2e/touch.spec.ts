import { expect, test } from "@playwright/test";

test.use({ hasTouch: true });

test("real touch input distinguishes a single-mode pinch from committed and multi-mode writing", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() =>
    localStorage.setItem(
      "fcboard-settings",
      JSON.stringify({ autoMath: false }),
    ),
  );
  await page.goto("/");
  const toolbar = page.locator(".fc-unified-toolbar");
  await expect(toolbar).toBeVisible();
  const multi = toolbar.getByRole("button", { name: "多点书写", exact: true });
  if (await multi.isVisible()) {
    await multi.click();
  }
  await expect(
    toolbar.getByRole("button", { name: "单点书写", exact: true }),
  ).toBeVisible();
  await toolbar.getByRole("button", { name: "画笔", exact: true }).click();
  await page.keyboard.press("Escape");
  const client = await page.context().newCDPSession(page);
  const touch = (
    type: "touchStart" | "touchMove" | "touchEnd",
    points: { id: number; x: number; y: number }[],
  ) =>
    client.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map((point) => ({
        ...point,
        radiusX: 1,
        radiusY: 1,
        force: 0.5,
      })),
    });
  const zoom = () =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("excalidraw-state") || "{}").zoom
          ?.value,
    );
  const inkCount = () =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("excalidraw") || "[]").filter(
          (element: { type: string; isDeleted?: boolean }) =>
            element.type === "freedraw" && !element.isDeleted,
        ).length,
    );
  await touch("touchStart", [{ id: 1, x: 400, y: 180 }]);
  await touch("touchMove", [{ id: 1, x: 420, y: 180 }]);
  await touch("touchStart", [
    { id: 1, x: 420, y: 180 },
    { id: 2, x: 620, y: 180 },
  ]);
  await touch("touchMove", [
    { id: 1, x: 420, y: 180 },
    { id: 2, x: 720, y: 180 },
  ]);
  await touch("touchEnd", []);
  await expect.poll(zoom).toBeCloseTo(1.5);
  await expect.poll(inkCount).toBe(0);
  await touch("touchStart", [{ id: 3, x: 400, y: 280 }]);
  await touch("touchMove", [{ id: 3, x: 460, y: 280 }]);
  await touch("touchStart", [
    { id: 3, x: 460, y: 280 },
    { id: 4, x: 620, y: 280 },
  ]);
  await touch("touchMove", [
    { id: 3, x: 500, y: 300 },
    { id: 4, x: 820, y: 280 },
  ]);
  await touch("touchEnd", []);
  await expect.poll(inkCount).toBe(1);
  await expect.poll(zoom).toBeCloseTo(1.5);
  await toolbar.getByRole("button", { name: "单点书写", exact: true }).click();
  const before = await zoom();
  await touch("touchStart", [{ id: 5, x: 400, y: 380 }]);
  await touch("touchStart", [
    { id: 5, x: 400, y: 380 },
    { id: 6, x: 620, y: 380 },
  ]);
  await touch("touchMove", [
    { id: 5, x: 450, y: 400 },
    { id: 6, x: 720, y: 400 },
  ]);
  await touch("touchEnd", []);
  await expect.poll(inkCount).toBe(3);
  await expect.poll(zoom).toBe(before);
  await page.screenshot({ path: info.outputPath("touch-mode-ownership.png") });
  await client.detach();
});
