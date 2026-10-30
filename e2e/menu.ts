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
    await page.locator("[data-teaching-tools]").click();
    const names: Record<string, string> = {
      提问与讲解: "AI 问答",
      课堂录制: "录制",
      总结白板: "AI 总结",
      "课件 / 局域网快传": "快传",
    };
    if (["提问与讲解", "课堂录制", "总结白板", "语音指令"].includes(label)) {
      await page.getByRole("button", { name: "下一页", exact: true }).click();
    }
    await page
      .getByRole("button", { name: names[label] || label, exact: true })
      .click();
    return;
  }
  await page.getByTestId("main-menu-trigger").click();
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
