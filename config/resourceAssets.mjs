import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireSdk = createRequire(
  new URL("../packages/fcboard/package.json", import.meta.url),
);

/** Resolve pinned installed browser bundles once for the app, tests and SDK. */
export const resourceAssetAliases = [
  ["vega-offline-core", "vega", "vega.min.js"],
  ["vega-offline-lite", "vega-lite", "vega-lite.min.js"],
  ["vega-offline-embed", "vega-embed", "vega-embed.min.js"],
  ["jsxgraph-offline-core", "jsxgraph", "../distrib/jsxgraphcore.js"],
].map(([find, packageName, file]) => ({
  find: new RegExp(`^${find}(?=\\?|$)`),
  replacement: path.join(path.dirname(requireSdk.resolve(packageName)), file),
}));

export const resourceAssetPlugin = {
  name: "fcboard-asset-queries",
  setup(context) {
    context.onResolve({ filter: /\?(raw|url)$/ }, (args) => {
      const request = args.path.replace(/\?(raw|url)$/, "");
      const alias = resourceAssetAliases.find(({ find }) => find.test(request));
      return {
        path: alias
          ? request.replace(alias.find, alias.replacement)
          : path.resolve(args.resolveDir, request),
        namespace: args.path.endsWith("?raw") ? "fcboard-raw" : "fcboard-asset",
      };
    });
    context.onLoad(
      { filter: /.*/, namespace: "fcboard-raw" },
      async (args) => ({
        contents: await fs.promises.readFile(args.path, "utf8"),
        loader: "text",
      }),
    );
    context.onLoad(
      { filter: /.*/, namespace: "fcboard-asset" },
      async (args) => ({
        contents: await fs.promises.readFile(args.path),
        loader: "file",
      }),
    );
  },
};
