import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(
  new URL("../packages/fcboard/package.json", import.meta.url),
);

/** The packages restrict exports to module entries. Resolve their installed
 * build directories once; Vite embeds the original browser files as local text. */
export const vegaAssetAliases = [
  ["vega-offline-core", "vega", "vega.min.js"],
  ["vega-offline-lite", "vega-lite", "vega-lite.min.js"],
  ["vega-offline-embed", "vega-embed", "vega-embed.min.js"],
].map(([find, packageName, file]) => ({
  find: new RegExp(`^${find}(?=\\?|$)`),
  replacement: path.join(path.dirname(require.resolve(packageName)), file),
}));
