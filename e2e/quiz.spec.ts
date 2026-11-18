import { expect, test } from "@playwright/test";

import { submitQuiz } from "./quiz";

const endpoint = "https://quiz-test.example/v1/chat/completions";
const sources = [{ title: "教育部", url: "https://www.moe.gov.cn/" }];
const cart = `<html><head><title>小车受力示意图</title></head><body>
<div id="board" data-fc-graphics style="width:600px;height:340px"></div><script>
var b=JXG.JSXGraph.initBoard('board',{renderer:'svg',boundingbox:[0,5,8,0],showNavigation:false,showCopyright:false,resize:{enabled:false}});
b.create('polygon',[[1,1],[4,1],[4,3],[1,3]],{vertices:{visible:false,withLabel:false},fillColor:'#fff',fillOpacity:1,borders:{strokeColor:'#000',strokeWidth:2}});
b.create('arrow',[[4,2],[7,2]],{strokeColor:'#000',strokeWidth:3});
b.create('text',[1.4,2,'m = 2 kg'],{fontSize:20});b.create('text',[4.6,2.7,'F = 4 N'],{fontSize:20});
document.dispatchEvent(new Event('fc-figure-ready'));</script></body></html>`;
const drawing = (html = cart) => ({
  title: "小车受力示意图",
  libraries: ["jsxgraph"],
  html,
});
const question = (index: number) =>
  index % 2 === 0
    ? {
        type: "single",
        question: `第${index + 1}题：物体不受合力时将如何运动？`,
        options: ["保持静止或匀速直线运动", "一定静止", "一直加速"],
        answer: ["A"],
        explanation: "运动状态保持不变。",
        needsImage: false,
      }
    : {
        type: "calculation",
        question: `第${
          index + 1
        }题：如图，小车质量$m=2\\,\\mathrm{kg}$，合力$F=4\\,\\mathrm{N}$，求加速度。`,
        answer: ["$a=2\\,\\mathrm{m/s^2}$"],
        explanation: "加速度沿合力方向。",
        steps: [
          "由牛顿第二定律$F=ma$",
          "代入$a=\\frac{F}{m}=\\frac{4}{2}=2\\,\\mathrm{m/s^2}$",
        ],
        needsImage: true,
        imageMethod: "draw",
        imagePrompt:
          "Cart m=2kg, horizontal force arrow to right F=4N; no acceleration/answer label",
        imageCaption: "小车受力示意图",
      };

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 3080, height: 1240 },
  { width: 390, height: 844 },
]) {
  test(`quiz composer publishes text before real engine figures, grades and preserves answers at ${viewport.width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(
      (endpoint) =>
        localStorage.setItem(
          "fcboard-settings",
          JSON.stringify({
            endpoint,
            apiKey: "test-only",
            model: "test",
            textModel: "test",
            autoMath: false,
          }),
        ),
      endpoint,
    );
    let releaseText!: () => void;
    let releaseDrawings!: () => void;
    const textGate = new Promise<void>((resolve) => {
      releaseText = resolve;
    });
    const drawingGate = new Promise<void>((resolve) => {
      releaseDrawings = resolve;
    });
    let searched = false;
    let verifiedPictures = 0;
    await page.route(endpoint, async (route) => {
      const body = route.request().postDataJSON();
      const system = String(body.messages[0].content);
      let result: unknown;
      if (
        system.startsWith("Research original quiz design using real web search")
      ) {
        searched =
          body.web_search_options !== undefined ||
          body.tools?.some(
            (tool: { type: string; function?: { name: string } }) =>
              tool.type === "web_search" ||
              tool.function?.name === "web_search",
          );
        result = {
          title: "牛顿定律课堂练习",
          tasks: Array.from({ length: 10 }, (_, index) => ({
            type: index % 2 ? "calculation" : "single",
            focus: `独立牛顿定律任务${index + 1}`,
          })),
          sources,
        };
      } else if (
        system.startsWith("Generate ONE original independent quiz question")
      ) {
        const content = body.messages[1].content;
        const text =
          typeof content === "string"
            ? content
            : content.find((part: { type: string }) => part.type === "text")
                .text;
        const index = JSON.parse(text).task - 1;
        if (index > 0) {
          await textGate;
        }
        result = question(index);
      } else if (
        system.startsWith("Create only the accurate textbook figure")
      ) {
        await drawingGate;
        result = drawing();
      } else {
        expect(system).toContain(
          "Check an actual generated educational illustration",
        );
        const dataURL = body.messages[1].content.find(
          (part: { type: string }) => part.type === "image_url",
        ).image_url.url as string;
        expect(dataURL).toMatch(/^data:image\/png;base64,/);
        const png = Buffer.from(dataURL.split(",")[1], "base64");
        expect([...png.subarray(0, 8)]).toEqual([
          137, 80, 78, 71, 13, 10, 26, 10,
        ]);
        expect(png.readUInt32BE(16)).toBeGreaterThan(20);
        expect(png.readUInt32BE(16)).toBeLessThanOrEqual(1440);
        expect(png.readUInt32BE(20)).toBeLessThanOrEqual(920);
        verifiedPictures++;
        if (verifiedPictures === 1) {
          await info.attach("actual-jsxgraph-figure", {
            body: png,
            contentType: "image/png",
          });
        }
        result = { valid: true, issues: "" };
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
    try {
      await page.goto("/");
      await submitQuiz(
        page,
        "出10道初中物理关于牛顿定律的选择题和计算题，图示使用 JSXGraph 绘制。",
      );
      const panel = page.locator(".fc-quiz-panel");
      await expect(panel).toBeVisible();
      const frame = page.frameLocator('iframe[title="牛顿定律课堂练习"]');
      await expect(frame.locator("article.card")).toHaveCount(10);
      await expect(
        frame.locator('article.card[data-ready="true"]'),
      ).toHaveCount(1);
      expect(searched).toBe(true);
      const first = frame.locator("article.card").first();
      await first.locator("input").nth(1).check();
      await expect(first.locator(".verdict")).toHaveAttribute(
        "data-correct",
        "false",
      );
      await first.locator("input").nth(0).check();
      await expect(first.locator(".verdict")).toHaveAttribute(
        "data-correct",
        "true",
      );
      await frame.locator("#next").click();
      await expect(frame.locator("#page")).toHaveText("2 / 10");
      await expect(
        frame.locator("article.card").nth(1).locator('[role="status"]'),
      ).toContainText("正在生成这道题");
      releaseText();
      await expect(
        frame.locator('article.card[data-ready="true"]'),
      ).toHaveCount(10);
      const calculation = frame
        .locator('article.card[data-type="calculation"]')
        .first();
      const index = Number(await calculation.getAttribute("data-index"));
      for (let step = 1; step < index; step++) {
        await frame.locator("#next").click();
      }
      await expect(frame.locator("#page")).toHaveText(`${index + 1} / 10`);
      await expect(
        calculation.locator(".quiz-image [role='status']"),
      ).toBeVisible();
      await calculation.locator(".answer > summary").click();
      await expect(calculation.locator(".steps li")).toHaveCount(2);
      releaseDrawings();
      await expect(frame.locator(".quiz-image img")).toHaveCount(5);
      await expect.poll(() => verifiedPictures).toBe(5);
      await expect
        .poll(() =>
          calculation
            .locator(".quiz-image img")
            .evaluate((node: HTMLImageElement) => node.naturalWidth),
        )
        .toBeGreaterThan(0);
      await expect(calculation.locator("h2 img.formula").first()).toBeVisible();
      await expect(calculation.locator(".problem")).toHaveCSS(
        "overflow-y",
        "auto",
      );
      await expect(calculation.locator(".solution")).toHaveCSS(
        "overflow-y",
        "auto",
      );
      await expect(page.locator('iframe[title="小车受力示意图"]')).toHaveCount(
        0,
      );
      for (let step = index; step > 0; step--) {
        await frame.locator("#prev").click();
      }
      await expect(first.locator("input").nth(0)).toBeChecked();
      const box = (await panel.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      await panel.getByRole("button", { name: "关闭", exact: true }).click();
      await expect(panel).toBeHidden();
      await expect(first.locator("input").nth(0)).toBeChecked();
      await page.screenshot({
        path: info.outputPath(`physics-quiz-${viewport.width}.png`),
      });
    } finally {
      releaseText();
      releaseDrawings();
    }
  });
}

test("failed figures leave the question and answer usable and an image-only retry preserves the same card", async ({
  page,
}, info) => {
  await page.addInitScript(
    (endpoint) =>
      localStorage.setItem(
        "fcboard-settings",
        JSON.stringify({
          endpoint,
          apiKey: "test-only",
          model: "test",
          textModel: "test",
          autoMath: false,
        }),
      ),
    endpoint,
  );
  let programs = 0;
  let questions = 0;
  await page.route(endpoint, async (route) => {
    const system = String(route.request().postDataJSON().messages[0].content);
    let result: unknown;
    if (system.startsWith("Research original quiz design")) {
      result = {
        title: "独立题目与配图",
        tasks: [{ type: "single", focus: "由图中m和F计算加速度" }],
        sources,
      };
    } else if (system.startsWith("Generate ONE original")) {
      questions++;
      result = {
        ...question(1),
        type: "single",
        options: ["1 m/s²", "2 m/s²", "4 m/s²"],
        answer: ["B"],
      };
    } else if (system.startsWith("Create only the accurate")) {
      programs++;
      result =
        programs <= 2
          ? drawing(
              '<html><body><div data-fc-graphics style="width:600px;height:340px"></div><script>throw Error("fixture drawing failed")</script></body></html>',
            )
          : drawing();
    } else {
      expect(system).toContain("Check an actual generated");
      result = { valid: true, issues: "" };
    }
    await route.fulfill({
      json: { choices: [{ message: { content: JSON.stringify(result) } }] },
    });
  });
  await page.goto("/");
  await submitQuiz(page, "使用 JSXGraph 出1道牛顿定律选择题。");
  const frame = page.frameLocator('iframe[title="独立题目与配图"]');
  const card = frame.locator(".card");
  await expect(card.locator("h2")).toContainText("小车质量");
  await card.locator("input").nth(1).check();
  await expect(card.locator(".answer")).toHaveAttribute("open");
  await expect(card.locator(".verdict")).toHaveAttribute(
    "data-correct",
    "true",
  );
  await expect(card.locator(".quiz-image [role='alert']")).toContainText(
    "fixture drawing failed",
  );
  expect(programs).toBe(2);
  await card.evaluate((node) => {
    (node as HTMLElement).dataset.fixtureCard = "retained";
  });
  await card.getByRole("button", { name: "重试配图", exact: true }).click();
  await expect
    .poll(() =>
      card
        .locator(".quiz-image img")
        .evaluate((node: HTMLImageElement) => node.naturalWidth),
    )
    .toBeGreaterThan(0);
  expect(programs).toBe(3);
  expect(questions).toBe(1);
  await expect(card).toHaveAttribute("data-fixture-card", "retained");
  await expect(card.locator("input").nth(1)).toBeChecked();
  await expect(card.locator(".answer")).toHaveAttribute("open");
  await page.screenshot({ path: info.outputPath("quiz-figure-retry.png") });
});
