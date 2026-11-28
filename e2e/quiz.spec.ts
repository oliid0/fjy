import { expect, test } from "@playwright/test";

import { submitQuiz } from "./quiz";

const endpoint = "https://quiz-test.example/v1/chat/completions";
const figure = {
  mode: "jsxgraph",
  caption: "小车受力示意图",
  boundingbox: [0, 5, 8, 0],
  elements: [
    {
      id: "A",
      type: "point",
      parents: [1, 1],
      attributes: { visible: false, withLabel: false },
    },
    {
      id: "B",
      type: "point",
      parents: [4, 1],
      attributes: { visible: false, withLabel: false },
    },
    {
      id: "C",
      type: "point",
      parents: [4, 3],
      attributes: { visible: false, withLabel: false },
    },
    {
      id: "D",
      type: "point",
      parents: [1, 3],
      attributes: { visible: false, withLabel: false },
    },
    {
      id: "cart",
      type: "polygon",
      parents: ["A", "B", "C", "D"],
      attributes: { fillColor: "#fff", fillOpacity: 1 },
    },
    {
      id: "force",
      type: "arrow",
      parents: [
        [4, 2],
        [7, 2],
      ],
    },
    { id: "mass", type: "text", parents: [1.4, 2, "m = 2 kg"] },
    { id: "label", type: "text", parents: [4.6, 2.7, "F = 4 N"] },
  ],
};
const question = (index: number) =>
  index % 2 === 0
    ? {
        type: "single",
        question: `第${index + 1}题：物体不受合力时将如何运动？`,
        options: ["保持静止或匀速直线运动", "一定静止", "一直加速"],
        answer: ["A"],
        explanation: "运动状态保持不变。",
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
        figure,
      };

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 3080, height: 1240 },
  { width: 390, height: 844 },
]) {
  test(`quiz composer starts all questions concurrently and renders same-response diagram JSON, grades and preserves answers at ${viewport.width}`, async ({
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
    const textGate = new Promise<void>((resolve) => {
      releaseText = resolve;
    });
    let questionRequests = 0;
    await page.route(endpoint, async (route) => {
      const body = route.request().postDataJSON();
      const system = String(body.messages[0].content);
      let result: unknown;
      if (
        system.startsWith("Generate ONE original independent quiz question")
      ) {
        questionRequests++;
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
      } else {
        throw new Error(`Unexpected model request: ${system.slice(0, 100)}`);
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
      await expect(panel.locator("iframe")).toHaveAttribute(
        "title",
        /牛顿定律/,
      );
      const frame = page.frameLocator(".fc-quiz-panel iframe");
      await expect(frame.locator("article.card")).toHaveCount(10);
      await expect(
        frame.locator('article.card[data-ready="true"]'),
      ).toHaveCount(1);
      expect(questionRequests).toBe(10);
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
      await calculation.locator(".answer > summary").click();
      await expect(calculation.locator(".steps li")).toHaveCount(2);
      await expect(frame.locator(".quiz-image img")).toHaveCount(5);
      expect(questionRequests).toBe(10);
      await expect
        .poll(() =>
          calculation
            .locator(".quiz-image img")
            .evaluate((node: HTMLImageElement) => node.naturalWidth),
        )
        .toBeGreaterThan(0);
      await info.attach("actual-jsxgraph-figure", {
        body: await calculation.locator(".quiz-image img").screenshot(),
        contentType: "image/png",
      });
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
  await page.addInitScript(() => {
    let failed = false;
    window.addEventListener(
      "message",
      (event) => {
        if (
          !failed &&
          event.data?.type === "quiz-graphic" &&
          event.data.dataURL
        ) {
          failed = true;
          event.stopImmediatePropagation();
          window.dispatchEvent(
            new MessageEvent("message", {
              source: event.source,
              data: {
                ...event.data,
                dataURL: undefined,
                error: "fixture drawing failed",
              },
            }),
          );
        }
      },
      true,
    );
  });
  let questions = 0;
  await page.route(endpoint, async (route) => {
    const system = String(route.request().postDataJSON().messages[0].content);
    let result: unknown;
    if (system.startsWith("Generate ONE original")) {
      questions++;
      result = {
        ...question(1),
        type: "single",
        options: ["1 m/s²", "2 m/s²", "4 m/s²"],
        answer: ["B"],
      };
    } else {
      throw new Error(`Unexpected model request: ${system.slice(0, 100)}`);
    }
    await route.fulfill({
      json: { choices: [{ message: { content: JSON.stringify(result) } }] },
    });
  });
  await page.goto("/");
  await submitQuiz(page, "使用 JSXGraph 出1道牛顿定律选择题。");
  await expect(page.locator(".fc-quiz-panel iframe")).toHaveAttribute(
    "title",
    /牛顿定律/,
  );
  const frame = page.frameLocator(".fc-quiz-panel iframe");
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
  expect(questions).toBe(1);
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
  expect(questions).toBe(1);
  expect(questions).toBe(1);
  await expect(card).toHaveAttribute("data-fixture-card", "retained");
  await expect(card.locator("input").nth(1)).toBeChecked();
  await expect(card.locator(".answer")).toHaveAttribute("open");
  await page.screenshot({ path: info.outputPath("quiz-figure-retry.png") });
});
