import path from "path";
import { rm } from "node:fs/promises";

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import svgrPlugin from "vite-plugin-svgr";
import { ViteEjsPlugin } from "vite-plugin-ejs";
import { VitePWA } from "vite-plugin-pwa";
import checker from "vite-plugin-checker";
import { createHtmlPlugin } from "vite-plugin-html";
import Sitemap from "vite-plugin-sitemap";

import { vegaAssetAliases } from "../config/vegaAssets";
import { assertClientRuntimeBoundary } from "../config/clientRuntimeBoundary";
import { assertNativeInferenceBoundary } from "../config/nativeInferenceBoundary";

import { woff2BrowserPlugin } from "../scripts/woff2/woff2-vite-plugins";
export default defineConfig(({ mode }) => {
  const nativeInference = process.env.VITE_NATIVE_INFERENCE === "true";
  // To load .env variables
  const envDir = path.resolve(__dirname, "../config");
  const envVars = loadEnv(mode, envDir);
  // https://vitejs.dev/config/
  return {
    define: {
      "import.meta.env.VITE_NATIVE_INFERENCE": JSON.stringify(
        nativeInference ? "true" : "false",
      ),
    },
    server: {
      port: Number(envVars.VITE_APP_PORT || 3000),
      // open the browser
      open: true,
    },
    envDir,
    worker: { format: "es" },
    resolve: {
      alias: [
        ...vegaAssetAliases,
        {
          find: /^@fcboard\/common$/,
          replacement: path.resolve(
            __dirname,
            "../packages/common/src/index.ts",
          ),
        },
        {
          find: /^@fcboard\/common\/(.*?)/,
          replacement: path.resolve(__dirname, "../packages/common/src/$1"),
        },
        {
          find: /^@fcboard\/element$/,
          replacement: path.resolve(
            __dirname,
            "../packages/element/src/index.ts",
          ),
        },
        {
          find: /^@fcboard\/element\/(.*?)/,
          replacement: path.resolve(__dirname, "../packages/element/src/$1"),
        },
        {
          find: /^@fcboard\/fcboard$/,
          replacement: path.resolve(__dirname, "../packages/fcboard/index.tsx"),
        },
        {
          find: /^@fcboard\/fcboard\/(.*?)/,
          replacement: path.resolve(__dirname, "../packages/fcboard/$1"),
        },
        {
          find: /^@fcboard\/math$/,
          replacement: path.resolve(__dirname, "../packages/math/src/index.ts"),
        },
        {
          find: /^@fcboard\/math\/(.*?)/,
          replacement: path.resolve(__dirname, "../packages/math/src/$1"),
        },
        {
          find: /^@fcboard\/utils$/,
          replacement: path.resolve(
            __dirname,
            "../packages/utils/src/index.ts",
          ),
        },
        {
          find: /^@fcboard\/utils\/(.*?)/,
          replacement: path.resolve(__dirname, "../packages/utils/src/$1"),
        },
      ],
    },
    build: {
      outDir: nativeInference ? "build-android" : "build",
      rollupOptions: {
        input: {
          app: path.resolve(__dirname, "index.html"),
        },
        output: {
          // Keep shared geometry dependencies out of inference chunks. Otherwise
          // the UI's clipper-lib import also initializes OpenCV's embedded WASM.
          onlyExplicitManualChunks: true,
          assetFileNames(chunkInfo) {
            if (chunkInfo?.name?.endsWith(".woff2")) {
              const family = chunkInfo.name.split("-")[0];
              return `fonts/${family}/[name][extname]`;
            }

            return "assets/[name]-[hash][extname]";
          },
          // Creating separate chunk for locales except for en and percentages.json so they
          // can be cached at runtime and not merged with
          // app precache. en.json and percentages.json are needed for first load
          // or fallback hence not clubbing with locales so first load followed by offline mode works fine. This is how CRA used to work too.
          manualChunks(id) {
            if (
              id.includes("@paddleocr/paddleocr-js") ||
              id.includes("@techstark/opencv-js") ||
              id.includes("onnxruntime-web")
            ) {
              return "fcboard-ocr.chunk";
            }
            if (
              id.includes("/node_modules/mathjs/") ||
              id.includes("/node_modules/nerdamer/")
            ) {
              return "fcboard-math";
            }
            if (
              id.includes("packages/fcboard/locales") &&
              id.match(/en.json|percentages.json/) === null
            ) {
              const index = id.indexOf("locales/");
              // Taking the substring after "locales/"
              return `locales/${id.substring(index + 8)}`;
            }

            if (id.includes("@excalidraw/mermaid-to-excalidraw")) {
              return "mermaid-to-fcboard";
            }

            if (id.includes("@codemirror/") || id.includes("@lezer/")) {
              return "codemirror.chunk";
            }
          },
        },
      },
      sourcemap: envVars.VITE_APP_DISABLE_SENTRY !== "true",
      // Keep small toolbar vectors/sprites in their owning bundle, ready at first paint.
      assetsInlineLimit: 8192,
    },
    plugins: [
      {
        name: "fcboard-client-runtime-boundary",
        apply: "build",
        async writeBundle(options) {
          if (nativeInference && options.dir) {
            await Promise.all(
              ["ocr", "local-models", "dictionary"].map((name) =>
                rm(path.join(options.dir!, name), {
                  recursive: true,
                  force: true,
                }),
              ),
            );
          }
        },
        generateBundle(_options, bundle) {
          assertClientRuntimeBoundary(bundle);
          if (nativeInference) {
            assertNativeInferenceBoundary(bundle);
          }
        },
      },
      Sitemap({
        hostname: "http://www.fcjyboard.com",
        outDir: nativeInference ? "build-android" : "build",
        changefreq: "monthly",
        // its static in public folder
        generateRobotsTxt: false,
      }),
      woff2BrowserPlugin(),
      react(),
      checker({
        typescript: true,
        eslint:
          envVars.VITE_APP_ENABLE_ESLINT === "false"
            ? undefined
            : { lintCommand: 'eslint "./**/*.{js,ts,tsx}"' },
        overlay: {
          initialIsOpen: envVars.VITE_APP_COLLAPSE_OVERLAY === "false",
          badgeStyle: "margin-bottom: 4rem; margin-left: 1rem",
        },
      }),
      svgrPlugin(),
      ViteEjsPlugin(),
      VitePWA({
        registerType: "autoUpdate",
        devOptions: {
          /* set this flag to true to enable in Development mode */
          enabled: envVars.VITE_APP_ENABLE_PWA === "true",
        },

        workbox: {
          // don't precache fonts, locales and separate chunks
          globIgnores: [
            "**/ocr/**",
            "**/local-models/**",
            // The SDK also emits its default worker/runtime, but localOcr uses
            // the checksum-pinned /ocr/ copies. Never download these duplicates
            // during service-worker installation.
            "**/worker-entry-*.js",
            "**/ort-wasm-*",
            "fonts.css",
            "**/locales/**",
            "service-worker.js",
            "**/*.chunk-*.js",
            // CodeMirrorEditor can't be assigned a `.chunk` name via
            // manualChunks because Rollup would hoist shared deps (React)
            // via a static import from the main bundle, defeating lazy
            // loading. So we exclude it by name instead.
            "**/CodeMirrorEditor-*.js",
          ],
          runtimeCaching: [
            {
              urlPattern: ({ url }) =>
                url.origin === self.location.origin &&
                url.pathname.includes("/ocr/"),
              handler: "CacheFirst",
              options: {
                cacheName: "fcboard-ocr-0.4.2",
                expiration: {
                  maxEntries: 12,
                  maxAgeSeconds: 60 * 60 * 24 * 90,
                },
              },
            },
            {
              urlPattern: new RegExp(".+.woff2"),
              handler: "CacheFirst",
              options: {
                cacheName: "fonts",
                expiration: {
                  maxEntries: 1000,
                  maxAgeSeconds: 60 * 60 * 24 * 90, // 90 days
                },
                cacheableResponse: {
                  // 0 to cache "opaque" responses from cross-origin requests (i.e. CDN)
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: new RegExp("fonts.css"),
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "fonts",
                expiration: {
                  maxEntries: 50,
                },
              },
            },
            {
              urlPattern: new RegExp("locales/[^/]+.js"),
              handler: "CacheFirst",
              options: {
                cacheName: "locales",
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 60 * 60 * 24 * 30, // <== 30 days
                },
              },
            },
            {
              urlPattern: new RegExp("(.chunk-.+|CodeMirrorEditor-.+)\\.js"),
              handler: "CacheFirst",
              options: {
                cacheName: "chunk",
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 60 * 60 * 24 * 90, // <== 90 days
                },
              },
            },
          ],
          // Precache the measured 6.32 MB UI bundle (including first-paint SVGs)
          // and the 5.15 MB Office engine. Model/worker exclusions stay above.
          maximumFileSizeToCacheInBytes: 8 * 1024 ** 2,
        },
        manifest: {
          short_name: "Fcboard",
          name: "Fcboard",
          description: "教学与会议智能白板。",
          icons: [
            {
              src: "fcboard.svg",
              sizes: "any",
              type: "image/svg+xml",
              purpose: "any",
            },
            {
              src: "android-chrome-192x192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "android-chrome-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "maskable_icon_x192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "maskable",
            },
            {
              src: "maskable_icon_x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
          start_url: "/",
          id: "fcboard",
          display: "standalone",
          theme_color: "#121212",
          background_color: "#ffffff",
          file_handlers: [
            {
              action: "/",
              accept: {
                "application/vnd.fcboard+json": [".fcboard"],
              },
            },
          ],
          share_target: {
            action: "/web-share-target",
            method: "POST",
            enctype: "multipart/form-data",
            params: {
              files: [
                {
                  name: "file",
                  accept: [
                    "application/vnd.fcboard+json",
                    "application/json",
                    ".fcboard",
                  ],
                },
              ],
            },
          },
        },
      }),
      createHtmlPlugin({
        minify: true,
      }),
    ],
    publicDir: "../public",
  };
});
