import { expect, test } from "@playwright/test";

import { selectMenu } from "./menu";

test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
  permissions: ["microphone"],
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 3080, height: 1240 },
  { width: 390, height: 844 },
]) {
  test(`recording minimizes while writing, pauses, restores and stops at ${viewport.width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      localStorage.setItem(
        "fcboard-settings",
        JSON.stringify({ speech: "system", autoSummary: false }),
      );
      // Only ASR is supplied at the provider boundary; Chromium records a real media stream.
      Object.defineProperty(window, "SpeechRecognition", {
        configurable: true,
        value: class {
          onresult: ((event: unknown) => void) | null = null;
          start() {
            queueMicrotask(() =>
              this.onresult?.({
                resultIndex: 0,
                results: [
                  { isFinal: true, 0: { transcript: "Recording sample" } },
                ],
              }),
            );
          }
          stop() {}
        },
      });
    });
    await page.goto("/");
    await selectMenu(page, "课堂录制");
    const dialog = page.getByRole("dialog", { name: "录制", exact: true });
    await expect(dialog).toBeVisible();
    const bounds = (await dialog.boundingBox())!;
    expect(
      Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2),
    ).toBeLessThan(2);
    expect(
      Math.abs(bounds.y + bounds.height / 2 - viewport.height / 2),
    ).toBeLessThan(2);
    if (viewport.width > 700) {
      expect(bounds.width).toBeGreaterThan(bounds.height);
    }
    await dialog.getByRole("button", { name: "仅麦克风", exact: true }).click();
    await dialog.getByRole("button", { name: "开始录制", exact: true }).click();
    await expect(dialog).toBeHidden();
    const widget = page.getByRole("toolbar", { name: "录制", exact: true });
    await expect(widget).toBeVisible();
    await page.getByRole("button", { name: "画笔", exact: true }).click();
    if (await page.locator(".fc-editor-properties").isVisible()) {
      await page.keyboard.press("Escape");
    }
    await page.mouse.move(90, 130);
    await page.mouse.down();
    await page.mouse.move(180, 190, { steps: 12 });
    await page.mouse.up();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("excalidraw") || "[]").filter(
              (item: { isDeleted?: boolean }) => !item.isDeleted,
            ).length,
        ),
      )
      .toBe(1);
    const grip = (await widget.locator(".fc-recording-drag").boundingBox())!;
    await page.mouse.move(grip.x + 12, grip.y + 12);
    await page.mouse.down();
    await page.mouse.move(viewport.width - 4, 20, { steps: 8 });
    await page.mouse.up();
    const moved = (await widget.boundingBox())!;
    expect(moved.x).toBeGreaterThanOrEqual(8);
    expect(moved.x + moved.width).toBeLessThanOrEqual(viewport.width - 8);
    expect(moved.y).toBeGreaterThanOrEqual(8);
    await widget.getByRole("button", { name: "暂停录制", exact: true }).click();
    await expect(
      widget.getByRole("button", { name: "继续录制", exact: true }),
    ).toBeEnabled();
    await widget
      .getByRole("button", { name: "恢复录制窗口", exact: true })
      .click();
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText("Recording sample", { exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "继续录制", exact: true }).click();
    await dialog
      .getByRole("button", { name: "收起录制窗口", exact: true })
      .click();
    const restored = (await widget.boundingBox())!;
    expect(Math.abs(restored.x - moved.x)).toBeLessThan(2);
    expect(Math.abs(restored.y - moved.y)).toBeLessThan(2);
    await expect
      .poll(() => widget.locator("time").textContent())
      .not.toBe("00:00");
    await widget.getByRole("button", { name: "停止录制", exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("video")).toHaveAttribute("src", /^blob:/);
    await expect(
      dialog.getByText("Recording sample", { exact: true }),
    ).toHaveCount(2);
    await expect(
      dialog.getByRole("link", { name: "下载录制", exact: true }),
    ).toHaveAttribute("href", /^blob:/);
    await page.screenshot({ path: info.outputPath("recording-workspace.png") });
  });
}
