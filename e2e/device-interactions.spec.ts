import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";

test.use({ hasTouch: true });
const dragTouch = async (
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  radius = 2,
) => {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...from, id: 1, radiusX: radius, radiusY: radius }],
    });
    for (let step = 1; step <= 8; step++) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: from.x + ((to.x - from.x) * step) / 8,
            y: from.y + ((to.y - from.y) * step) / 8,
            id: 1,
            radiusX: radius,
            radiusY: radius,
          },
        ],
      });
    }
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await session.detach();
  }
};

for (const width of [390, 1920]) {
  test(`native touch moves all four teaching tools after choosing selection at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const toolbar = page.getByRole("toolbar", {
      name: "白板工具栏",
      exact: true,
    });
    for (const [kind, label] of [
      ["ruler", "直尺"],
      ["protractor", "量角器"],
      ["compass", "圆规"],
      ["setSquare", "三角板"],
    ]) {
      await toolbar
        .getByRole("button", { name: "教学工具", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "教学工具", exact: true })
        .getByRole("button", { name: `插入${label}`, exact: true })
        .click();
      const current = async () =>
        page.evaluate(
          (kind) =>
            JSON.parse(localStorage.getItem("fcboard") || "[]")
              .filter(
                (element: {
                  isDeleted?: boolean;
                  customData?: { fcWidget?: { kind: string } };
                }) =>
                  !element.isDeleted &&
                  element.customData?.fcWidget?.kind === kind,
              )
              .at(-1)?.customData.fcWidget,
          kind,
        );
      await expect.poll(current).toBeDefined();
      const before = await current();
      await toolbar.getByRole("button", { name: "选择", exact: true }).click();
      const group = page.locator(`[data-gizmo="${before.id}"]`);
      await expect(group).toBeVisible();
      const body = group
        .locator(
          kind === "ruler" ? "rect" : kind === "setSquare" ? "polygon" : "path",
        )
        .first();
      const box = (await body.boundingBox())!;
      const from = {
        x: box.x + box.width * (kind === "setSquare" ? 0.2 : 0.5),
        y: box.y + box.height * (kind === "setSquare" ? 0.2 : 0.6),
      };
      expect(
        await page.evaluate(
          ({ from, id }) =>
            document
              .elementFromPoint(from.x, from.y)
              ?.closest("[data-gizmo]")
              ?.getAttribute("data-gizmo") === id,
          { from, id: before.id },
        ),
      ).toBe(true);
      await dragTouch(page, from, { x: from.x + 24, y: from.y + 28 });
      await expect
        .poll(async () => (await current()).position.x)
        .toBeCloseTo(before.position.x + 24, 0);
      await expect
        .poll(async () => (await current()).position.y)
        .toBeCloseTo(before.position.y + 28, 0);
      // Use the real delete handle so the next tool has no overlapping hit layer.
      await group.getByRole("button", { name: "删除", exact: true }).click();
      await expect.poll(current).toBeUndefined();
    }
  });

  test(`a confirmed table waits for native touch placement and uses the selected pen color at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const toolbar = page.getByRole("toolbar", {
      name: "白板工具栏",
      exact: true,
    });
    await toolbar.getByRole("button", { name: "插入", exact: true }).click();
    await page.getByRole("button", { name: "表格", exact: true }).click();
    await page
      .getByRole("dialog", { name: "表格", exact: true })
      .getByRole("button", { name: "确定", exact: true })
      .click();
    const table = () =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("fcboard") || "[]").filter(
          (element: {
            isDeleted?: boolean;
            customData?: { fcInsertion?: { kind: string } };
          }) =>
            !element.isDeleted &&
            element.customData?.fcInsertion?.kind === "table",
        ),
      );
    expect(await table()).toEqual([]);
    await expect(
      page.locator("[data-insertion-placement=table]"),
    ).toBeVisible();
    await dragTouch(
      page,
      { x: 35, y: 180 },
      { x: Math.min(width - 35, 385), y: 410 },
    );
    await expect.poll(async () => (await table()).length).toBeGreaterThan(0);
    const parts = await table();
    const state = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("fcboard-state") || "{}"),
    );
    const object = parts[0].customData.fcInsertion;
    expect(object.position).toEqual({ x: 35, y: 180 });
    expect(object.width).toBe(Math.min(width - 70, 350));
    expect(object.height).toBe(230);
    expect(
      parts.every(
        (part: { strokeColor: string }) =>
          part.strokeColor === state.currentItemStrokeColor,
      ),
    ).toBe(true);
    await expect(page.locator("[data-insertion-placement=table]")).toHaveCount(
      0,
    );
    await toolbar.getByRole("button", { name: "橡皮", exact: true }).click();
    await toolbar.getByRole("button", { name: "橡皮", exact: true }).click();
    await page
      .locator(".fc-eraser-mode")
      .getByRole("button", { name: "整个对象擦除", exact: true })
      .click();
    await toolbar.getByRole("button", { name: "橡皮", exact: true }).click();
    await toolbar.getByRole("button", { name: "画笔", exact: true }).click();
    await dragTouch(page, { x: 40, y: 185 }, { x: 65, y: 210 }, 40);
    await expect.poll(table).toEqual([]);
  });
}
