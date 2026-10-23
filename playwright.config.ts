import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 60000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1920, height: 1080 },
    locale: "zh-CN",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm exec http-server app/build -a 127.0.0.1 -p 4173 --silent",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
  },
});
