import { expect, test } from "@playwright/test";

import { selectMenu } from "./menu";

import type { Page } from "@playwright/test";

const enterText = async (page: Page, text: string, select = true) => {
  await expect(
    page.getByRole("button", { name: "新建白板", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("t");
  await page.mouse.click(200, 180);
  const editor = page.locator("textarea.excalidraw-wysiwyg");
  await expect(editor).toBeVisible();
  await editor.fill(text);
  await editor.press("Escape");
  await page.keyboard.press("v");
  if (select) {
    await page.keyboard.press("Control+a");
  }
};

for (const viewport of [
  { width: 3840, height: 2160 },
  { width: 3080, height: 1240 },
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
  { width: 800, height: 600 },
  { width: 1080, height: 1920 },
  { width: 800, height: 1280 },
  { width: 844, height: 390 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
]) {
  test(`one reachable bottom toolbar at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const toolbar = page.getByRole("toolbar", { name: "白板工具栏" });
    await expect(toolbar).toBeVisible();
    const bounds = (await toolbar.boundingBox())!;
    const maxToolbarHeight =
      viewport.width <= 600 ? 200 : viewport.width <= 1000 ? 120 : 80;
    expect(bounds.y).toBeGreaterThanOrEqual(viewport.height - maxToolbarHeight);
    expect(
      Math.abs(bounds.y + bounds.height - viewport.height),
    ).toBeLessThanOrEqual(1);
    expect(bounds.height).toBeLessThanOrEqual(maxToolbarHeight);
    const buttons = await toolbar.locator("button").evaluateAll((nodes) =>
      nodes
        .filter(
          (node) =>
            node.getBoundingClientRect().height &&
            getComputedStyle(node).visibility !== "hidden",
        )
        .map((node) => {
          const { left, right, top, bottom } = node.getBoundingClientRect();
          return { left, right, top, bottom };
        }),
    );
    for (const button of buttons) {
      expect(button.left).toBeGreaterThanOrEqual(bounds.x - 1);
      expect(button.right).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
      expect(button.top).toBeGreaterThanOrEqual(bounds.y - 1);
      expect(button.bottom).toBeLessThanOrEqual(viewport.height + 1);
    }
    await expect(
      page.locator(
        ".fc-dock, .shapes-section-container, .FixedSideContainer_side_top, .layer-ui__wrapper__footer",
      ),
    ).toHaveCount(0);
    await expect(toolbar.locator(".undo-redo-buttons")).toHaveCount(1);
    await expect(toolbar.locator(".zoom-actions")).toHaveCount(0);
    const historyLabels = await toolbar
      .locator(".undo-redo-buttons button")
      .evaluateAll((buttons) =>
        buttons.map((button) => {
          const icon = button.querySelector(".ToolIcon__icon")!;
          const style = getComputedStyle(button);
          return {
            available: button.clientHeight,
            content:
              icon.getBoundingClientRect().height +
              parseFloat(getComputedStyle(button, "::after").lineHeight) +
              parseFloat(style.rowGap) +
              parseFloat(style.paddingTop) +
              parseFloat(style.paddingBottom),
          };
        }),
      );
    expect(
      historyLabels.every(({ available, content }) => content <= available),
    ).toBe(true);
    const groups = await toolbar.locator(":scope > div").evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        };
      }),
    );
    const separate = (a: typeof groups[number], b: typeof groups[number]) =>
      a.right <= b.left + 1 ||
      b.right <= a.left + 1 ||
      a.bottom <= b.top + 1 ||
      b.bottom <= a.top + 1;
    expect(separate(groups[0], groups[1])).toBe(true);
    expect(separate(groups[1], groups[2])).toBe(true);
    expect(separate(groups[0], groups[2])).toBe(true);
    await expect(
      page.getByRole("button", { name: "绘制函数", exact: true }),
    ).toHaveCount(0);
    await selectMenu(page, "AI 与语音设置");
    await expect(page.getByRole("dialog", { name: "白板设置" })).toBeVisible();
    const panelBounds = (await page.locator(".fc-panel").boundingBox())!;
    expect(panelBounds.width).toBeLessThanOrEqual(672);
    expect(panelBounds.height).toBeLessThanOrEqual(420);
    expect(
      Math.abs(panelBounds.x + panelBounds.width / 2 - viewport.width / 2),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(panelBounds.y + panelBounds.height / 2 - viewport.height / 2),
    ).toBeLessThanOrEqual(2);
    expect(panelBounds.y).toBeGreaterThanOrEqual(12);
    expect(panelBounds.x).toBeGreaterThanOrEqual(12);
    if (viewport.width >= viewport.height) {
      expect(panelBounds.width).toBeGreaterThan(panelBounds.height);
    }
    const navBounds = (await page
      .getByRole("navigation", { name: "设置导航" })
      .boundingBox())!;
    const contentBounds = (await page
      .locator(".fc-settings-content")
      .boundingBox())!;
    await page.getByRole("button", { name: "语言", exact: true }).click();
    const language = page.getByRole("combobox", {
      name: "选择语言",
      exact: true,
    });
    await expect(language).toBeVisible();
    expect(navBounds.x + navBounds.width).toBeLessThanOrEqual(
      contentBounds.x + 1,
    );
    await page
      .getByRole("button", { name: "画笔", exact: true })
      .last()
      .click();
    await expect(
      page.getByRole("slider", { name: "笔锋变化率", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "设置导航" }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`settings-${viewport.width}.png`),
    });
    await page.getByRole("button", { name: "手写与插入", exact: true }).click();
    const recognition = page.getByRole("combobox", {
      name: "手写识别",
      exact: true,
    });
    await recognition.click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.getByRole("listbox").press("Escape");
    await expect(page.getByRole("listbox")).toBeHidden();
    await expect(
      page.getByRole("dialog", { name: "白板设置", exact: true }),
    ).toBeVisible();
    await recognition.click();
    await page
      .locator(".MuiMenu-root .MuiBackdrop-root")
      .click({ position: { x: 4, y: 4 } });
    await expect(page.getByRole("listbox")).toBeHidden();
    await page.getByRole("button", { name: "模型与连接", exact: true }).click();
    const endpoint = page.getByRole("textbox", {
      name: "AI 接口地址",
      exact: true,
    });
    await endpoint.focus();
    await endpoint.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "白板设置", exact: true }),
    ).toBeHidden();
    await toolbar.evaluate((element) => {
      element.scrollLeft = 0;
    });
    const pen = toolbar.getByRole("button", { name: "画笔", exact: true });
    await pen.click();
    await pen.click();
    await expect(
      page.getByRole("dialog", { name: "画笔与对象属性" }),
    ).toBeVisible();
    const penBounds = (await page
      .getByRole("dialog", { name: "画笔与对象属性" })
      .boundingBox())!;
    const penTrigger = (await pen.boundingBox())!;
    expect(penBounds.y).toBeGreaterThanOrEqual(0);
    expect(penBounds.y + penBounds.height).toBeLessThanOrEqual(bounds.y + 4);
    expect(
      Math.abs(
        penBounds.x + penBounds.width / 2 - penTrigger.x - penTrigger.width / 2,
      ),
    ).toBeLessThanOrEqual(penBounds.width / 2 + 12);
    await page.keyboard.press("Escape");
    await toolbar.getByRole("button", { name: "插入", exact: true }).click();
    const insertIconWidth = (await page
      .locator(".fc-insert-grid button svg")
      .first()
      .boundingBox())!.width;
    await page.getByRole("button", { name: "表格", exact: true }).click();
    const table = page.getByRole("dialog", { name: "表格", exact: true });
    await expect(table.locator(".fc-table-picker-grid")).toBeVisible();
    const tableBounds = (await table.boundingBox())!;
    const insertBounds = (await toolbar
      .getByRole("button", { name: "插入", exact: true })
      .boundingBox())!;
    expect(tableBounds.y).toBeGreaterThanOrEqual(0);
    expect(tableBounds.y + tableBounds.height).toBeLessThanOrEqual(
      bounds.y + 4,
    );
    expect(
      Math.abs(
        tableBounds.x +
          tableBounds.width / 2 -
          insertBounds.x -
          insertBounds.width / 2,
      ),
    ).toBeLessThanOrEqual(tableBounds.width / 2 + 12);
    await page.screenshot({
      path: testInfo.outputPath(`table-picker-${viewport.width}.png`),
    });
    await table.press("Escape");
    await toolbar
      .getByRole("button", { name: "教学工具", exact: true })
      .click();
    const tools = page.getByRole("dialog", { name: "教学工具", exact: true });
    await expect(tools.getByText("更多工具", { exact: true })).toHaveCount(0);
    await expect(
      tools.getByRole("button", { name: "语音指令", exact: true }),
    ).toBeVisible();
    const toolsBounds = (await tools.boundingBox())!;
    expect(
      await tools
        .locator(".fc-tools-grid button svg")
        .first()
        .evaluate((element) => element.getBoundingClientRect().width),
    ).toBeCloseTo(insertIconWidth, 1);
    if (viewport.width >= viewport.height) {
      expect(toolsBounds.width).toBeGreaterThan(toolsBounds.height);
    }
    const columns = await tools
      .locator(".fc-tools-grid")
      .last()
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(" ").length,
      );
    expect(columns).toBeGreaterThanOrEqual(viewport.width < 360 ? 3 : 4);
    await page.screenshot({
      path: testInfo.outputPath(`tools-${viewport.width}.png`),
    });
    await tools.press("Escape");
    await expect(tools).toBeHidden();
    await toolbar.getByRole("button", { name: "插入", exact: true }).click();
    await page.getByRole("button", { name: "教学资源", exact: true }).click();
    const resources = page.getByRole("dialog", {
      name: "教学资源",
      exact: true,
    });
    await expect(
      resources.getByRole("navigation", { name: "学科", exact: true }),
    ).toBeVisible();
    const resourceBounds = (await resources.boundingBox())!;
    expect(
      Math.abs(
        resourceBounds.x + resourceBounds.width / 2 - viewport.width / 2,
      ),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(
        resourceBounds.y + resourceBounds.height / 2 - viewport.height / 2,
      ),
    ).toBeLessThanOrEqual(2);
    if (viewport.width >= viewport.height) {
      expect(resourceBounds.width).toBeGreaterThan(resourceBounds.height);
    }
    await page.screenshot({
      path: testInfo.outputPath(`resources-${viewport.width}.png`),
    });
    await page
      .getByRole("button", { name: "关闭教学资源", exact: true })
      .click();
    await expect(resources).toBeHidden();
    await toolbar.getByTestId("main-menu-trigger").click();
    await expect(page.getByTestId("dropdown-menu")).toBeVisible();
    const menu = (await page.getByTestId("dropdown-menu").boundingBox())!;
    expect(menu.y).toBeGreaterThanOrEqual(0);
    expect(menu.y + menu.height).toBeLessThanOrEqual(bounds.y + 4);
    await page.keyboard.press("Escape");
    await page.screenshot({
      path: testInfo.outputPath(`bottom-toolbar-${viewport.width}.png`),
    });
  });
}

test("selecting a formula draws an editable graph and changing its parameter updates the same graph", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("toolbar", { name: "白板工具栏" })).toBeVisible();
  await enterText(page, "y=a*x+1");
  await page.getByRole("button", { name: "AI", exact: true }).click();
  const slider = page.getByRole("slider", { name: "调节 a", exact: true });
  await expect(slider).toBeVisible();
  await slider.focus();
  for (let i = 0; i < 10; i++) {
    await slider.press("ArrowRight");
  }
  await expect(slider).toHaveValue("2");
  await page.getByRole("button", { name: "关闭工具浮层" }).click();
  await page.mouse.click(80, 400);
  await page.keyboard.press("v");
  await page.keyboard.press("Control+a");
  await expect(slider).toHaveValue("2");
  await page.screenshot({ path: testInfo.outputPath("selected-function.png") });
});

test("typed equations calculate only after tapping the selection action", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("toolbar", { name: "白板工具栏" })).toBeVisible();
  await page.addInitScript(() =>
    localStorage.setItem(
      "fcboard-settings",
      JSON.stringify({ answerStyle: "text" }),
    ),
  );
  await page.reload();
  await enterText(page, "1+1=");
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const scene = JSON.parse(localStorage.getItem("excalidraw") || "[]");
          return scene.some(
            (element: { type: string; text?: string; isDeleted?: boolean }) =>
              !element.isDeleted &&
              element.type === "text" &&
              element.text === "2",
          );
        }),
      { timeout: 12000 },
    )
    .toBe(true);
  await expect(page.locator(".fc-panel")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("automatic-answer.png") });
});

test("selected handwriting sends its PNG only after tapping calculate", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "fcboard-settings",
      JSON.stringify({
        model: "visual-test",
        apiKey: "test-only",
        autoMath: false,
        ocr: "cloud",
        answerStyle: "text",
      }),
    );
  });
  let requests = 0;
  await page.route(
    "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    async (route) => {
      const messages = route.request().postDataJSON().messages;
      expect(
        messages.some(
          (message: { role: string; content: unknown }) =>
            message.role === "user" &&
            Array.isArray(message.content) &&
            message.content.some(
              (part: { type: string; image_url?: { url: string } }) =>
                part.type === "image_url" &&
                part.image_url?.url.startsWith("data:image/png;base64,"),
            ),
        ),
      ).toBe(true);
      requests++;
      await route.fulfill({
        json: {
          choices: [
            {
              message: { content: "8*8" },
            },
          ],
        },
      });
    },
  );
  await page.goto("/");
  await expect(page.getByRole("toolbar", { name: "白板工具栏" })).toBeVisible();
  await page.keyboard.press("p");
  await page.mouse.move(200, 200);
  await page.mouse.down();
  await page.mouse.move(260, 260, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("v");
  await page.keyboard.press("Control+a");
  await expect(page.getByRole("toolbar", { name: "选区操作" })).toBeVisible();
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("excalidraw") || "[]").filter(
              (el: { type: string; text?: string; isDeleted?: boolean }) =>
                !el.isDeleted && el.type === "text" && el.text === "64",
            ).length,
        ),
      { timeout: 12000 },
    )
    .toBe(1);
  expect(requests).toBe(1);
  await expect(page.locator(".fc-panel")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "计算选区", exact: true }),
  ).toHaveCount(0);
});

test("whole board summary sends a real board image and returns to an editable canvas", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "fcboard-settings",
      JSON.stringify({
        model: "visual-test",
        apiKey: "test-only",
        autoMath: false,
      }),
    );
  });
  let imageSent = false;
  await page.route(
    "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    async (route) => {
      const body = route.request().postDataJSON();
      imageSent = body.messages.some(
        (message: { content: unknown }) =>
          Array.isArray(message.content) &&
          message.content.some(
            (part: { type: string; image_url?: { url: string } }) =>
              part.type === "image_url" &&
              part.image_url?.url.startsWith("data:image/png;base64,"),
          ),
      );
      await route.fulfill({
        json: {
          choices: [
            {
              message: {
                content: "一次函数：斜率决定变化趋势，截距决定与 y 轴的交点。",
              },
            },
          ],
        },
      });
    },
  );
  await page.goto("/");
  await expect(page.getByRole("toolbar", { name: "白板工具栏" })).toBeVisible();
  await enterText(page, "一次函数：斜率和截距");
  await selectMenu(page, "总结白板");
  const summary = page.getByRole("dialog", { name: "AI 总结", exact: true });
  await expect(summary).toContainText("斜率决定变化趋势");
  const summaryRect = (await summary.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(
    Math.abs(summaryRect.x + summaryRect.width / 2 - viewport.width / 2),
  ).toBeLessThan(2);
  expect(
    Math.abs(summaryRect.y + summaryRect.height / 2 - viewport.height / 2),
  ).toBeLessThan(2);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("excalidraw") || "[]").filter(
          (element: { isDeleted?: boolean }) => !element.isDeleted,
        ).length,
    ),
  ).toBe(1);
  expect(imageSent).toBe(true);
  await page.getByRole("button", { name: "全屏查看总结", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "退出总结全屏", exact: true }),
  ).toContainText("斜率决定变化趋势");
  await page.getByRole("button", { name: "退出总结全屏", exact: true }).click();
  await page.getByRole("button", { name: "关闭工具浮层" }).click();
  await page.mouse.click(100, 500);
  await page.keyboard.press("p");
  await page.mouse.move(100, 500);
  await page.mouse.down();
  await page.mouse.move(200, 540, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          JSON.parse(localStorage.getItem("excalidraw") || "[]").some(
            (element: { type: string }) => element.type === "freedraw",
          ),
        ),
      { timeout: 10000 },
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("summary-then-writing.png"),
  });
});

test("inserting four-line writing paper immediately accepts ink on its surface", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.getByRole("button", { name: "插入", exact: true }).click();
  await page.getByRole("button", { name: "四线格", exact: true }).click();
  await expect(page.locator(".fc-insertion-properties")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("excalidraw") || "[]").filter(
            (element: {
              isDeleted?: boolean;
              customData?: { fcInsertion?: { kind: string } };
            }) =>
              !element.isDeleted &&
              element.customData?.fcInsertion?.kind === "fourline",
          ).length,
      ),
    )
    .toBe(5);
  const paper = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("excalidraw") || "[]").find(
      (element: {
        type: string;
        customData?: { fcInsertion?: { kind: string } };
      }) =>
        element.type === "rectangle" &&
        element.customData?.fcInsertion?.kind === "fourline",
    ),
  );
  await page.mouse.move(paper.x + 30, paper.y + 20);
  await page.mouse.down();
  await page.mouse.move(paper.x + 50, paper.y + 50, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("excalidraw") || "[]").filter(
            (element: { type: string; isDeleted?: boolean }) =>
              !element.isDeleted && element.type === "freedraw",
          ).length,
      ),
    )
    .toBe(1);
});
