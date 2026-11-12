import { expect, test } from "@playwright/test";

import { interactiveResource } from "../app/fcboard/test/interactiveResource";

import { installVoice, say, startVoice, voiceEndpoint } from "./voice";

import type { ResourceControlState } from "../packages/fcboard/interactiveResourceControls";

for (const width of [1440, 3080, 390]) {
  test(`voice explains while independent agents generate, write and operate an experiment at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await installVoice(page);
    let releaseResource!: () => void;
    let workerCalls = 0;
    let child = "";
    let objectId = "";
    let failed = false;
    let resourceCalls = 0;
    await page.route(voiceEndpoint, async (route) => {
      const request = route.request().postDataJSON();
      const system = String(request.messages[0].content);
      const last = String(request.messages.at(-1).content);
      let result: unknown;
      if (
        system.startsWith(
          "Create a scientifically accurate interactive teaching resource",
        )
      ) {
        resourceCalls++;
        if (resourceCalls > 1) {
          failed = true;
          await route.fulfill({
            status: 500,
            json: { error: { message: "test resource failure" } },
          });
          return;
        }
        await new Promise<void>((resolve) => {
          releaseResource = resolve;
        });
        result = interactiveResource;
      } else if (system.startsWith("你是持续对话的白板助教")) {
        if (last.startsWith("详细演示")) {
          result = {
            action: "commands",
            commands: [
              {
                name: "agent.tools",
                args: {
                  names: [
                    "canvas.text",
                    "canvas.animate",
                    "resources.generate",
                    "resources.interact",
                  ],
                },
              },
              {
                name: "agent.start",
                args: {
                  prompt:
                    "演示牛顿定律：生成真实实验，同时写标题与说明，再操作实验核对结果。需要朗读的说明通过agent.say返回。",
                  role: "学科协调",
                },
              },
            ],
          };
        } else if (last.startsWith("推力撤去")) {
          result = {
            action: "text",
            text: "合外力为零时，物体保持原来的运动状态，我们可以继续讨论。",
          };
        } else if (last.startsWith("生成另一个")) {
          result = {
            action: "commands",
            commands: [
              {
                name: "resources.generate",
                args: { prompt: "另一项真实实验" },
              },
            ],
          };
        } else if (last.startsWith("还能继续")) {
          result = { action: "text", text: "可以，我们继续解释惯性。" };
        } else {
          result = { action: "text", text: "牛顿定律描述力和运动的关系。" };
        }
      } else {
        expect(system).toContain("独立白板任务agent");
        workerCalls++;
        if (workerCalls === 1) {
          result = {
            action: "commands",
            commands: [
              {
                name: "agent.start",
                args: {
                  prompt: "生成牛顿定律实验",
                  role: "实验",
                  command: {
                    name: "resources.generate",
                    args: {
                      prompt: "Newton's second law interactive experiment",
                    },
                  },
                },
              },
              {
                name: "canvas.text",
                args: {
                  text: "牛顿定律",
                  role: "title",
                  sourceIds: [],
                  presentation: "text",
                },
              },
              {
                name: "canvas.animate",
                args: {
                  commands: [
                    {
                      type: "write_text",
                      id: "inertia",
                      text: "合外力为零时，物体保持静止或匀速直线运动。",
                      x: 0,
                      y: 100,
                      duration: 0,
                    },
                  ],
                },
              },
              {
                name: "agent.say",
                args: { text: "合外力为零时，物体保持静止或匀速直线运动。" },
              },
            ],
          };
        } else {
          const data = JSON.parse(last.slice(last.indexOf("\n") + 1));
          expect(data.results.every((item: { ok: boolean }) => item.ok)).toBe(
            true,
          );
          if (workerCalls === 2) {
            child = data.results[0].result.id;
            result = {
              action: "commands",
              commands: [{ name: "agent.wait", args: { id: child } }],
            };
          } else if (workerCalls === 3) {
            objectId = data.results[0].result.result.ids[0];
            result = {
              action: "commands",
              commands: [{ name: "resources.inspect", args: { id: objectId } }],
            };
          } else if (workerCalls === 4) {
            const state = data.results[0].result as ResourceControlState;
            expect(state.outputs).toEqual(["2 m/s²"]);
            result = {
              action: "commands",
              commands: [
                {
                  name: "resources.interact",
                  args: {
                    id: objectId,
                    version: state.version,
                    control: state.controls.find(
                      (control) => control.type === "range",
                    )!.id,
                    action: "set",
                    value: 10,
                  },
                },
              ],
            };
          } else if (workerCalls === 5) {
            expect(data.results[0].result.outputs).toEqual(["5 m/s²"]);
            const explanation =
              "质量为两千克，合力十牛顿，加速度为每二次方秒五米。";
            result = {
              action: "commands",
              commands: [
                {
                  name: "canvas.text",
                  args: {
                    text: explanation,
                    sourceIds: [],
                    presentation: "text",
                  },
                },
                { name: "agent.say", args: { text: explanation } },
              ],
            };
          } else {
            expect(workerCalls).toBe(6);
            result = { action: "done" };
          }
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
    await say(page, "详细演示一下牛顿定律");
    await expect.poll(() => typeof releaseResource).toBe("function");
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.parse(localStorage.getItem("fcboard") || "[]").some(
            (item: { text?: string }) => item.text === "牛顿定律",
          ),
        ),
      )
      .toBe(true);
    await say(page, "推力撤去后为什么还能运动？");
    await expect(page.locator(".fc-voice-caption")).toContainText(
      "我们可以继续讨论",
    );
    await expect(page.locator(".fc-voice-orb")).toBeVisible();
    releaseResource();
    const experiment = page.frameLocator(
      `iframe[title="${interactiveResource.title}"]`,
    );
    await expect(experiment.locator("output")).toHaveText("5 m/s²", {
      timeout: 20000,
    });
    await expect(experiment.locator("#block")).toHaveAttribute("x", "150");
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.parse(localStorage.getItem("fcboard") || "[]").some(
            (item: { text?: string }) => item.text?.includes("合力十牛顿"),
          ),
        ),
      )
      .toBe(true);
    await expect(page.locator(".fc-voice-caption")).toContainText("合力十牛顿");
    await say(page, "生成另一个实验");
    await expect.poll(() => failed).toBe(true);
    await say(page, "还能继续对话吗？");
    await expect(page.locator(".fc-voice-caption")).toContainText(
      "我们继续解释惯性",
    );
    await expect(
      page.locator(".fc-teacher,.fc-agent-tasks,.fc-error"),
    ).toHaveCount(0);
    await expect(page.locator(".fc-voice-orb")).toBeVisible();
    expect(resourceCalls).toBeGreaterThanOrEqual(2);
    expect(child).toBeTruthy();
    expect(objectId).toBeTruthy();
  });
}
