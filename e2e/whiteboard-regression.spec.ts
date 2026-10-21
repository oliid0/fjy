import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { selectMenu } from "./menu";

import type { Page } from "@playwright/test";

type Element = {
  id: string;
  type: string;
  isDeleted?: boolean;
  x: number;
  text?: string;
  groupIds?: string[];
};
const elements = (page: Page) =>
  page.evaluate(() =>
    (
      JSON.parse(localStorage.getItem("excalidraw") || "[]") as Element[]
    ).filter((element) => !element.isDeleted),
  );
const ready = async (page: Page) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, "showOpenFilePicker");
    Reflect.deleteProperty(window, "showSaveFilePicker");
    localStorage.setItem(
      "fcboard-settings",
      JSON.stringify({ autoMath: false }),
    );
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "新建白板", exact: true }),
  ).toBeEnabled();
};
const rectangle = async (page: Page) => {
  await page.keyboard.press("r");
  await page.mouse.move(180, 160);
  await page.mouse.down();
  await page.mouse.move(380, 300, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await elements(page)).filter((element) => element.type === "rectangle")
          .length,
    )
    .toBe(1);
};

test("original selection, moving, duplication, deletion, history and zoom remain functional", async ({
  page,
}, info) => {
  await ready(page);
  await rectangle(page);
  const original = (await elements(page))[0];
  await page.keyboard.press("v");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => (await elements(page))[0].x)
    .toBeGreaterThan(original.x);
  await page.keyboard.press("Control+d");
  await expect.poll(async () => (await elements(page)).length).toBe(2);
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await elements(page)).length).toBe(1);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect.poll(async () => (await elements(page)).length).toBe(2);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect.poll(async () => (await elements(page)).length).toBe(1);
  await page.getByRole("button", { name: "插入", exact: true }).click();
  await page.getByRole("button", { name: "图形", exact: true }).click();
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重置缩放", exact: true }),
  ).not.toHaveText("100%");
  await page.getByRole("button", { name: "重置缩放", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重置缩放", exact: true }),
  ).toHaveText("100%");
  await page.screenshot({ path: info.outputPath("native-edit-history.png") });
});

test("original image insertion and editable scene export/import preserve binary assets", async ({
  page,
}, info) => {
  await ready(page);
  await rectangle(page);
  const choosingImage = page.waitForEvent("filechooser");
  await page.keyboard.press("9");
  await (await choosingImage).setFiles("public/favicon-32x32.png");
  await page.mouse.click(500, 250);
  await expect
    .poll(async () =>
      (await elements(page)).some((element) => element.type === "image"),
    )
    .toBe(true);
  const saving = page.waitForEvent("download");
  await page.keyboard.press("Control+Shift+s");
  const download = await saving;
  const filePath = info.outputPath("native-scene.excalidraw");
  await download.saveAs(filePath);
  const saved = JSON.parse(await readFile(filePath, "utf8"));
  expect(saved.type).toBe("excalidraw");
  expect(
    saved.elements.some((element: Element) => element.type === "image"),
  ).toBe(true);
  expect(Object.keys(saved.files).length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "新建白板", exact: true }).click();
  await expect.poll(async () => (await elements(page)).length).toBe(0);
  const choosingScene = page.waitForEvent("filechooser");
  await page.keyboard.press("Control+o");
  await (await choosingScene).setFiles(filePath);
  await expect
    .poll(async () =>
      (await elements(page)).some((element) => element.type === "image"),
    )
    .toBe(true);
  await expect
    .poll(async () =>
      (await elements(page)).some((element) => element.type === "rectangle"),
    )
    .toBe(true);
  await page.screenshot({ path: info.outputPath("native-file-roundtrip.png") });
});

test("original PNG and SVG export still produce usable images", async ({
  page,
}, info) => {
  await ready(page);
  await rectangle(page);
  await page.getByTestId("main-menu-trigger").click();
  await page.getByText("导出图片...", { exact: true }).click();
  for (const [name, extension] of [
    ["导出为 PNG", "png"],
    ["导出为 SVG", "svg"],
  ]) {
    const saving = page.waitForEvent("download");
    await page.getByRole("button", { name, exact: true }).click();
    const download = await saving;
    const output = info.outputPath(`native-export.${extension}`);
    await download.saveAs(output);
    const bytes = await readFile(output);
    expect(bytes.length).toBeGreaterThan(100);
    if (extension === "png") {
      expect(Array.from(bytes.subarray(0, 8))).toEqual([
        137, 80, 78, 71, 13, 10, 26, 10,
      ]);
    } else {
      expect(bytes.toString("utf8")).toContain("<svg");
    }
  }
});

test("AI style commands update selected text and the next insertion through original editor actions", async ({
  page,
}) => {
  await ready(page);
  await page.evaluate(() =>
    localStorage.setItem(
      "fcboard-settings",
      JSON.stringify({ apiKey: "test-only", model: "test", autoMath: false }),
    ),
  );
  await page.route(
    "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    (route) =>
      route.fulfill({
        json: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: "commands",
                  commands: [
                    {
                      name: "canvas.style",
                      args: {
                        fontSize: 40,
                        color: "#dc2626",
                        textAlign: "center",
                      },
                    },
                    { name: "canvas.text", args: { text: "已统一样式" } },
                  ],
                }),
              },
            },
          ],
        },
      }),
  );
  await page.keyboard.press("t");
  await page.mouse.click(200, 180);
  const editor = page.locator("textarea.excalidraw-wysiwyg");
  await editor.fill("课程笔记");
  await editor.press("Escape");
  await page.keyboard.press("v");
  await page.keyboard.press("Control+a");
  if (
    await page
      .getByRole("button", { name: "课件 AI 教师", exact: true })
      .isVisible()
  ) {
    await page
      .getByRole("button", { name: "课件 AI 教师", exact: true })
      .click();
  } else {
    await selectMenu(page, "提问与讲解");
  }
  await page
    .getByRole("textbox", { name: "向 AI 教师提问" })
    .fill("把选中的字设为40号红色居中，再写已统一样式");
  await page.getByRole("button", { name: "发送问题" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const text = JSON.parse(
          localStorage.getItem("excalidraw") || "[]",
        ).filter(
          (element: { type: string; isDeleted?: boolean }) =>
            element.type === "text" && !element.isDeleted,
        );
        return (
          text.length === 2 &&
          text.every(
            (element: {
              fontSize: number;
              strokeColor: string;
              textAlign: string;
            }) =>
              element.fontSize === 40 &&
              element.strokeColor === "#dc2626" &&
              element.textAlign === "center",
          )
        );
      }),
    )
    .toBe(true);
});
