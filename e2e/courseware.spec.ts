import path from "node:path";

import { expect, test } from "@playwright/test";

import { selectMenu } from "./menu";
import { dictateQuestion } from "./question";

import type { Page } from "@playwright/test";

const fixture = (name: string) =>
  path.resolve("node_modules/.fcboard-research/courseware", name);
const openFile = async (page: Page, name: string) => {
  await selectMenu(page, "课件 / 局域网快传");
  await page
    .locator('.fc-panel input[type="file"]')
    .setInputFiles(fixture(name));
  await expect(page.getByRole("button", { name: "板书开关" })).toBeEnabled({
    timeout: 30000,
  });
  await expect(page.locator(".fc-document-status")).toHaveCount(0);
};
const ask = async (page: Page, text: string) => {
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
  await dictateQuestion(page, text);
};

for (const name of [
  "basic_test_ppt_file.ppt",
  "testPPT.pptx",
  "simple.doc",
  "SampleDoc.docx",
  "SimpleWithColours.xls",
  "SimpleMultiCell.xlsx",
  "helloworld.pdf",
]) {
  test(`locally renders real ${name}`, async ({ page }, info) => {
    await page.goto("/");
    await openFile(page, name);
    if (/pptx?$/.test(name)) {
      await expect(page.locator(".fc-slides svg").first()).toBeVisible();
      expect(await page.locator(".fc-slides").innerHTML()).toContain("<svg");
    } else {
      const body = page
        .frameLocator(".fc-document-stage iframe")
        .locator("body");
      await expect
        .poll(async () => (await body.innerText()).trim().length)
        .toBeGreaterThan(5);
    }
    const originalWidth = (await page
      .locator(".fc-document-stage")
      .boundingBox())!.width;
    await page.getByRole("button", { name: "放大课件", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "重置课件缩放", exact: true }),
    ).toHaveText("125%");
    expect(
      (await page.locator(".fc-document-stage").boundingBox())!.width,
    ).toBeGreaterThan(originalWidth);
    await page
      .getByRole("button", { name: "重置课件缩放", exact: true })
      .click();
    const visibleBar = page.getByRole("toolbar", { name: "课件工具栏" });
    await expect(visibleBar).toBeVisible();
    await expect(
      page.getByRole("toolbar", { name: "白板工具栏" }),
    ).toBeHidden();
    await page.screenshot({ path: info.outputPath(`${name}.png`) });
    await page.getByRole("button", { name: "关闭课件" }).click();
    await expect(
      page.getByRole("toolbar", { name: "白板工具栏" }),
    ).toBeVisible();
  });
}

test("transparent PPT ink survives closing, can be erased, and undo restores it", async ({
  page,
}, info) => {
  await page.goto("/");
  await openFile(page, "testPPT.pptx");
  await page.getByRole("button", { name: "板书开关" }).click();
  const layer = page.locator(".fc-document-ink");
  const box = (await layer.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3, {
    steps: 10,
  });
  await page.mouse.up();
  await expect(layer.locator("path")).toHaveCount(1);
  const original = (await layer.locator("path").getAttribute("d"))!.match(
    /-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi,
  )!;
  await page.getByRole("button", { name: "擦除板书", exact: true }).click();
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.3);
  await expect(layer.locator("path")).toHaveCount(2);
  const fragments = await layer
    .locator("path")
    .evaluateAll((nodes) =>
      nodes.map(
        (node) =>
          node.getAttribute("d")!.match(/-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)!,
      ),
    );
  expect(fragments[0].slice(0, 2)).toEqual(original.slice(0, 2));
  expect(fragments[1].slice(-2)).toEqual(original.slice(-2));
  await page.getByRole("button", { name: "撤销板书", exact: true }).click();
  await expect(layer.locator("path")).toHaveCount(1);
  await page.getByRole("button", { name: "关闭课件" }).click();
  await openFile(page, "testPPT.pptx");
  await expect(layer.locator("path")).toHaveCount(1);
  await page.screenshot({ path: info.outputPath("ppt-transparent-ink.png") });
});

