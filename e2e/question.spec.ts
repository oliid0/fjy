import { expect, test } from "@playwright/test";

import { selectMenu } from "./menu";
import { dictateQuestion } from "./question";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 3080, height: 1240 },
  { width: 390, height: 844 },
]) {
  test(`dictated questions are editable board objects with a nearby foldable answer at ${viewport.width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() =>
      localStorage.setItem(
        "fcboard-settings",
        JSON.stringify({
          apiKey: "test-only",
          model: "test",
          speech: "system",
          autoMath: false,
          answerStyle: "handwritten",
        }),
      ),
    );
    let requested = false;
    await page.route(
      "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
      async (route) => {
        const body = route.request().postDataJSON();
        expect(
          String(body.messages?.[0]?.content).startsWith("Transcribe only"),
        ).toBe(false);
        requested = JSON.stringify(body).includes("物体为什么会下落");
        await route.fulfill({
          json: {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    action: "text",
                    text: "物体受到重力，会向地面加速下落。",
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
    const frame = (await page
      .locator(".fc-ink-question svg[role=img]")
      .boundingBox())!;
    await dictateQuestion(page, "物体为什么会下落？");
    const fold = page.getByRole("button", { name: "折叠回答", exact: true });
    await expect(fold).toBeEnabled();
    expect(requested).toBe(true);
    const writing = () =>
      page.evaluate(() => {
        const items = JSON.parse(
          localStorage.getItem("excalidraw") || "[]",
        ).filter((item: { isDeleted?: boolean }) => !item.isDeleted);
        return {
          question: items.filter(
            (item: { customData?: { fcQuestionInput?: boolean } }) =>
              item.customData?.fcQuestionInput,
          ),
          answer: items.filter(
            (item: {
              customData?: { fcQuestionInput?: boolean; fcGenerated?: boolean };
            }) =>
              item.customData?.fcGenerated && !item.customData?.fcQuestionInput,
          ),
          state: JSON.parse(localStorage.getItem("excalidraw-state") || "{}"),
        };
      });
    await expect
      .poll(async () => (await writing()).answer.length)
      .toBeGreaterThan(0);
    const { question, answer, state } = await writing();
    expect(question).toHaveLength(1);
    const source = question[0];
    expect(source.fontFamily).toBe(5);
    const root = (await page.locator(".excalidraw").boundingBox())!;
    const left = root.x + (source.x + state.scrollX) * state.zoom.value;
    const top = root.y + (source.y + state.scrollY) * state.zoom.value;
    expect(left).toBeGreaterThanOrEqual(frame.x - 1);
    expect(top).toBeGreaterThanOrEqual(frame.y - 1);
    expect(left + source.width * state.zoom.value).toBeLessThanOrEqual(
      frame.x + frame.width + 1,
    );
    expect(top + source.height * state.zoom.value).toBeLessThanOrEqual(
      frame.y + frame.height + 1,
    );
    expect(source.fontSize * state.zoom.value).toBeGreaterThanOrEqual(6);
    expect(answer[0].fontSize).toBeLessThanOrEqual(source.fontSize);
    expect(answer[0].y).toBeGreaterThanOrEqual(source.y + source.height);
    expect(
      await page.evaluate(
        ({ x, y }) =>
          !!document.elementFromPoint(x, y)?.closest(".fc-ink-question"),
        { x: left + 2, y: top + 2 },
      ),
    ).toBe(false);
    await expect(page.locator(".fc-ink-question-words")).toHaveCount(0);
    await fold.click();
    await expect.poll(async () => (await writing()).answer.length).toBe(0);
    await page.getByRole("button", { name: "展开回答", exact: true }).click();
    await expect
      .poll(async () => (await writing()).answer.length)
      .toBe(answer.length);
    await page.screenshot({
      path: info.outputPath(`dictated-question-${viewport.width}.png`),
    });
  });
  test(`handwritten question stays visible and writes an editable answer nearby at ${viewport.width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      localStorage.setItem(
        "fcboard-settings",
        JSON.stringify({
          apiKey: "test-only",
          model: "test",
          ocr: "cloud",
          answerStyle: "handwritten",
        }),
      );
    });
    let recognized = false;
    let requested = false;
    await page.route(
      "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
      async (route) => {
        const body = route.request().postDataJSON();
        const transcription = String(body.messages?.[0]?.content).startsWith(
          "Transcribe only",
        );
        if (transcription) {
          recognized = JSON.stringify(body).includes("data:image/png;base64,");
        } else {
          requested = JSON.stringify(body).includes("这个题目的答案是什么");
        }
        await route.fulfill({
          json: {
            choices: [
              {
                message: {
                  content: transcription
                    ? "这个题目的答案是什么"
                    : JSON.stringify({ action: "text", text: "2" }),
                },
              },
            ],
          },
        });
      },
    );
    await page.goto("/");
    await selectMenu(page, "提问与讲解");
    const paper = page.getByRole("dialog", { name: "手写提问", exact: true });
    await expect(paper).toBeVisible();
    await expect(paper.getByRole("textbox")).toHaveCount(0);
    const box = (await paper.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    const ink = page.getByRole("img", { name: "向 AI 教师提问", exact: true });
    const writing = (await ink.boundingBox())!;
    await page.mouse.move(writing.x + 30, writing.y + 20);
    await page.mouse.down();
    await page.mouse.move(writing.x + 65, writing.y + 50, { steps: 6 });
    await page.mouse.move(writing.x + 45, writing.y + 80, { steps: 6 });
    await page.mouse.up();
    await expect(ink.locator("path")).toHaveCount(1);
    await page.getByRole("button", { name: "发送问题", exact: true }).click();
    await expect(paper).toHaveAttribute("aria-busy", "false");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const elements = JSON.parse(
            localStorage.getItem("excalidraw") || "[]",
          ).filter((el: { isDeleted?: boolean }) => !el.isDeleted);
          const question = elements.find(
            (el: { type: string; customData?: { fcGenerated?: boolean } }) =>
              el.type === "freedraw" && !el.customData?.fcGenerated,
          );
          const answer = elements.filter(
            (el: { customData?: { fcWrittenText?: string } }) =>
              el.customData?.fcWrittenText === "2",
          );
          return (
            !!question &&
            answer.length > 0 &&
            answer.every(
              (el: { y: number }) => el.y >= question.y + question.height,
            )
          );
        }),
      )
      .toBe(true);
    expect(recognized).toBe(true);
    expect(requested).toBe(true);
    await page.getByRole("button", { name: "折叠回答", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("excalidraw") || "[]").filter(
              (el: {
                isDeleted?: boolean;
                customData?: { fcWrittenText?: string };
              }) => !el.isDeleted && el.customData?.fcWrittenText === "2",
            ).length,
        ),
      )
      .toBe(0);
    await page.getByRole("button", { name: "展开回答", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("excalidraw") || "[]").filter(
              (el: {
                isDeleted?: boolean;
                customData?: { fcWrittenText?: string };
              }) => !el.isDeleted && el.customData?.fcWrittenText === "2",
            ).length,
        ),
      )
      .toBeGreaterThan(0);
    await page.screenshot({
      path: info.outputPath("handwritten-question.png"),
    });
  });
}
