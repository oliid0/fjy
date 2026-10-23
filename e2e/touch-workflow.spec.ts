import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { openSettingsMenu, selectMenu } from "./menu";

import type { Page } from "@playwright/test";

const setBackground = async (page: Page, color: string) => {
  await openSettingsMenu(page);
  await page
    .locator('.fc-board-settings input[type="color"]')
    .evaluate((input, value) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, color);
  await page
    .getByRole("dialog", { name: "白板设置", exact: true })
    .press("Escape");
};

test("displayed handwriting can be dragged and lasso-selected at its visible bend", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "画笔", exact: true }).click();
  await page.mouse.move(100, 200);
  await page.mouse.down();
  await page.mouse.move(200, 400);
  await page.mouse.move(300, 200);
  await page.mouse.up();
  const strokes = () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem("excalidraw") || "[]").filter(
        (element: { type: string; isDeleted?: boolean }) =>
          element.type === "freedraw" && !element.isDeleted,
      ),
    );
  await expect.poll(async () => (await strokes()).length).toBe(1);
  await page.keyboard.press("v");
  await page.mouse.move(200, 350);
  await page.mouse.down();
  await page.mouse.move(240, 350, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await strokes())[0].x).toBe(140);
  await page.getByTestId("button-undo").click();
  await expect.poll(async () => (await strokes())[0].x).toBe(100);
  await page.mouse.click(80, 80);
  await page.getByRole("button", { name: "选择", exact: true }).click();
  await page.mouse.move(180, 340);
  await page.mouse.down();
  for (const [x, y] of [
    [220, 340],
    [220, 360],
    [180, 360],
    [180, 340],
  ]) {
    await page.mouse.move(x, y, { steps: 2 });
  }
  await page.mouse.up();
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await strokes()).length).toBe(0);
});

test("a small eraser cuts the displayed bend rather than the raw handwriting samples", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "画笔", exact: true }).click();
  await page.mouse.move(100, 200);
  await page.mouse.down();
  await page.mouse.move(200, 400);
  await page.mouse.move(300, 200);
  await page.mouse.up();
  const pixel = (x: number, y: number) =>
    page.evaluate(
      ({ x, y }) => {
        const canvas =
          document.querySelector<HTMLCanvasElement>("canvas.static")!;
        const scale = canvas.width / canvas.getBoundingClientRect().width;
        return Array.from(
          canvas.getContext("2d")!.getImageData(x * scale, y * scale, 1, 1)
            .data,
        );
      },
      { x, y },
    );
  await expect.poll(async () => (await pixel(200, 350))[0]).toBeLessThan(100);
  const left = await pixel(150, 300);
  const eraser = page.getByRole("button", { name: "橡皮", exact: true });
  await eraser.click();
  await eraser.click();
  await page.getByText("触控与橡皮设置", { exact: true }).click();
  const size = page.getByRole("slider", { name: /^橡皮大小/ });
  await size.press("Home");
  await expect(size).toHaveValue("12");
  await page.keyboard.press("Escape");
  await expect(eraser).toHaveClass(/ToolIcon--selected/);
  await page.mouse.click(200, 350);
  await expect.poll(() => pixel(200, 350)).toEqual([255, 255, 255, 255]);
  expect(await pixel(150, 300)).toEqual(left);
  await page.getByTestId("button-undo").click();
  await expect.poll(async () => (await pixel(200, 350))[0]).toBeLessThan(100);
});

test("rainbow ink preserves its actual colors across erasure, undo and zoom", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  const pen = page.getByRole("button", { name: "画笔", exact: true });
  await pen.click();
  await pen.click();
  await page.getByRole("button", { name: "彩虹笔", exact: true }).click();
  await pen.click();
  const thickness = page.getByRole("slider", { name: "书写粗细", exact: true });
  await thickness.press("Home");
  for (let i = 0; i < 10; i++) {
    await thickness.press("ArrowRight");
  }
  await expect(thickness).toHaveValue("12");
  await page.getByRole("button", { name: "关闭属性", exact: true }).click();
  await page.mouse.move(100, 200);
  await page.mouse.down();
  await page.mouse.move(1100, 200, { steps: 24 });
  await page.mouse.up();
  const pixels = () =>
    page.evaluate(() => {
      const canvas =
        document.querySelector<HTMLCanvasElement>("canvas.static")!;
      const context = canvas.getContext("2d")!;
      const state = JSON.parse(
        localStorage.getItem("excalidraw-state") || "{}",
      );
      const scale = canvas.width / canvas.getBoundingClientRect().width;
      const zoom = state.zoom?.value ?? 1;
      return [200, 640, 1000].map((x) =>
        Array.from(
          context.getImageData(
            Math.round((x + (state.scrollX || 0)) * zoom * scale),
            Math.round((200 + (state.scrollY || 0)) * zoom * scale),
            1,
            1,
          ).data,
        ),
      );
    });
  await expect
    .poll(async () =>
      (
        await pixels()
      ).every(
        (rgba) =>
          Math.max(...rgba.slice(0, 3)) - Math.min(...rgba.slice(0, 3)) > 40,
      ),
    )
    .toBe(true);
  const before = await pixels();
  expect(before[0]).not.toEqual(before[1]);
  expect(before[1]).not.toEqual(before[2]);
  await page.getByRole("button", { name: "橡皮", exact: true }).click();
  await page.mouse.move(640, 160);
  await page.mouse.down();
  await page.mouse.move(640, 240, { steps: 4 });
  await page.mouse.up();
  const cut = [before[0], [255, 255, 255, 255], before[2]];
  await expect.poll(pixels).toEqual(cut);
  await page.getByTestId("button-undo").click();
  await expect.poll(pixels).toEqual(before);
  await page.getByTestId("button-redo").click();
  await expect.poll(pixels).toEqual(cut);
  await page.keyboard.press("Shift+Equal");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("excalidraw-state") || "{}").zoom
            ?.value || 1,
      ),
    )
    .toBeGreaterThan(1);
  // Pixel centers shift by a fraction of a scene unit at a new zoom.
  await expect
    .poll(async () =>
      Math.max(
        ...(
          await pixels()
        ).flatMap((rgba, i) =>
          rgba.map((channel, j) => Math.abs(channel - cut[i][j])),
        ),
      ),
    )
    .toBeLessThanOrEqual(2);
  await page.screenshot({
    path: info.outputPath("rainbow-ink-erased-zoomed.png"),
  });
});

