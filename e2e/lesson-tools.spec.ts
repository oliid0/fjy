import { expect, test } from "@playwright/test";

import { interactiveResource } from "../app/fcboard/test/interactiveResource";

import { selectMenu } from "./menu";
import { dictateQuestion } from "./question";

import type { ResourceControlState } from "../packages/fcboard/interactiveResourceControls";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 3080, height: 1240 },
  { width: 390, height: 844 },
]) {
  test(`teacher changes an embedded experiment between narrated steps at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      localStorage.setItem(
        "fcboard-settings",
        JSON.stringify({
          apiKey: "test-only",
          model: "test",
          speech: "system",
          autoMath: false,
        }),
      );
      localStorage.setItem(
        "fcboard-teaching",
        JSON.stringify({ lens: "captions", speed: 1 }),
      );
    });
    let calls = 0;
    let observations = 0;
    let objectId = "";
    await page.route(
      "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
      async (route) => {
        const request = route.request().postDataJSON();
        let result: unknown;
        if (
          request.messages[0].content.startsWith(
            "Create a scientifically accurate interactive teaching experiment",
          )
        ) {
          result = interactiveResource;
        } else if (
          request.messages[0].content.startsWith(
            "You are the Fcboard teacher observing a live lesson",
          )
        ) {
          observations++;
          const context = JSON.parse(String(request.messages.at(-1).content));
          expect(context.resources[0].state.outputs[0]).toBe(
            observations === 1 ? "2 m/s²" : "5 m/s²",
          );
          result = { action: "keep" };
        } else {
          expect(request.messages[0].content).toContain(
            "Each step may also include tools",
          );
          calls++;
          if (calls === 1) {
            result = {
              action: "commands",
              commands: [{ name: "canvas.inspect" }],
              continue: true,
            };
          } else {
            const content = String(request.messages.at(-1).content);
            const { results } = JSON.parse(
              content.slice(content.indexOf("\n") + 1),
            );
            expect(results[0].ok).toBe(true);
            if (calls === 2) {
              objectId = results[0].result.elements.find(
                (element: { interactive?: boolean }) => element.interactive,
              ).id;
              result = {
                action: "commands",
                commands: [
                  { name: "resources.inspect", args: { id: objectId } },
                ],
                continue: true,
              };
            } else {
              expect(calls).toBe(3);
              const state = results[0].result as ResourceControlState;
              const force = state.controls.find(
                (control) => control.type === "range",
              )!;
              result = {
                action: "lesson",
                lesson: {
                  title: "牛顿第二定律",
                  steps: [
                    {
                      say: "先观察，质量保持两千克，四牛顿的力使加速度达到每二次方秒两米。",
                      commands: [],
                      tools: [
                        {
                          name: "resources.inspect",
                          args: { id: objectId },
                          expect: [{ path: "outputs.0", equals: "2 m/s²" }],
                        },
                      ],
                    },
                    {
                      say: "现在把力改为十牛顿，加速度增大到每二次方秒五米。",
                      commands: [
                        {
                          type: "write_text",
                          id: "acceleration",
                          text: "F=10 N，a=5 m/s²。质量保持不变，力越大加速度越大。",
                          x: 0,
                          y: 0,
                          duration: 0,
                        },
                      ],
                      tools: [
                        {
                          name: "resources.interact",
                          args: {
                            id: objectId,
                            version: state.version,
                            control: force.id,
                            action: "set",
                            value: 10,
                          },
                        },
                        {
                          name: "resources.inspect",
                          args: { id: objectId },
                          expect: [{ path: "outputs.0", equals: "5 m/s²" }],
                        },
                      ],
                    },
                  ],
                  quiz: [],
                },
              };
            }
          }
        }
        await route.fulfill({
          json: { choices: [{ message: { content: JSON.stringify(result) } }] },
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
    await library
      .getByRole("textbox", { name: "搜索资源" })
      .fill("Newton's second law");
    await library
      .getByRole("button", { name: "AI 生成教学资源", exact: true })
      .click();
    await expect(library).toBeHidden();
    const experiment = page.frameLocator(
      `iframe[title="${interactiveResource.title}"]`,
    );
    await expect(experiment.locator("output")).toHaveText("2 m/s²");
    await selectMenu(page, "提问与讲解");
    await dictateQuestion(page, "请讲解牛顿第二定律，比较四牛顿和十牛顿的力");
    await expect(page.locator(".fc-live-caption")).toContainText("先观察");
    await page.getByRole("button", { name: "暂停讲解", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "继续讲解", exact: true }),
    ).toBeVisible();
    await expect(experiment.locator("input")).toHaveValue("4");
    await page.getByRole("button", { name: "继续讲解", exact: true }).click();
    await expect(experiment.locator("output")).toHaveText("5 m/s²", {
      timeout: 20000,
    });
    await expect(experiment.locator("#block")).toHaveAttribute("x", "150");
    await expect(
      page.getByRole("button", { name: "重播讲解", exact: true }),
    ).toBeVisible({ timeout: 20000 });
    expect(calls).toBe(3);
    expect(observations).toBe(2);
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.parse(localStorage.getItem("excalidraw") || "[]").some(
            (element: {
              isDeleted?: boolean;
              customData?: { fcTutorId?: string };
            }) =>
              !element.isDeleted &&
              element.customData?.fcTutorId === "acceleration",
          ),
        ),
      )
      .toBe(true);
    const writing = await page.evaluate(() => {
      const elements = JSON.parse(localStorage.getItem("excalidraw") || "[]");
      const element = elements.find(
        (item: { isDeleted?: boolean; customData?: { fcTutorId?: string } }) =>
          !item.isDeleted && item.customData?.fcTutorId === "acceleration",
      );
      const state = JSON.parse(
        localStorage.getItem("excalidraw-state") || "{}",
      );
      const zoom = state.zoom?.value || 1;
      return {
        type: element.type,
        font: element.fontFamily,
        fontSize: element.fontSize * zoom,
        left: (element.x + (state.scrollX || 0)) * zoom,
        top: (element.y + (state.scrollY || 0)) * zoom,
        right: (element.x + element.width + (state.scrollX || 0)) * zoom,
        bottom: (element.y + element.height + (state.scrollY || 0)) * zoom,
      };
    });
    expect(writing.type).toBe("text");
    expect(writing.font).toBe(5);
    expect(writing.fontSize).toBeGreaterThanOrEqual(6);
    expect(writing.fontSize).toBeLessThanOrEqual(36);
    expect(writing.left).toBeGreaterThanOrEqual(0);
    expect(writing.top).toBeGreaterThanOrEqual(0);
    expect(writing.right).toBeLessThanOrEqual(viewport.width);
    expect(writing.bottom).toBeLessThanOrEqual(viewport.height);
  });
}
