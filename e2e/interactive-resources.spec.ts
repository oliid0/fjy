import { expect, test } from "@playwright/test";

import { interactiveResource } from "../app/fcboard/test/interactiveResource";

import { selectMenu } from "./menu";

import type { ResourceControlState } from "../packages/fcboard/interactiveResourceControls";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 3080, height: 1240 },
  { width: 390, height: 844 },
]) {
  test(`generated lesson runs in a sandboxed board iframe at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() =>
      localStorage.setItem(
        "fcboard-settings",
        JSON.stringify({
          apiKey: "test-only",
          model: "test",
          speech: "system",
        }),
      ),
    );
    let agentCalls = 0;
    let observed = false;
    let objectId = "";
    await page.route(
      "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
      async (route) => {
        const request = route.request().postDataJSON();
        let result: unknown = interactiveResource;
        if (
          !request.messages[0].content.startsWith(
            "Create a scientifically accurate interactive teaching experiment",
          )
        ) {
          expect(request.messages[0].content).toContain("resources.interact");
          agentCalls++;
          if (agentCalls === 1) {
            result = {
              action: "commands",
              continue: true,
              commands: [{ name: "canvas.inspect" }],
            };
          } else {
            const content = String(request.messages.at(-1).content);
            const { results } = JSON.parse(
              content.slice(content.indexOf("\n") + 1),
            );
            expect(results[0].ok).toBe(true);
            if (agentCalls === 2) {
              objectId = results[0].result.elements.find(
                (item: { interactive?: boolean }) => item.interactive,
              ).id;
              result = {
                action: "commands",
                continue: true,
                commands: [
                  { name: "resources.inspect", args: { id: objectId } },
                ],
              };
            } else if (agentCalls === 3) {
              const state = results[0].result as ResourceControlState;
              expect(state.outputs).toEqual(["2 m/s²"]);
              result = {
                action: "commands",
                continue: true,
                commands: [
                  {
                    name: "resources.interact",
                    args: {
                      id: objectId,
                      version: state.version,
                      control: state.controls.find(
                        (item) => item.type === "range",
                      )!.id,
                      action: "set",
                      value: 10,
                    },
                  },
                ],
              };
            } else {
              expect(agentCalls).toBe(4);
              expect(results[0].result.outputs).toEqual(["5 m/s²"]);
              observed = true;
              result = { action: "done" };
            }
          }
        }
        await route.fulfill({
          json: {
            choices: [{ message: { content: JSON.stringify(result) } }],
          },
        });
      },
    );
    await page.goto("/");
    await page
      .getByRole("toolbar", { name: "白板工具栏" })
      .getByRole("button", { name: "插入", exact: true })
      .click();
    await page.getByRole("button", { name: "教学资源", exact: true }).click();
    const library = page.getByRole("dialog", { name: "教学资源", exact: true });
    await library.getByRole("textbox", { name: "搜索资源" }).fill("牛顿力学");
    await library
      .getByRole("button", { name: "AI 生成教学资源", exact: true })
      .click();
    await expect(library).toBeHidden();
    const frame = page.locator(`iframe[title="${interactiveResource.title}"]`);
    await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    const box = (await frame.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    // Activate the existing board iframe interaction, then operate its actual controls.
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    const lesson = frame.contentFrame();
    await expect(lesson.locator("output")).toHaveText("2 m/s²");
    await lesson.locator("input").fill("10");
    await expect(lesson.locator("output")).toHaveText("5 m/s²");
    await expect(lesson.locator("#block")).toHaveAttribute("x", "150");
    const resourceWindow = page
      .locator(".fc-resource-window")
      .filter({ has: frame });
    const drag = resourceWindow.locator(".fc-resource-window-drag");
    const grip = (await drag.boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      grip.x + grip.width / 2 + 12,
      grip.y + grip.height / 2 + 14,
      { steps: 5 },
    );
    await page.mouse.up();
    await expect(lesson.locator("output")).toHaveText("5 m/s²");
    const sizing = (await resourceWindow
      .locator(".fc-resource-window-resize")
      .boundingBox())!;
    await page.mouse.move(
      sizing.x + sizing.width / 2,
      sizing.y + sizing.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      sizing.x + sizing.width / 2 + 10,
      sizing.y + sizing.height / 2 + 12,
      { steps: 5 },
    );
    await page.mouse.up();
    await expect(lesson.locator("output")).toHaveText("5 m/s²");
    await lesson.getByRole("button", { name: "Reset" }).click();
    await expect(lesson.locator("output")).toHaveText("2 m/s²");
    // Supply only provider/model results; the real assistant, router and sandbox do the work.
    await page.evaluate(() => {
      Object.defineProperty(window, "SpeechRecognition", {
        configurable: true,
        value: class {
          onresult: ((event: unknown) => void) | null = null;
          start() {
            queueMicrotask(() =>
              this.onresult?.({
                resultIndex: 0,
                results: [
                  {
                    isFinal: true,
                    0: { transcript: "把实验中的力改为10牛顿，读取加速度" },
                  },
                ],
              }),
            );
          }
          stop() {}
        },
      });
    });
    await selectMenu(page, "语音指令");
    await expect(lesson.locator("output")).toHaveText("5 m/s²", {
      timeout: 20000,
    });
    await expect.poll(() => observed).toBe(true);
    expect(agentCalls).toBe(4);
    await page.reload();
    await expect(
      page
        .frameLocator(`iframe[title="${interactiveResource.title}"]`)
        .locator("output"),
    ).toHaveText("2 m/s²");
  });
}
