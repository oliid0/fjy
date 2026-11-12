import type { Page } from "@playwright/test";

export const openSettingsMenu = async (page: Page) => {
  await selectMenu(page, "白板设置");
};

export const selectMenu = async (page: Page, label: string) => {
  if (label === "导出图片...") {
    await page.keyboard.press("Control+Shift+e");
    return;
  }
  if (
    [
      "提问与讲解",
      "课堂录制",
      "课件 / 局域网快传",
      "总结白板",
      "语音指令",
    ].includes(label)
  ) {
    await openTeachingTools(page);
    const names: Record<string, string> = {
      提问与讲解: "AI出題",
      课堂录制: "录制",
      总结白板: "AI 总结",
      "课件 / 局域网快传": "快传",
    };
    await page
      .getByRole("button", { name: names[label] || label, exact: true })
      .click();
    return;
  }
  await page.getByTestId("main-menu-trigger").click();
  if (label === "实时协作") {
    await page.getByRole("menuitem", { name: "协同白板", exact: true }).click();
    return;
  }
  if (!["白板设置", "AI 与语音设置"].includes(label)) {
    await page.getByRole("menuitem", { name: label, exact: true }).click();
    return;
  }
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  if (label === "白板设置") {
    return;
  }
  if (label === "AI 与语音设置") {
    await page
      .getByRole("button", { name: "AI 与语音设置", exact: true })
      .click();
    await page.getByRole("button", { name: "模型与连接", exact: true }).click();
    return;
  }
  throw new Error(
    `Settings action must have an explicit current route: ${label}`,
  );
};

export const openTeachingTools = async (page: Page) => {
  await openSettingsMenu(page);
  await page.getByRole("button", { name: "工具栏", exact: true }).click();
  await page.getByRole("button", { name: "教学工具", exact: true }).click();
};
