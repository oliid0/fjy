import { expect } from "@playwright/test";

import type { Page } from "@playwright/test";

/** Supply OCR at its provider boundary; sampling and submission use the real writing UI. */
export const writeQuestion = async (page: Page, text: string) => {
  await page.evaluate(() => {
    const settings = JSON.parse(
      localStorage.getItem("fcboard-settings") || "{}",
    );
    localStorage.setItem(
      "fcboard-settings",
      JSON.stringify({ ...settings, ocr: "cloud" }),
    );
  });
  const endpoint = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
  await page.route(endpoint, async (route) => {
    const body = route.request().postDataJSON();
    if (String(body.messages?.[0]?.content).startsWith("Transcribe only")) {
      await route.fulfill({
        json: { choices: [{ message: { content: text } }] },
      });
    } else {
      await route.fallback();
    }
  });
  const ink = page.getByRole("img", { name: "向 AI 教师提问", exact: true });
  const box = (await ink.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 45, box.y + Math.min(75, box.height - 20), {
    steps: 8,
  });
  await page.mouse.move(box.x + 70, box.y + 25, { steps: 8 });
  await page.mouse.up();
  await expect(ink.locator("path")).toHaveCount(1);
  await page.getByRole("button", { name: "发送问题", exact: true }).click();
};
