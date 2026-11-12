import path from "node:path";

import { expect, test } from "@playwright/test";

import { selectMenu } from "./menu";
import { installVoice, say, startVoice, voiceEndpoint } from "./voice";

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

test("new boards preserve previous work and offer the original teaching tools", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "新建白板", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("t");
  await page.mouse.click(200, 180);
  const editor = page.locator("textarea.fcboard-wysiwyg");
  await editor.fill("第一块白板");
  await editor.press("Escape");
  await page.getByRole("button", { name: "新建白板", exact: true }).click();
  await page.getByRole("button", { name: "切换白板", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "切换到 白板 1", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("button", { name: "切换到 白板 1", exact: true })
      .locator("img"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "切换到 白板 1", exact: true })
    .click();
  await page.getByRole("button", { name: "工具箱", exact: true }).click();
  await page.getByRole("button", { name: "尺规", exact: true }).click();
  for (const name of ["直尺", "量角器", "圆规", "三角板"]) {
    await expect(
      page.getByRole("button", { name: `插入${name}`, exact: true }),
    ).toBeVisible();
  }
  await expect(
    page.getByRole("button", { name: "打开计时器", exact: true }),
  ).toBeEnabled();
  for (const name of ["骰子", "随机抽取", "单摆", "抛体运动"]) {
    await expect(
      page.getByRole("button", { name: `插入${name}`, exact: true }),
    ).toHaveCount(0);
  }
  await page.getByRole("button", { name: "插入直尺", exact: true }).click();
  await expect(page.locator("[data-gizmo]")).toHaveCount(1);
  await expect(page.locator("[data-gizmo] rect").first()).toBeVisible();
  await expect(page.locator('[data-testid="library-button"]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("teaching-tools.png") });
});

test("continuous voice answers concepts and delegates real math, board writing and a quiz", async ({
  page,
}, info) => {
  await installVoice(page);
  let calculationObserved = false;
  let worker = 0;
  await page.route(voiceEndpoint, async (route) => {
    const body = route.request().postDataJSON();
    const system = String(body.messages[0].content);
    let result: unknown;
    if (system.startsWith("你是持续对话")) {
      result = String(body.messages.at(-1).content).startsWith("用白板")
        ? {
            action: "commands",
            commands: [
              {
                name: "agent.start",
                args: {
                  prompt: "核算3-1，演示x+1=3并出一道选择题",
                  role: "数学演示",
                },
              },
            ],
          }
        : { action: "text", text: "等式两边同时减去相同的数，等式仍然成立。" };
    } else if (system.includes("学科命题资料研究员")) {
      result = "依据教材核算：x+1=3，得到x=2。https://www.moe.gov.cn/";
    } else if (system.includes("跨学科命题Agent")) {
      result = {
        title: "一元一次方程练习",
        questions: [
          {
            type: "single",
            question: "x+1=3，x等于多少？",
            options: ["1", "2"],
            answer: ["B"],
            explanation: "两边减去1，得到x=2。",
          },
        ],
        sources: [{ title: "教育部", url: "https://www.moe.gov.cn/" }],
      };
    } else {
      expect(system).toContain("独立白板任务agent");
      worker++;
      if (worker === 1) {
        result = {
          action: "commands",
          commands: [{ name: "math.evaluate", args: { expression: "3-1" } }],
        };
      } else if (worker === 2) {
        calculationObserved = JSON.stringify(body.messages).includes(
          '\\"answer\\":\\"2\\"',
        );
        const explanation = "两边同时减去1，得到x=2。";
        result = {
          action: "commands",
          commands: [
            {
              name: "canvas.animate",
              args: {
                commands: [
                  {
                    type: "write_math",
                    id: "equation",
                    text: "x+1=3",
                    x: 0,
                    y: 0,
                    duration: 0,
                  },
                  {
                    type: "write_text",
                    id: "answer",
                    text: explanation,
                    x: 0,
                    y: 100,
                    duration: 0,
                  },
                ],
              },
            },
            { name: "agent.say", args: { text: explanation } },
            {
              name: "quiz.generate",
              args: { prompt: "出1道关于x+1=3的选择题" },
            },
          ],
        };
      } else {
        result = { action: "done" };
      }
    }
    await route.fulfill({
      json: {
        choices: [
          {
            message: {
              content:
                typeof result === "string" ? result : JSON.stringify(result),
            },
          },
        ],
      },
    });
  });
  await page.goto("/");
  await startVoice(page);
  await say(page, "解释一下等式为什么可以两边减去相同的数");
  await expect(page.locator(".fc-voice-caption")).toContainText("等式仍然成立");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("fcboard") || "[]").filter(
            (item: { isDeleted?: boolean }) => !item.isDeleted,
          ).length,
      ),
    )
    .toBe(0);
  await say(page, "用白板演示这个方程并出一道题");
  const quiz = page.frameLocator('iframe[title="一元一次方程练习"]');
  await expect(quiz.locator("h2")).toContainText("x+1=3");
  await quiz.locator("input").nth(0).check();
  await expect(quiz.locator(".verdict")).toHaveAttribute(
    "data-correct",
    "false",
  );
  await quiz.locator("input").nth(1).check();
  await expect(quiz.locator(".verdict")).toHaveAttribute(
    "data-correct",
    "true",
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("fcboard") || "[]").some(
          (item: { text?: string }) => item.text?.includes("两边同时减去1"),
        ),
      ),
    )
    .toBe(true);
  expect(calculationObserved).toBe(true);
  await expect(page.locator(".fc-teacher,.fc-agent-tasks")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("voice-math-quiz.png") });
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
  await expect(
    page.getByRole("toolbar", { name: "选区操作", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "展开图形", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.locator(".fc-document-ink path").count())
    .toBeGreaterThan(3);
  await page.keyboard.press("Escape");
  await page.mouse.click(20, 120);
  await expect(
    page.getByRole("button", { name: "课件语音指令", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() =>
    Reflect.get(window, "fcTestSpeechNext")("画y=a*x+1的函数图像"),
  );
  const graph = page.frameLocator("iframe[data-resource-object-id]").last();
  const slider = graph.getByRole("slider", { name: "调节 a", exact: true });
  await expect(slider).toBeVisible();
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue("1.1");
  await expect(graph.locator("#fc-vega .mark-line path").first()).toBeVisible();
  await expect(
    graph.getByRole("heading", { name: "y = a*x+1", exact: true }),
  ).toHaveCount(1);
  await page.screenshot({ path: info.outputPath("voice-ppt-function.png") });
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
