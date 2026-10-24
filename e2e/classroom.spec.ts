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
  { width: 390, height: 844 },
]) {
  test(`one reachable bottom toolbar at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const toolbar = page.getByRole("toolbar", { name: "白板工具栏" });
    await expect(toolbar).toBeVisible();
    const bounds = (await toolbar.boundingBox())!;
    expect(bounds.y).toBeGreaterThan(viewport.height - 100);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    expect(bounds.height).toBeLessThanOrEqual(80);
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
        return { left: rect.left, right: rect.right };
      }),
    );
    expect(groups[0].right).toBeLessThanOrEqual(groups[1].left);
    expect(groups[1].right).toBeLessThanOrEqual(groups[2].left);
    await expect(
      page.getByRole("button", { name: "绘制函数", exact: true }),
    ).toHaveCount(0);
    await selectMenu(page, "AI 与语音设置");
    await expect(page.getByRole("dialog", { name: "白板设置" })).toBeVisible();
    const panelBounds = (await page.locator(".fc-panel").boundingBox())!;
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
    await page.getByRole("button", { name: "关闭工具浮层" }).click();
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

test("screenshot summary sends a real board image and returns to an editable canvas", async ({
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
  await selectMenu(page, "截屏");
  await page
    .getByRole("button", { name: "总结选区 / 白板", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("excalidraw") || "[]").some(
          (element: { text?: string; isDeleted?: boolean }) =>
            !element.isDeleted && element.text?.includes("斜率决定变化趋势"),
        ),
      ),
    )
    .toBe(true);
  expect(imageSent).toBe(true);
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