test("the existing share menu exports the chosen saved page as an actual PNG", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "新建白板", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("t");
  await page.mouse.click(200, 200);
  await page.locator("textarea.excalidraw-wysiwyg").fill("分享的第一页");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "新建白板", exact: true }).click();
  await selectMenu(page, "扫码分享");
  const share = page.getByRole("dialog", { name: "分享白板", exact: true });
  await share.getByRole("checkbox", { name: /第 2 页/ }).uncheck();
  await share.getByRole("checkbox", { name: /第 1 页/ }).check();
  const downloaded = page.waitForEvent("download");
  await share.getByRole("button", { name: "下载选中页面" }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe("Fcboard-1.png");
  const data = await readFile((await file.path())!);
  expect(Array.from(data.subarray(0, 8))).toEqual([
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);
  await share.getByRole("button", { name: "关闭分享" }).click();
  await expect(share).toHaveCount(0);
});

test("two touchscreen contacts write and undo independently in multi-point mode", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "画笔", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "多点书写", exact: true }),
  ).toBeVisible();
  const input = await page.context().newCDPSession(page);
  const contacts = (x: number) => [
    { id: 1, x, y: 200, radiusX: 2, radiusY: 2 },
    { id: 2, x, y: 350, radiusX: 2, radiusY: 2 },
  ];
  await input.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: contacts(200),
  });
  await input.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: contacts(500),
  });
  await input.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  const strokes = () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem("excalidraw") || "[]").filter(
        (el: { type: string; isDeleted: boolean }) =>
          el.type === "freedraw" && !el.isDeleted,
      ),
    );
  await expect.poll(async () => (await strokes()).length).toBe(2);
  expect(
    (await strokes()).every((el: { width: number }) => el.width > 250),
  ).toBe(true);
  await page.getByTestId("button-undo").click();
  await expect.poll(async () => (await strokes()).length).toBe(1);
  await page.getByTestId("button-undo").click();
  await expect.poll(async () => (await strokes()).length).toBe(0);
  await page.getByTestId("button-redo").click();
  await expect.poll(async () => (await strokes()).length).toBe(1);
  await page.getByTestId("button-redo").click();
  await expect.poll(async () => (await strokes()).length).toBe(2);
  const geometry = JSON.stringify(await strokes());
  const zoom = () =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("excalidraw-state") || "{}").zoom
          .value as number,
    );
  const beforeZoom = await zoom();
  await page.keyboard.press("v");
  await input.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { id: 1, x: 400, y: 400 },
      { id: 2, x: 600, y: 400 },
    ],
  });
  await input.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { id: 1, x: 300, y: 400 },
      { id: 2, x: 700, y: 400 },
    ],
  });
  await input.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect.poll(zoom).toBeGreaterThan(beforeZoom * 1.5);
  expect(JSON.stringify(await strokes())).toBe(geometry);
  await input.detach();
});

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
  await page.getByRole("button", { name: "图形", exact: true }).click();
  await expect(page.getByTestId("toolbar-rectangle")).toBeVisible();
  await page.keyboard.press("Escape");
  const eraser = toolbar.getByRole("button", { name: "橡皮", exact: true });
  await eraser.click();
  await eraser.click();
  await expect(page.getByRole("dialog", { name: "橡皮设置" })).toBeVisible();
  await page.screenshot({
    path: info.outputPath("apk-toolbar-eraser-settings.png"),
  });
  await page.keyboard.press("Escape");
  const menu = page.getByTestId("main-menu-trigger");
  const initial = (await menu.boundingBox())!;
  await toolbar.getByRole("button", { name: "切换", exact: true }).click();
  expect((await menu.boundingBox())!.x).toBeGreaterThan(initial.x + 500);
  await toolbar
    .getByRole("button", { name: "隐藏工具栏", exact: true })
    .click();
  await expect(menu).toBeHidden();
  await toolbar
    .getByRole("button", { name: "显示工具栏", exact: true })
    .click();
  await expect(menu).toBeVisible();
  await toolbar.getByRole("button", { name: "教学工具", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "教学工具", exact: true }),
  ).toBeVisible();
  await toolbar
    .getByRole("button", { name: "隐藏工具栏", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "教学工具", exact: true }),
  ).toHaveCount(0);
  await toolbar
    .getByRole("button", { name: "显示工具栏", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "教学工具", exact: true }),
  ).toHaveCount(0);
  await pen.click();
  await pen.click();
  await expect(
    page.getByRole("dialog", { name: "画笔与对象属性" }),
  ).toBeVisible();
  await toolbar
    .getByRole("button", { name: "隐藏工具栏", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "画笔与对象属性" }),
  ).toHaveCount(0);
  await toolbar
    .getByRole("button", { name: "显示工具栏", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "画笔与对象属性" }),
  ).toHaveCount(0);
});
test("green and black chalkboards use visible white ink and restore dark ink on white", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "新建白板", exact: true }),
  ).toBeEnabled();
  for (const [index, color] of ["#123d32", "#000000", "#ffffff"].entries()) {
    await setBackground(page, color);
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
  await setBackground(page, "#000000");
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
