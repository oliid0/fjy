import { expect, test } from "@playwright/test";

import { openTeachingTools } from "./menu";

for (const width of [390, 800, 1920]) {
  test(`built-in toolbox works without OEM packages and remains reachable at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 720 });
    await page.goto("/");
    await openTeachingTools(page);
    const group = page.getByRole("group", { name: "大屏工具", exact: true });
    await expect(group.getByRole("button")).toHaveCount(6);
    await expect(
      page
        .getByRole("dialog", { name: "教学工具", exact: true })
        .getByRole("button", { name: "快传", exact: true }),
    ).toBeVisible();
    await expect(
      group.getByRole("button", { name: "打开快传", exact: true }),
    ).toHaveCount(0);
    // All original controls share the merged toolbox grid.
    const { box, controls } = await group.evaluate((element) => {
      const grid = element.closest(".fc-insert-grid");
      if (!grid) {
        throw new Error("Factory tools are outside their rendered grid");
      }
      const bounds = (node: Element) => {
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      // Sample one animation frame so a panel transition cannot mix poses.
      return {
        box: bounds(grid),
        controls: Array.from(element.querySelectorAll("button"), bounds),
      };
    });
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(720);
    expect(controls).toHaveLength(6);
    for (const control of controls) {
      expect(control.x).toBeGreaterThanOrEqual(box.x);
      expect(control.x + control.width).toBeLessThanOrEqual(box.x + box.width);
      expect(control.y).toBeGreaterThanOrEqual(box.y);
      expect(control.y + control.height).toBeLessThanOrEqual(
        box.y + box.height,
      );
    }
    await page.screenshot({
      path: info.outputPath(`factory-toolbox-${width}.png`),
    });
    const calculator = group.getByRole("button", {
      name: "打开计算器",
      exact: true,
    });
    await calculator.click();
    const frame = page.frameLocator('iframe[title="计算器"]');
    await frame.getByRole("button", { name: "2", exact: true }).click();
    await frame.getByRole("button", { name: "+", exact: true }).click();
    await frame.getByRole("button", { name: "3", exact: true }).click();
    await frame.locator('button[data-key="Enter"]').click();
    await expect(frame.locator("#result-display")).toHaveText("5");
    await expect(
      page.getByRole("dialog", { name: "教学工具" }),
    ).not.toBeVisible();
    await frame
      .getByRole("button", { name: "Close calculator", exact: true })
      .click();
    await openTeachingTools(page);
    await group
      .getByRole("button", { name: "打开计时器", exact: true })
      .click();
    const timer = page.getByRole("dialog", { name: "计时器", exact: true });
    await timer.getByRole("button", { name: "设置", exact: true }).click();
    for (const unit of ["HH", "MM", "SS"]) {
      await timer
        .getByRole("spinbutton", { name: unit, exact: true })
        .press("Home");
    }
    await timer
      .getByRole("spinbutton", { name: "SS", exact: true })
      .press("ArrowUp");
    await timer
      .getByRole("spinbutton", { name: "SS", exact: true })
      .press("ArrowUp");
    await page.getByRole("button", { name: "播放工具", exact: true }).click();
    await expect(page.getByRole("timer")).toHaveText("00:00:00", {
      timeout: 5000,
    });
    await page
      .getByRole("dialog", { name: "计时器", exact: true })
      .getByRole("button", { name: "关闭", exact: true })
      .click();
  });
}
