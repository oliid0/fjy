import { expect, test } from "@playwright/test";

test("APK toolbar keeps drawing controls compact and insertion tools contextual", async ({
  page,
}, info) => {
  await page.goto("/");
  const toolbar = page.getByRole("toolbar", { name: "白板工具栏" });
  await expect(toolbar).toBeVisible();
  for (const name of ["画笔", "橡皮", "选择", "插入"]) {
    await expect(
      toolbar.getByRole("button", { name, exact: true }),
    ).toBeVisible();
  }
  await expect(toolbar.getByTestId("toolbar-rectangle")).toHaveCount(0);
  await expect(toolbar.getByRole("button", { name: "AI 教师" })).toHaveCount(0);
  const pen = toolbar.getByRole("button", { name: "画笔", exact: true });
  await pen.click();
  await pen.click();
  await expect(
    page.getByRole("dialog", { name: "画笔与对象属性" }),
  ).toBeVisible();
  await page.mouse.click(80, 80);
  await expect(
    page.getByRole("dialog", { name: "画笔与对象属性" }),
  ).toHaveCount(0);
  await toolbar.getByRole("button", { name: "插入", exact: true }).click();
  await expect(page.getByTestId("toolbar-rectangle")).toBeVisible();
  await page.keyboard.press("Escape");
  const eraser = toolbar.getByRole("button", { name: "橡皮", exact: true });
  await eraser.click();
  await eraser.click();
  await expect(page.getByRole("dialog", { name: "橡皮设置" })).toBeVisible();
  await page.screenshot({
    path: info.outputPath("apk-toolbar-eraser-settings.png"),
  });
});
test("green and black chalkboards use visible white ink and restore dark ink on white", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "新建白板", exact: true }),
  ).toBeEnabled();
  for (const [index, color] of ["#123d32", "#000000", "#ffffff"].entries()) {
    await page.getByTestId("main-menu-trigger").click();
    await page.getByTestId(`color-top-pick-${color}`).click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("t");
    await page.mouse.click(180 + index * 260, 200);
    const input = page.locator("textarea.excalidraw-wysiwyg");
    await input.fill(`板书 ${index + 1}`);
    await input.press("Escape");
    await expect
      .poll(() =>
        page.evaluate(
          (index) =>
            JSON.parse(localStorage.getItem("excalidraw") || "[]").find(
              (el: { text?: string }) => el.text === `板书 ${index + 1}`,
            )?.strokeColor,
          index,
        ),
      )
      .toBe(index < 2 ? "#ffffff" : "#1e1e1e");
    if (index === 1) {
      await page.screenshot({
        path: info.outputPath("blackboard-white-ink.png"),
      });
    }
  }
});

test("chalkboard background and white writing remain literal in a dark interface", async ({
  page,
}, info) => {
  await page.addInitScript(() =>
    localStorage.setItem("excalidraw-theme", "dark"),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "新建白板", exact: true }),
  ).toBeEnabled();
  await page.getByTestId("main-menu-trigger").click();
  await page.getByTestId("color-top-pick-#000000").click();
  await page.keyboard.press("Escape");
  await expect
    .poll(() =>
      page
        .locator("canvas.static")
        .evaluate((el) =>
          Array.from(
            (el as HTMLCanvasElement)
              .getContext("2d")!
              .getImageData(10, 10, 1, 1).data,
          ).slice(0, 3),
        ),
    )
    .toEqual([0, 0, 0]);
  await page.keyboard.press("t");
  await page.mouse.click(220, 180);
  const text = page.locator("textarea.excalidraw-wysiwyg");
  await text.fill("黑板上的白字");
  await expect(text).toHaveCSS("color", "rgb(255, 255, 255)");
  await text.press("Escape");
  await page.screenshot({
    path: info.outputPath("dark-interface-chalkboard.png"),
  });
});
