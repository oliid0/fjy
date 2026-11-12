import { expect, test } from "@playwright/test";

// APK dimensions; latest requested layout removes the inter-button gap.
for (const width of [390, 800, 1920]) {
  test(`original toolbar surfaces and geometry at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1080 });
    await page.goto("/");
    const toolbar = page.getByRole("toolbar", { name: "白板工具栏" });
    const tools = toolbar.locator(".fc-drawing-tools");
    await expect(tools).toBeVisible();
    await expect(tools).toHaveCSS("background-color", "rgb(252, 252, 254)");
    await expect(toolbar.locator(".fc-board-controls")).toHaveCSS(
      "background-color",
      "rgb(242, 242, 242)",
    );
    const pen = tools.locator("[data-toolbar-pen]");
    const eraser = tools.locator("[data-toolbar-eraser]");
    await pen.click();
    await expect(pen).toHaveCSS("background-color", "rgb(3, 104, 255)");
    await expect(pen).toHaveCSS("color", "rgb(252, 252, 254)");
    await page.keyboard.press("Escape");
    await eraser.click();
    await expect(eraser).toHaveCSS("background-color", "rgb(3, 104, 255)");
    await expect(eraser.locator("img,svg")).toHaveCSS(
      "color",
      "rgb(252, 252, 254)",
    );
    const metrics = await toolbar.evaluate((root) => {
      const box = (selector: string) => {
        const node = root.querySelector(selector)!;
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      return {
        tools: box(".fc-drawing-tools"),
        navigation: box(".fc-toolbar-leading"),
        pen: box("[data-toolbar-pen]"),
        eraser: box("[data-toolbar-eraser]"),
        undoIcon: box('[data-testid="button-undo"] svg'),
      };
    });
    expect(metrics.tools.width).toBeCloseTo(480 * 0.67, 0);
    expect(metrics.tools.height).toBeCloseTo(74 * 0.67, 0);
    expect(metrics.pen.width).toBeCloseTo(58 * 0.67, 0);
    expect(metrics.pen.height).toBeCloseTo(58 * 0.67, 0);
    expect(metrics.undoIcon.width).toBeCloseTo(28 * 0.67, 0);
    expect(metrics.undoIcon.height).toBeCloseTo(28 * 0.67, 0);
    expect(metrics.eraser.x - metrics.pen.x - metrics.pen.width).toBeCloseTo(
      0,
      0,
    );
    expect(metrics.tools.x).toBeGreaterThanOrEqual(0);
    expect(metrics.tools.x + metrics.tools.width).toBeLessThanOrEqual(width);
    if (width <= 1000) {
      expect(
        metrics.tools.y - metrics.navigation.y - metrics.navigation.height,
      ).toBeGreaterThanOrEqual(3.9);
    } else {
      expect(metrics.navigation.y).toBeCloseTo(metrics.tools.y, 0);
      expect(metrics.navigation.x + metrics.navigation.width).toBeLessThan(
        metrics.tools.x,
      );
    }
  });
}
