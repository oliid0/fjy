import { defineConfig } from "@playwright/test";

import config from "./playwright.config";

export default defineConfig({
  ...config,
  testIgnore: [],
  testMatch: "**/remote-stream.spec.ts",
});
