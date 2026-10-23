import type { Page } from "@playwright/test";

export const openSettingsMenu = async (page: Page) => {
  await selectMenu(page, "白板设置");
  await page.getByRole("button", { name: "背景 ›", exact: true }).click();
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
  const paths: Record<string, string[]> = {
    "AI 与语音设置": ["设置", label],
    白板设置: ["设置", label],
    实时协作: ["设置", "实时协作", label],
    "导出图片...": ["设置", "保存到...", label],
  };
  for (const name of paths[label] || [label]) {
    await page.getByRole("menuitem", { name, exact: true }).click();
  }
};
