import type { Page } from "@playwright/test";

export const selectMenu = async (page: Page, label: string) => {
  await page.getByTestId("main-menu-trigger").click();
  await page
    .getByTestId("dropdown-menu")
    .getByText(label, { exact: true })
    .click();
};
