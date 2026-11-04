import { expect, test } from "@playwright/test";

import { selectMenu } from "./menu";
import { writeQuestion } from "./question";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 3080, height: 1240 },
  { width: 390, height: 844 },
]) {
  test(`handwritten quiz researches, grades, renders physics and preserves answers at ${viewport.width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() =>
      localStorage.setItem(
        "fcboard-settings",
        JSON.stringify({
          apiKey: "test-only",
          model: "test",
          ocr: "cloud",
          autoMath: false,
        }),
      ),
    );
    let searched = false;
    let generated = false;
    await page.route(
      "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
      async (route) => {
        const body = route.request().postDataJSON();
        const research = JSON.stringify(body).includes("学科命题资料研究员");
        if (research) {
          searched =
            body.web_search_options !== undefined ||
            body.tools?.some(
              (tool: { type: string }) => tool.type === "web_search",
            ) ||
            body.tools?.some(
              (tool: { function?: { name: string } }) =>
                tool.function?.name === "web_search",
            );
        } else {
          generated = JSON.stringify(body).includes(
            "出10道初中物理关于牛顿第一定律的选择题和计算题",
          );
        }
        const questions = Array.from({ length: 10 }, (_, index) =>
          index % 2 === 0
            ? {
                type: "single",
                question: `第${index + 1}题：物体不受力时将如何运动？`,
                options: ["保持静止或匀速直线运动", "一定静止", "一直加速"],
                answer: ["A"],
                explanation: "运动状态保持不变。",
              }
            : {
                type: "calculation",
                question: `第${
                  index + 1
                }题：小车质量$m=2\\,\\mathrm{kg}$，合力$F=4\\,\\mathrm{N}$，求加速度。`,
                answer: ["$a=2\\,\\mathrm{m/s^2}$"],
                explanation: "加速度沿合力方向。",
                steps: [
                  "由牛顿第二定律$F=ma$",
                  "代入$a=\\frac{F}{m}=\\frac{4}{2}=2\\,\\mathrm{m/s^2}$",
                ],
                diagram: {
                  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 100"><rect x="40" y="35" width="80" height="40" fill="none" stroke="black"/><path d="M120 50H210L200 45M210 50L200 55" fill="none" stroke="black"/><text x="160" y="30">F=4 N</text></svg>',
                  caption: "小车受力示意图",
                },
              },
        );
        await route.fulfill({
          json: {
            choices: [
              {
                message: {
                  content: research
                    ? "教材资料 https://www.moe.gov.cn/"
                    : JSON.stringify({
                        title: "牛顿定律课堂练习",
                        questions,
                        sources: [
                          { title: "教育部", url: "https://www.moe.gov.cn/" },
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
    await selectMenu(page, "提问与讲解");
    await expect(
      page.locator(".fc-ink-question").getByRole("textbox"),
    ).toHaveCount(0);
    await writeQuestion(page, "出10道初中物理关于牛顿第一定律的选择题和计算题");
    const panel = page.locator(".fc-quiz-panel");
    await expect(panel).toBeVisible();
    const frame = page.frameLocator('iframe[title="牛顿定律课堂练习"]');
    await expect(frame.locator("article.card")).toHaveCount(10);
    expect(searched).toBe(true);
    expect(generated).toBe(true);
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    const first = frame.locator("article.card").nth(0);
    await first.locator("input").nth(1).check();
    await expect(first.locator(".verdict")).toHaveAttribute(
      "data-correct",
      "false",
    );
    await expect(first.locator('.choice[data-key="A"]')).toHaveClass(/correct/);
    await first.locator("h2").dblclick();
    await expect(first.locator(".answer")).not.toHaveAttribute("open");
    await first.locator("h2").dblclick();
    await expect(first.locator(".answer")).toHaveAttribute("open");
    await first.locator("input").nth(0).check();
    await expect(first.locator(".verdict")).toHaveAttribute(
      "data-correct",
      "true",
    );
    await frame.locator("#next").click();
    await expect(frame.locator("#page")).toHaveText("2 / 10");
    await expect(frame.locator("#progress")).toHaveAttribute(
      "aria-valuenow",
      "2",
    );
    const calculation = frame.locator("article.card").nth(1);
    await expect(calculation.locator("input,textarea")).toHaveCount(0);
    await expect(calculation.locator(".quiz-diagram img")).toBeVisible();
    await expect(calculation.locator("h2 img.formula").first()).toBeVisible();
    await calculation.locator("h2").dblclick();
    await expect(calculation.locator(".steps li")).toHaveCount(2);
    await expect(
      calculation.locator(".steps img.formula").last(),
    ).toBeVisible();
    await calculation.locator("h2").dblclick();
    await expect(calculation.locator(".answer")).not.toHaveAttribute("open");
    await frame.locator("#prev").click();
    await expect(frame.locator("#page")).toHaveText("1 / 10");
    await expect(first.locator("input").nth(0)).toBeChecked();
    await panel.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "展开回答", exact: true }).click();
    await expect(first.locator("input").nth(0)).toBeChecked();
    await page.screenshot({
      path: info.outputPath(`physics-quiz-${viewport.width}.png`),
    });
  });
}
