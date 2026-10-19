import { defineConfig } from "@playwright/test";

import config from "./playwright.config";

export default defineConfig({
  ...config,
  outputDir: "./test-results/scrcpy",
  testIgnore: [],
  testMatch: "**/remote-stream.spec.ts",
});
