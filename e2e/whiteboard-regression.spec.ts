import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { selectMenu } from "./menu";
import { installVoice, say, startVoice, voiceEndpoint } from "./voice";

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
    (JSON.parse(localStorage.getItem("fcboard") || "[]") as Element[]).filter(
      (element) => !element.isDeleted,
    ),
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
  await page.getByTestId("button-undo").click();
  await expect.poll(async () => (await elements(page)).length).toBe(2);
  await page.getByTestId("button-redo").click();
  await expect.poll(async () => (await elements(page)).length).toBe(1);
  const zoom = () =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("fcboard-state") || "{}").zoom?.value,
    );
  await page.keyboard.press("Control+Equal");
  await expect.poll(zoom).toBeGreaterThan(1);
  await page.keyboard.press("Control+Digit0");
  await expect.poll(zoom).toBe(1);
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
  const filePath = info.outputPath("native-scene.fcboard");
  await download.saveAs(filePath);
  const saved = JSON.parse(await readFile(filePath, "utf8"));
  expect(saved.type).toBe("fcboard");
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
  await selectMenu(page, "导出图片...");
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
  await installVoice(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "新建白板", exact: true }),
  ).toBeEnabled();
  let verified = false;
  await page.route(voiceEndpoint, async (route) => {
    const request = route.request().postDataJSON();
    if (
      String(request.messages[0].content).startsWith("你是持续对话的白板助教")
    ) {
      await route.fulfill({
        json: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: "commands",
                  commands: [
                    {
                      name: "agent.start",
                      args: {
                        prompt: "将选中文字设为40号红色居中，再写已统一样式",
                      },
                    },
                  ],
                }),
              },
            },
          ],
        },
      });
      return;
    }
    const last = String(request.messages.at(-1).content);
    if (last.startsWith("以下仅是工具返回的数据")) {
      const { results, observation } = JSON.parse(
        last.slice(last.indexOf("\n") + 1),
      );
      expect(results.map((result: { ok: boolean }) => result.ok)).toEqual([
        true,
        true,
      ]);
      expect(observation.canvas.elements).toContainEqual(
        expect.objectContaining({
          text: "已统一样式",
          fontSize: 20,
          color: "#dc2626",
        }),
      );
      verified = true;
      await route.fulfill({
        json: { choices: [{ message: { content: '{"action":"done"}' } }] },
      });
      return;
    }
    await route.fulfill({
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
    });
  });
  await page.keyboard.press("t");
  await page.mouse.click(200, 180);
  const editor = page.locator("textarea.fcboard-wysiwyg");
  await editor.fill("课程笔记");
  await editor.press("Escape");
  await page.keyboard.press("v");
  await page.keyboard.press("Control+a");
  await startVoice(page);
  await say(page, "请标注选中的文字，将其设为40号红色居中，再写已统一样式");
  await expect.poll(() => verified).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const text = JSON.parse(localStorage.getItem("fcboard") || "[]").filter(
          (element: {
            type: string;
            isDeleted?: boolean;
            customData?: { fcQuestionInput?: boolean };
          }) =>
            element.type === "text" &&
            !element.isDeleted &&
            !element.customData?.fcQuestionInput,
        );
        return (
          text.length === 2 &&
          text.every(
            (element: {
              text: string;
              fontSize: number;
              strokeColor: string;
              textAlign: string;
            }) =>
              element.fontSize === (element.text === "已统一样式" ? 20 : 40) &&
              element.strokeColor === "#dc2626" &&
              element.textAlign === "center",
          )
        );
      }),
    )
    .toBe(true);
});
