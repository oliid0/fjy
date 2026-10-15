import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";

const enterText = async (page: Page, text: string, select = true) => {
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
    await expect(toolbar.locator(".zoom-actions")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "绘制函数", exact: true }),
    ).toHaveCount(0);
    await toolbar
      .getByRole("button", { name: "AI 与语音设置", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "AI 与语音设置" }),
    ).toBeVisible();
    const panelBounds = (await page.locator(".fc-panel").boundingBox())!;
    expect(panelBounds.y).toBeGreaterThanOrEqual(0);
    expect(panelBounds.y + panelBounds.height).toBeLessThanOrEqual(bounds.y);
    await page.getByRole("button", { name: "关闭工具浮层" }).click();
    await toolbar.evaluate((element) => {
      element.scrollLeft = 0;
    });
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

test("typed equations complete directly on the board without opening an AI panel", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("toolbar", { name: "白板工具栏" })).toBeVisible();
  await enterText(page, "1+1=", false);
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

test("selecting handwriting automatically recognizes its PNG and writes the result once", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "fcdraw-settings",
      JSON.stringify({
        model: "visual-test",
        apiKey: "test-only",
        autoMath: false,
      }),
    );
  });
  let requests = 0;
  await page.route(
    "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    async (route) => {
      const content = route.request().postDataJSON().messages[0].content;
      expect(
        content.some(
          (part: { type: string; image_url?: { url: string } }) =>
            part.type === "image_url" &&
            part.image_url?.url.startsWith("data:image/png;base64,"),
        ),
      ).toBe(true);
      requests++;
      await route.fulfill({
        json: {
          choices: [
            {
              message: { content: '{"action":"calculate","expression":"8*8"}' },
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
      "fcdraw-settings",
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
  await page.getByRole("button", { name: "截屏", exact: true }).click();
  await page
    .getByRole("button", { name: "总结选区 / 白板", exact: true })
    .click();
  await expect(page.locator(".fc-output")).toContainText("斜率决定变化趋势");
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
