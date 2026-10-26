import { expect } from "@playwright/test";

import type { Page } from "@playwright/test";

/** CI supplies speech results at the browser provider boundary, through the real UI. */
export const dictateQuestion = async (page: Page, text: string) => {
  await page.evaluate((transcript) => {
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: class {
        onresult: ((event: unknown) => void) | null = null;
        start() {
          queueMicrotask(() =>
            this.onresult?.({
              resultIndex: 0,
              results: [{ isFinal: true, 0: { transcript } }],
            }),
          );
        }
        stop() {}
      },
    });
  }, text);
  await page.getByRole("button", { name: "语音录入问题", exact: true }).click();
  await expect(page.locator(".fc-ink-question-words")).toHaveText(text);
  await page.getByRole("button", { name: "发送问题", exact: true }).click();
};
