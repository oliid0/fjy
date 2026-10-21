import type { Page } from "@playwright/test";

export const openSettingsMenu = async (page: Page) => {
  await page.getByTestId("main-menu-trigger").click();
  const settings = page.getByRole("menuitem", { name: "设置", exact: true });
  await settings.focus();
  await settings.press("ArrowRight");
};

export const selectMenu = async (page: Page, label: string) => {
  if (
    [
      "提问与讲解",
      "课堂录制",
      "课件 / 局域网快传",
      "总结白板",
      "语音指令",
      "截屏",
    ].includes(label)
  ) {
    await page.locator("[data-teaching-tools]").click();
    if (["语音指令", "截屏"].includes(label)) {
      await page.getByText("更多工具", { exact: true }).click();
    }
    const names: Record<string, string> = {
      提问与讲解: "AI 问答",
      总结白板: "AI 总结",
      "课件 / 局域网快传": "快传",
    };
    await page
      .getByRole("button", { name: names[label] || label, exact: true })
      .click();
    return;
  }
  await page.getByTestId("main-menu-trigger").click();
  const item = page.getByRole("menuitem", { name: label, exact: true });
  if (!(await item.isVisible())) {
    const settings = page.getByRole("menuitem", { name: "设置", exact: true });
    await settings.focus();
    await settings.press("ArrowRight");
  }
  await item.click();
};
