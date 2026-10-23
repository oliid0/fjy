import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import catalogue from "./factory-resources.json";

it("ships every referenced local resource and retains native subjects and online experiments", () => {
  const ids = catalogue.items.map((item) => item.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(new Set(catalogue.items.map((item) => item.category))).toEqual(
    new Set(["数学", "物理", "化学", "生物", "地理与天气", "网络资源"]),
  );
  for (const item of catalogue.items) {
    for (const asset of [
      Reflect.get(item, "asset"),
      Reflect.get(item, "cover"),
    ].filter((asset): asset is string => typeof asset === "string")) {
      const file = path.resolve("public", asset.slice(1));
      expect(existsSync(file)).toBe(true);
      expect(Array.from(readFileSync(file).subarray(0, 8))).toEqual([
        137, 80, 78, 71, 13, 10, 26, 10,
      ]);
    }
    const url = Reflect.get(item, "url");
    if (url) {
      expect([
        "phet.colorado.edu",
        "www.baidu.com",
        "www.zxxk.com",
        "www.geogebra.org",
      ]).toContain(new URL(url).hostname);
    }
  }
});
