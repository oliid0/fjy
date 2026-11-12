import { expect, test } from "@playwright/test";

for (const example of [
  { language: "zh-CN", source: "Hello world", target: /[\u3400-\u9fff]/ },
  { language: "en", source: "你好世界", target: /world/i },
]) {
  test(`bundled OPUS translation runs offline in ${example.language} without an API key`, async ({
    page,
  }, info) => {
    test.setTimeout(90000);
    await page.addInitScript(({ language, source }) => {
      localStorage.setItem("fcboard-language", language);
      localStorage.setItem(
        "fcboard-state",
        JSON.stringify({ currentItemInkAssist: "language" }),
      );
      localStorage.setItem(
        "fcboard-settings",
        JSON.stringify({
          apiKey: "",
          ocr: "local",
          translationProvider: "local",
        }),
      );
      localStorage.setItem(
        "fcboard",
        JSON.stringify([
          {
            id: "local-translation-source",
            type: "text",
            x: 200,
            y: 180,
            width: 200,
            height: 40,
            text: source,
            originalText: source,
            fontSize: 28,
            fontFamily: 1,
            lineHeight: 1.25,
            customData: {
              fcInk: { version: 2, pen: "hard", assist: "language" },
            },
          },
        ]),
      );
    }, example);
    const external: string[] = [];
    page.on("request", (request) => {
      if (
        /^https?:/.test(request.url()) &&
        !request.url().startsWith("http://127.0.0.1:")
      ) {
        external.push(request.url());
      }
    });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:)/, (route) => route.abort());
    await page.goto("/");
    await expect(page.locator(".fc-unified-toolbar")).toBeVisible();
    await page.locator("[data-toolbar-pen]").click();
    await page
      .getByRole("button", {
        name: example.language === "en" ? "Language pen" : "语言笔",
        exact: true,
      })
      .click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("v");
    await page.keyboard.press("Control+a");
    const started = Date.now();
    const translation = page
      .locator('[role="dialog"] p')
      .filter({ hasText: example.target });
    await expect(translation.first()).toBeVisible({ timeout: 60000 });
    expect(
      external.filter((url) =>
        /huggingface|jsdelivr|chat\/completions|responses/.test(url),
      ),
    ).toEqual([]);
    await info.attach("offline-translation", {
      body: JSON.stringify({
        language: example.language,
        elapsedMs: Date.now() - started,
        external,
      }),
      contentType: "application/json",
    });
  });
}