test("new boards preserve previous work and replace the old material library with working tools", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "新建白板", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("t");
  await page.mouse.click(200, 180);
  const editor = page.locator("textarea.excalidraw-wysiwyg");
  await editor.fill("第一块白板");
  await editor.press("Escape");
  await page.getByRole("button", { name: "新建白板", exact: true }).click();
  await page.getByRole("button", { name: "切换白板", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "切换到 白板 1", exact: true }),
  ).toContainText("第一块白板");
  await page
    .getByRole("button", { name: "切换到 白板 1", exact: true })
    .click();
  await page.getByRole("button", { name: "教学工具", exact: true }).click();
  await page.getByRole("button", { name: "插入单摆", exact: true }).click();
  const length = page.getByRole("slider", { name: "摆长 L（m）", exact: true });
  await expect(length).toBeVisible();
  await length.focus();
  await length.press("ArrowRight");
  await expect(length).toHaveValue("1.6");
  await page.getByRole("button", { name: "播放工具", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "暂停工具", exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-testid="library-button"]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("teaching-tools.png") });
});

test("live teacher writes real math, pauses and completes a quiz on the shared canvas", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "fcboard-settings",
      JSON.stringify({ apiKey: "test-only", model: "test", autoMath: false }),
    );
    localStorage.setItem(
      "fcboard-teaching",
      JSON.stringify({ lens: "captions", speed: 1 }),
    );
  });
  let imageSent = false;
  let requests = 0;
  let calculationObserved = false;
  await page.route(
    "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    async (route) => {
      const body = route.request().postDataJSON();
      imageSent ||= JSON.stringify(body).includes("data:image/png;base64,");
      requests++;
      if (requests === 1) {
        await route.fulfill({
          json: {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    action: "commands",
                    commands: [
                      { name: "canvas.inspect" },
                      { name: "math.evaluate", args: { expression: "3-1" } },
                    ],
                  }),
                },
              },
            ],
          },
        });
        return;
      }
      calculationObserved =
        typeof body.messages?.at(-1)?.content === "string" &&
        body.messages.at(-1).content.includes('"answer":"2"');
      await route.fulfill({
        json: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "一元一次方程",
                  steps: [
                    {
                      say: "把等式两边同时减去一，再观察未知数。",
                      commands: [
                        {
                          type: "write_math",
                          id: "equation",
                          x: 0,
                          y: 0,
                          text: "x+1=3",
                          duration: 1,
                        },
                        {
                          type: "write_text",
                          id: "answer",
                          x: 0,
                          y: 100,
                          text: "两边同时减去1",
                          duration: 0.4,
                        },
                      ],
                    },
                  ],
                  quiz: [
                    {
                      question: "x 等于多少？",
                      choices: ["1", "2"],
                      answer: 1,
                      explanation: "两边减去1，得到x=2。",
                    },
                  ],
                }),
              },
            },
          ],
        },
      });
    },
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "新建白板", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("t");
  await page.mouse.click(180, 160);
  const editor = page.locator("textarea.excalidraw-wysiwyg");
  await editor.fill("题目：x+1=3");
  await editor.press("Escape");
  await ask(page, "请讲解一元一次方程");
  await expect(
    page.getByRole("button", { name: "暂停讲解", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "暂停讲解", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "继续讲解", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "继续讲解", exact: true }).click();
  await page.getByRole("button", { name: "A · 1", exact: true }).click();
  await expect(page.getByText("再想一想。", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "B · 2", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重播讲解", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("excalidraw") || "[]").some(
          (element: { type: string; text?: string }) =>
            element.type === "text" && element.text === "两边同时减去1",
        ),
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("excalidraw") || "[]").some(
          (element: { type: string; opacity?: number }) =>
            element.type === "image" && element.opacity === 100,
        ),
      ),
    )
    .toBe(true);
  expect(imageSent).toBe(true);
  expect(requests).toBe(2);
  expect(calculationObserved).toBe(true);
  await page.screenshot({ path: info.outputPath("live-teacher-quiz.png") });
});

