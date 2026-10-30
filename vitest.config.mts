import path from "path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "source-sdk-directory-entry",
      enforce: "pre",
      resolveId(id, importer) {
        if (
          importer &&
          id.startsWith(".") &&
          path.resolve(path.dirname(importer.split("?")[0]), id) ===
            path.resolve(__dirname, "packages/fcboard")
        ) {
          return path.resolve(__dirname, "packages/fcboard/index.tsx");
        }
      },
    },
  ],
  resolve: {
    alias: [
      {
        find: /^@fcboard\/common$/,
        replacement: path.resolve(__dirname, "./packages/common/src/index.ts"),
      },
      {
        find: /^@fcboard\/common\/(.*?)/,
        replacement: path.resolve(__dirname, "./packages/common/src/$1"),
      },
      {
        find: /^@fcboard\/element$/,
        replacement: path.resolve(__dirname, "./packages/element/src/index.ts"),
      },
      {
        find: /^@fcboard\/element\/(.*?)/,
        replacement: path.resolve(__dirname, "./packages/element/src/$1"),
      },
      {
        find: /^@fcboard\/fcboard$/,
        replacement: path.resolve(__dirname, "./packages/fcboard/index.tsx"),
      },
      {
        find: /^@fcboard\/fcboard\/(.*?)/,
        replacement: path.resolve(__dirname, "./packages/fcboard/$1"),
      },
      {
        find: /^@fcboard\/math$/,
        replacement: path.resolve(__dirname, "./packages/math/src/index.ts"),
      },
      {
        find: /^@fcboard\/math\/(.*?)/,
        replacement: path.resolve(__dirname, "./packages/math/src/$1"),
      },
      {
        find: /^@fcboard\/utils$/,
        replacement: path.resolve(__dirname, "./packages/utils/src/index.ts"),
      },
      {
        find: /^@fcboard\/utils\/(.*?)/,
        replacement: path.resolve(__dirname, "./packages/utils/src/$1"),
      },
    ],
  },
  //@ts-ignore
  test: {
    include: [
      "packages/**/*.{test,spec}.{ts,tsx}",
      "app/**/*.{test,spec}.{ts,tsx}",
    ],
    // Since hooks are running in stack in v2, which means all hooks run serially whereas
    // we need to run them in parallel
    sequence: {
      hooks: "parallel",
    },
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    minWorkers: 1,
    maxWorkers: 2,
    environment: "jsdom",
    coverage: {
      reporter: ["text", "json-summary", "json", "html", "lcovonly"],
      // Since v2, it ignores empty lines by default and we need to disable it as it affects the coverage
      // Additionally the thresholds also needs to be updated slightly as a result of this change
      ignoreEmptyLines: false,
      thresholds: {
        lines: 60,
        branches: 70,
        functions: 63,
        statements: 60,
      },
    },
  },
});
