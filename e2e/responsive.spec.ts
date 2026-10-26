import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import type { Locator, Page } from "@playwright/test";

const rotations = [
  { width: 800, height: 1280 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 1280, height: 720 },
];

const contained = async (page: Page, panel: Locator) => {
  await expect(panel).toBeVisible();
  const viewport = page.viewportSize()!;
  await expect
    .poll(async () => {
      const rect = await panel.boundingBox();
      return (
        !!rect &&
        rect.x >= 0 &&
        rect.y >= 0 &&
        rect.x + rect.width <= viewport.width + 1 &&
        rect.y + rect.height <= viewport.height + 1
      );
    })
    .toBe(true);
  expect(
    await panel.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true);
};

for (const language of ["zh-CN", "de-DE", "ar-SA"]) {
  test(`open menus reflow across rotations and retain state in ${language}`, async ({
    page,
  }, info) => {
    const { fcboard: labels } = JSON.parse(
      await readFile(`packages/fcboard/locales/${language}.json`, "utf8"),
    ) as { fcboard: Record<string, string> };
    await page.addInitScript(
      (code) => localStorage.setItem("fcboard-language", code),
      language,
    );
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    const trigger = page.getByTestId("main-menu-trigger");
    await trigger.click();
    await page
      .getByRole("menuitem", { name: labels.settings, exact: true })
      .click();
    const settings = page.locator(".fc-settings-dialog");
    await settings
      .locator(".fc-settings-navigation .MuiListItemButton-root")
      .first()
      .click();
    const background = settings.locator(".fc-background-picker button").nth(3);
    await background.click();
    for (const viewport of rotations) {
      await page.setViewportSize(viewport);
      await contained(page, settings);
      await expect(background).toHaveAttribute("aria-pressed", "true");
      const nav = (await settings
        .locator(".fc-settings-navigation")
        .boundingBox())!;
      const content = (await settings
        .locator(".fc-settings-content")
        .boundingBox())!;
      expect(
        nav.x + nav.width <= content.x + 1 ||
          content.x + content.width <= nav.x + 1,
      ).toBe(true);
      expect(
        await settings
          .locator(".fc-settings-content")
          .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      ).toBe(true);
    }
    await page.screenshot({
      path: info.outputPath(`settings-rotation-${language}.png`),
    });
    await page.keyboard.press("Escape");
    await trigger.click();
    const menu = page.locator(".fc-material-menu");
    for (const viewport of rotations) {
      await page.setViewportSize(viewport);
      await contained(page, menu);
      const toolbar = (await page
        .locator(".fc-unified-toolbar")
        .boundingBox())!;
      await expect
        .poll(async () => {
          const rect = (await menu.boundingBox())!;
          return rect.y + rect.height <= toolbar.y + 1;
        })
        .toBe(true);
    }
    await page.keyboard.press("Escape");
    const pen = page
      .locator(".fc-drawing-tools")
      .getByRole("button", { name: labels.pen, exact: true });
    await pen.click();
    await pen.click();
    const properties = page.locator(".fc-editor-properties");
    for (const viewport of rotations) {
      await page.setViewportSize(viewport);
      await contained(page, properties);
      const toolbar = (await page
        .locator(".fc-unified-toolbar")
        .boundingBox())!;
      const rect = (await properties.boundingBox())!;
      expect(rect.y + rect.height).toBeLessThanOrEqual(toolbar.y + 1);
    }
    await page.keyboard.press("Escape");
    await page.locator("[data-board-insert]").click();
    await page
      .getByRole("button", { name: labels.teaching_resources, exact: true })
      .click();
    const resources = page.locator(".fc-resource-library");
    for (const viewport of rotations) {
      await page.setViewportSize(viewport);
      await contained(page, resources);
      await contained(page, resources.locator(".fc-resource-content"));
    }
    await page.keyboard.press("Escape");
    await page.locator("[data-teaching-tools]").click();
    await page
      .getByRole("button", { name: labels.recording, exact: true })
      .click();
    const recording = page.locator(".fc-recording-dialog");
    for (const viewport of rotations) {
      await page.setViewportSize(viewport);
      await contained(page, recording);
      await contained(page, recording.locator(".fc-recording-main"));
    }
    await page.screenshot({
      path: info.outputPath(`recording-rotation-${language}.png`),
    });
  });
}