test("voice uses the same component actions to create a new board without a model", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "fcboard-settings",
      JSON.stringify({ speech: "system", autoMath: false }),
    );
    class Recognition {
      onresult?: (event: unknown) => void;
      start() {
        setTimeout(
          () =>
            this.onresult?.({
              resultIndex: 0,
              results: [{ isFinal: true, 0: { transcript: "新建白板" } }],
            }),
          300,
        );
      }
      stop() {}
    }
    Object.assign(window, { SpeechRecognition: Recognition });
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "新建白板", exact: true }),
  ).toBeEnabled();
  await selectMenu(page, "语音指令");
  await page.getByRole("button", { name: "切换白板", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "切换到 白板 2", exact: true }),
  ).toBeVisible();
});

test("voice draws into the visible PPT and function controls update its transparent layer", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "fcboard-settings",
      JSON.stringify({ speech: "system", autoMath: false }),
    );
    class Recognition {
      onresult?: (event: unknown) => void;
      emit(text: string) {
        this.onresult?.({
          resultIndex: 0,
          results: [{ isFinal: true, 0: { transcript: text } }],
        });
      }
      start() {
        Reflect.set(window, "fcTestSpeechNext", (text: string) =>
          this.emit(text),
        );
        setTimeout(() => this.emit("帮我画个立方体"), 300);
      }
      stop() {
        Reflect.deleteProperty(window, "fcTestSpeechNext");
      }
    }
    Object.assign(window, { SpeechRecognition: Recognition });
  });
  await page.goto("/");
  await openFile(page, "testPPT.pptx");
  await page.getByRole("button", { name: "课件语音指令", exact: true }).click();
  await page.getByRole("button", { name: "旋转图形", exact: true }).click();
  await expect(
    page.getByRole("slider", { name: "旋转", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.locator(".fc-document-ink path").count())
    .toBeGreaterThan(3);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "收起工具参数" }).click();
  await expect(
    page.getByRole("button", { name: "课件语音指令", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() =>
    Reflect.get(window, "fcTestSpeechNext")("画y=a*x+1的函数图像"),
  );
  const slider = page.getByRole("slider", { name: "调节 a", exact: true });
  await expect(slider).toBeVisible();
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue("1.1");
  const panelBounds = (await page.locator(".fc-panel").boundingBox())!;
  const curveBounds = (await page
    .locator(".fc-document-ink path")
    .last()
    .boundingBox())!;
  expect(panelBounds.x).toBeGreaterThan(curveBounds.x + curveBounds.width);
  await expect(
    page.locator(".fc-document-ink text").filter({ hasText: "x+1" }),
  ).toHaveCount(1);
  await page.screenshot({ path: info.outputPath("voice-ppt-function.png") });
  await page.getByRole("button", { name: "关闭工具浮层", exact: true }).click();
  await page.evaluate(() =>
    Reflect.get(window, "fcTestSpeechNext")("写一个1+1=2"),
  );
  const written = page
    .locator(".fc-document-ink text")
    .filter({ hasText: "1+1=2" });
  await expect(written).toBeVisible();
  const writingBounds = (await written.boundingBox())!;
  const visible = page.viewportSize()!;
  expect(writingBounds.x).toBeGreaterThanOrEqual(0);
  expect(writingBounds.y).toBeGreaterThanOrEqual(0);
  expect(writingBounds.x + writingBounds.width).toBeLessThanOrEqual(
    visible.width,
  );
  expect(writingBounds.y + writingBounds.height).toBeLessThanOrEqual(
    visible.height,
  );
  await page.screenshot({ path: info.outputPath("voice-ppt-writing.png") });
  await expect(
    page.getByRole("button", { name: "课件语音指令", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "课件语音指令", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "课件语音指令", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
});
