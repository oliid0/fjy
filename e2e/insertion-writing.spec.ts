import { expect, test } from "@playwright/test";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 3080, height: 1240 },
  { width: 390, height: 844 },
]) {
  for (const [kind, label] of [
    ["mindmap", "思维导图"],
    ["fourline", "四线格"],
  ] as const) {
    test(`ordinary handwriting types into ${kind} at ${viewport.width}`, async ({
      page,
    }, info) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(() =>
        localStorage.setItem(
          "fcboard-settings",
          JSON.stringify({ apiKey: "test-only", model: "test", ocr: "cloud" }),
        ),
      );
      await page.route(
        "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
        async (route) => {
          const body = route.request().postDataJSON();
          expect(body.messages[0].content).toContain("Transcribe only");
          await route.fulfill({
            json: { choices: [{ message: { content: "Hello" } }] },
          });
        },
      );
      await page.goto("/");
      await page
        .getByRole("toolbar", { name: "白板工具栏", exact: true })
        .getByRole("button", { name: "插入", exact: true })
        .click();
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect(
        page.getByRole("dialog", { name: label, exact: true }),
      ).toBeHidden();
      await expect
        .poll(() =>
          page.evaluate(
            (kind) =>
              JSON.parse(localStorage.getItem("excalidraw") || "[]").some(
                (item: {
                  type: string;
                  customData?: { fcInsertion?: { kind: string } };
                }) =>
                  item.type === "rectangle" &&
                  item.customData?.fcInsertion?.kind === kind,
              ),
            kind,
          ),
        )
        .toBe(true);
      const point = await page.evaluate((kind) => {
        const elements = JSON.parse(localStorage.getItem("excalidraw") || "[]");
        const body = elements.find(
          (item: {
            type: string;
            customData?: { fcInsertion?: { kind: string; textIndex: number } };
          }) =>
            item.type === "rectangle" &&
            item.customData?.fcInsertion?.kind === kind &&
            item.customData.fcInsertion.textIndex === 0,
        );
        const state = JSON.parse(
          localStorage.getItem("excalidraw-state") || "{}",
        );
        const zoom = state.zoom?.value || 1;
        return {
          x: (body.x + (state.scrollX || 0) + 12) * zoom,
          y: (body.y + (state.scrollY || 0) + 12) * zoom,
        };
      }, kind);
      if (kind === "mindmap") {
        await page.mouse.click(point.x, point.y);
      }
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await page.mouse.move(point.x + 20, point.y + 12, { steps: 6 });
      await page.mouse.move(point.x + 38, point.y + 5, { steps: 6 });
      await page.mouse.up();
      await page
        .getByRole("toolbar", { name: "手写识别", exact: true })
        .getByRole("button", { name: "Hello", exact: true })
        .click();
      const typed = () =>
        page.evaluate(
          (kind) =>
            JSON.parse(localStorage.getItem("excalidraw") || "[]").filter(
              (item: {
                type: string;
                isDeleted?: boolean;
                originalText?: string;
                customData?: { fcInsertion?: { kind: string } };
              }) =>
                !item.isDeleted &&
                item.type === "text" &&
                item.originalText === "Hello" &&
                item.customData?.fcInsertion?.kind === kind,
            ).length,
          kind,
        );
      await expect.poll(typed).toBe(1);
      await page.keyboard.press("Control+z");
      await expect.poll(typed).toBe(0);
      await page.keyboard.press("Control+Shift+z");
      await expect.poll(typed).toBe(1);
      await page.screenshot({
        path: info.outputPath(`${kind}-handwriting.png`),
      });
    });
  }
}
