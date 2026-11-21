import { expect } from "@playwright/test";

import { openToolbox } from "./menu";

import type { Page } from "@playwright/test";

/** Use the actual composer; only provider transport is mocked by each test. */
export const submitQuiz = async (page: Page, requirements: string) => {
  await openToolbox(page);
  await page.getByRole("button", { name: "出题面板", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "出题面板", exact: true });
  await expect(composer).toBeVisible();
  await composer
    .getByRole("combobox", { name: "年级", exact: true })
    .selectOption("8");
  await composer.getByLabel("补充内容", { exact: true }).fill(requirements);
  await composer.getByRole("button", { name: "生成题目", exact: true }).click();
};
