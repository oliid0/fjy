import { expect, test } from "@playwright/test";

import letters from "../excalidraw-app/fcdraw/handwriting/glyphs.json";

test("handwritten selection calculates with bundled OCR and no cloud request", async ({
  page,
}, testInfo) => {
  const glyphs = letters.glyphs as Record<
    string,
    { advance: number; strokes: number[][][] }
  >;
  const elements: object[] = [];
  let x = 200;
  for (const character of "1+1=") {
    const glyph = glyphs[character];
    const originX = x;
    for (const stroke of glyph.strokes) {
      const points = stroke.map(([a, b]) => [originX + a * 3, 160 + b * 3]);
      const left = Math.min(...points.map((p) => p[0]));
      const top = Math.min(...points.map((p) => p[1]));
      elements.push({
        id: `ocr-ink-${elements.length}`,
        type: "freedraw",
        x: left,
        y: top,
        width: Math.max(...points.map((p) => p[0])) - left,
        height: Math.max(...points.map((p) => p[1])) - top,
        points: points.map(([a, b]) => [a - left, b - top]),
        pressures: [],
        simulatePressure: true,
        strokeColor: "#ffffff",
        strokeWidth: 3,
        opacity: 100,
        customData: {
          fcInk: { version: 2, pen: "hard", unit: 1, centerline: true },
        },
      });
    }
    x += glyph.advance * 3;
  }
  await page.addInitScript((ink) => {
    localStorage.setItem("excalidraw", JSON.stringify(ink));
    localStorage.setItem(
      "excalidraw-state",
      JSON.stringify({ viewBackgroundColor: "#002820" }),
    );
    localStorage.setItem(
      "fcboard-settings",
      JSON.stringify({
        ocr: "local",
        answerStyle: "handwritten",
        autoMath: true,
      }),
    );
  }, elements);
  let cloudRequests = 0;
  await page.route("https://ark.cn-beijing.volces.com/**", async (route) => {
    cloudRequests++;
    await route.abort();
  });
  await page.goto("/");
  await expect(page.getByRole("toolbar", { name: "白板工具栏" })).toBeVisible();
  await page.keyboard.press("v");
  await page.keyboard.press("Control+a");
  await expect(page.getByRole("toolbar", { name: "选区操作" })).toBeVisible();
  await page.waitForTimeout(2100);
  expect(cloudRequests).toBe(0);
  const started = Date.now();
  await page.getByRole("button", { name: "计算", exact: true }).click();
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          JSON.parse(localStorage.getItem("excalidraw") || "[]").some(
            (element: {
              isDeleted?: boolean;
              customData?: { fcWrittenText?: string };
            }) =>
              !element.isDeleted && element.customData?.fcWrittenText === "2",
          ),
        ),
      { timeout: 20000 },
    )
    .toBe(true);
  expect(cloudRequests).toBe(0);
  await testInfo.attach("local-ocr-timing", {
    body: JSON.stringify({ elapsedMs: Date.now() - started, cloudRequests }),
    contentType: "application/json",
  });
});
