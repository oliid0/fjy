import { expect, test } from "@playwright/test";

import { selectMenu } from "./menu";

for (const viewport of [
  { width: 390, height: 844 },
  { width: 800, height: 1280 },
  { width: 1920, height: 1080 },
]) {
  test(`original file cloud chooser and extraction-code controls fit at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await selectMenu(page, "打开");
    const picker = page.getByRole("dialog", { name: "打开", exact: true });
    await expect(
      picker.getByRole("button", { name: "本地", exact: true }),
    ).toBeEnabled();
    const box = await picker.boundingBox();
    expect(box!.width).toBeCloseTo(250, 0);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    await picker.getByRole("button", { name: "云端", exact: true }).click();
    const code = page.getByRole("dialog", {
      name: "请输入提取码",
      exact: true,
    });
    await expect(
      code.getByRole("button", { name: "确定", exact: true }),
    ).toBeDisabled();
    await code
      .getByRole("textbox", { name: "提取码", exact: true })
      .fill("Ab12");
    await expect(
      code.getByRole("button", { name: "确定", exact: true }),
    ).toBeEnabled();
    for (const control of await code.locator("button,input").all()) {
      await expect(control).toBeInViewport();
    }
    await page.keyboard.press("Escape");
    await selectMenu(page, "扫码分享");
    await page
      .getByRole("dialog", { name: "分享白板", exact: true })
      .getByRole("button", { name: "确定", exact: true })
      .click();
    const share = page.getByRole("dialog", { name: "扫码分享", exact: true });
    await expect(
      share.getByRole("button", { name: "云端", exact: true }),
    ).toBeEnabled();
    await expect(
      share.getByRole("button", { name: "本地", exact: true }),
    ).toBeDisabled();
  });
  test(`original background menu applies an image and remains usable at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await selectMenu(page, "白板设置");
    const settings = page.getByRole("dialog", {
      name: "白板设置",
      exact: true,
    });
    await settings.getByRole("button", { name: "背景", exact: true }).click();
    await expect(settings.locator(".fc-background-picker button")).toHaveCount(
      14,
    );
    await expect(settings.locator(".fc-background-colors button")).toHaveCount(
      6,
    );
    const box = await settings.boundingBox();
    expect(box!.width).toBeCloseTo(Math.min(520, viewport.width - 24), 0);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    for (const button of await settings
      .locator(".fc-background-picker button")
      .all()) {
      await expect(button).toBeInViewport();
    }
    await settings
      .locator('input[type="file"]')
      .setInputFiles("packages/fcboard/tests/fixtures/deer.png");
    const custom = settings.getByRole("button", {
      name: "自定义",
      exact: true,
    });
    await expect(custom).toHaveAttribute("aria-pressed", "true");
    const image = await custom.locator("img").getAttribute("src");
    expect(image).toMatch(/^data:image\/png;base64,/);
    await settings
      .getByRole("button", { name: "背景图案 3", exact: true })
      .click();
    await expect(custom).toHaveAttribute("aria-pressed", "false");
    await custom.click();
    await expect(custom).toHaveAttribute("aria-pressed", "true");
    await expect(custom.locator("img")).toHaveAttribute("src", image!);
    await page.keyboard.press("Escape");
    await selectMenu(page, "白板设置");
    await settings.getByRole("button", { name: "背景", exact: true }).click();
    await expect(custom).toHaveAttribute("aria-pressed", "true");
  });

  test(`periodic table selects real details and inserts a card at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page
      .getByRole("toolbar", { name: "白板工具栏" })
      .getByRole("button", { name: "插入", exact: true })
      .click();
    await page.getByRole("button", { name: "教学资源", exact: true }).click();
    const library = page.getByRole("dialog", { name: "教学资源", exact: true });
    await library.getByRole("button", { name: "化学", exact: true }).click();
    await library
      .getByRole("button", { name: "化学工具", exact: true })
      .click();
    await library.getByRole("button", { name: /元素周期表/ }).click();
    const table = page.getByRole("dialog", { name: "元素周期表", exact: true });
    await table.getByRole("button", { name: "6 C 碳", exact: true }).click();
    await expect(
      table.getByRole("heading", { name: "碳", exact: true }),
    ).toBeVisible();
    await expect(table.locator("dl")).toContainText("12.011");
    const insert = table.getByRole("button", { name: "插入元素", exact: true });
    await insert.scrollIntoViewIfNeeded();
    await expect(insert).toBeInViewport();
    const box = await table.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    await insert.click();
    await expect(table).toBeHidden();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator(".fcboard__canvas.interactive")).toBeVisible();
  });

  test(`source resource submenus and stage diagrams remain usable at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page
      .getByRole("toolbar", { name: "白板工具栏" })
      .getByRole("button", { name: "插入", exact: true })
      .click();
    await page.getByRole("button", { name: "教学资源", exact: true }).click();
    const library = page.getByRole("dialog", { name: "教学资源", exact: true });
    await library.getByRole("button", { name: "物理", exact: true }).click();
    await expect(library.getByRole("tab")).toHaveCount(7);
    await library.getByRole("tab", { name: "运动", exact: true }).click();
    await expect(library.locator(".fc-resource-grid > button")).toHaveCount(12);
    await library.getByRole("button", { name: "化学", exact: true }).click();
    await library
      .getByRole("button", { name: "分子结构", exact: true })
      .click();
    const diagrams = library.locator(".fc-resource-grid > button");
    await expect(diagrams).toHaveCount(7);
    for (const card of await diagrams.all()) {
      const bounds = await card.boundingBox();
      expect(bounds!.width).toBeGreaterThanOrEqual(66);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    }
    await library.getByRole("button", { name: "生物", exact: true }).click();
    await library
      .getByRole("button", { name: "细胞分裂", exact: true })
      .click();
    const stage = library.getByRole("region", {
      name: "减数第二次分裂",
      exact: true,
    });
    await expect(stage.getByRole("button")).toHaveCount(4);
    const last = stage.getByRole("button").last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await last.click();
    await expect(library).toBeHidden();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test(`scoreboard and chart editor operate without overlapping controls at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const openLibrary = async () => {
      await page
        .getByRole("toolbar", { name: "白板工具栏" })
        .getByRole("button", { name: "插入", exact: true })
        .click();
      await page.getByRole("button", { name: "教学资源", exact: true }).click();
      return page.getByRole("dialog", { name: "教学资源", exact: true });
    };
    const library = await openLibrary();
    await library.getByRole("button", { name: "其他", exact: true }).click();
    await library.getByRole("button", { name: /记分牌/ }).click();
    const scoreboard = page.getByRole("dialog", {
      name: "记分牌",
      exact: true,
    });
    const increment = scoreboard.getByRole("button", {
      name: "加分：组1",
      exact: true,
    });
    await increment.click();
    await expect(scoreboard.locator("output").first()).toHaveText("2");
    await scoreboard
      .getByRole("button", { name: "修改组名：组1", exact: true })
      .click();
    const rename = page.getByRole("dialog", { name: "修改组名", exact: true });
    await rename.getByRole("textbox").fill("红队");
    await rename.getByRole("button", { name: "确定", exact: true }).click();
    await expect(
      scoreboard.getByRole("button", { name: "加分：红队", exact: true }),
    ).toBeVisible();
    await scoreboard.getByRole("button", { name: "关闭", exact: true }).click();
    await library.getByRole("button", { name: "数学", exact: true }).click();
    await library
      .getByRole("button", { name: "数学工具", exact: true })
      .click();
    await library.getByRole("button", { name: /统计图表/ }).click();
    const chart = page.getByRole("dialog", {
      name: "编辑图表数据",
      exact: true,
    });
    await chart
      .getByRole("textbox", { name: "图例 1", exact: true })
      .fill("红队");
    await chart
      .getByRole("textbox", { name: "数据 1", exact: true })
      .fill("50");
    await chart.getByRole("button", { name: "饼", exact: true }).click();
    await expect(
      chart.getByRole("button", { name: "饼", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const insert = chart.getByRole("button", { name: "插入", exact: true });
    await expect(insert).toBeInViewport();
    const insertBox = await insert.boundingBox();
    const typeBox = await chart
      .getByRole("group", { name: "图表类型", exact: true })
      .boundingBox();
    expect(insertBox!.x).toBeGreaterThanOrEqual(typeBox!.x + typeBox!.width);
    await insert.click();
    await expect(chart).toBeHidden();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test(`original random wheel and function graph remain operable at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const openMathTools = async () => {
      await page
        .getByRole("toolbar", { name: "白板工具栏" })
        .getByRole("button", { name: "插入", exact: true })
        .click();
      await page.getByRole("button", { name: "教学资源", exact: true }).click();
      const library = page.getByRole("dialog", {
        name: "教学资源",
        exact: true,
      });
      await library
        .getByRole("button", { name: "数学工具", exact: true })
        .click();
      return library;
    };
    let library = await openMathTools();
    await library.getByRole("button", { name: /随机数/ }).click();
    const random = page.getByRole("dialog", { name: "随机数", exact: true });
    await random.getByRole("button", { name: "8", exact: true }).click();
    const minimum = random.getByRole("spinbutton", {
      name: "最小值",
      exact: true,
    });
    await minimum.focus();
    await page.keyboard.press("End");
    await random
      .getByRole("spinbutton", { name: "最大值", exact: true })
      .focus();
    await page.keyboard.press("End");
    const start = random.getByRole("button", { name: "开始", exact: true });
    await start.scrollIntoViewIfNeeded();
    await start.click();
    await expect(random.getByRole("status").locator("span")).toHaveCount(8);
    await expect(random.getByRole("status").locator("span").first()).toHaveText(
      "999",
    );
    await expect(random.getByRole("textbox")).toHaveCount(0);
    await random.getByRole("button", { name: "关闭", exact: true }).click();
    library = await openMathTools();
    await library.getByRole("button", { name: /^函数/ }).click();
    const graph = page.getByRole("dialog", { name: "函数预览", exact: true });
    await graph.getByRole("button", { name: "一次函数", exact: true }).click();
    const input = graph.getByRole("textbox", {
      name: "表达式：一次函数",
      exact: true,
    });
    await input.fill("2*x+1");
    await graph.getByRole("button", { name: "生成", exact: true }).click();
    const preview = graph.getByRole("img", { name: "函数预览", exact: true });
    await preview.scrollIntoViewIfNeeded();
    await expect(preview.locator('path[stroke="#0b5fff"]')).toHaveCount(1);
    const before = await preview.locator("circle").getAttribute("cx");
    const box = (await preview.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 30,
      box.y + box.height / 2 + 20,
      { steps: 6 },
    );
    await page.mouse.up();
    await expect(preview.locator("circle")).not.toHaveAttribute("cx", before!);
    await preview.dblclick();
    await expect(preview.locator("circle")).toHaveAttribute("cx", before!);
    const insert = graph.getByRole("button", { name: "插入函数", exact: true });
    await insert.scrollIntoViewIfNeeded();
    await expect(insert).toBeInViewport();
    await insert.click();
    await expect(graph).toBeHidden();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}
