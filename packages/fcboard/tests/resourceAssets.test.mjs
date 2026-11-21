import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";

import {
  resourceAssetAliases,
  resourceAssetPlugin,
} from "../../../config/resourceAssets.mjs";

const requireSdk = createRequire(new URL("../package.json", import.meta.url));
const sourceDirectory = path.dirname(requireSdk.resolve("./package.json"));
const fixture = () => {
  let resolveAsset;
  const loaders = new Map();
  resourceAssetPlugin.setup({
    onResolve(_, callback) {
      resolveAsset = callback;
    },
    onLoad({ namespace }, callback) {
      loaders.set(namespace, callback);
    },
  });
  return async (request) => {
    const resolved = resolveAsset({
      path: request,
      resolveDir: sourceDirectory,
    });
    return {
      resolved,
      loaded: await loaders.get(resolved.namespace)(resolved),
    };
  };
};

for (const [name, packageName, file] of [
  ["vega-offline-core", "vega", "vega.min.js"],
  ["vega-offline-lite", "vega-lite", "vega-lite.min.js"],
  ["vega-offline-embed", "vega-embed", "vega-embed.min.js"],
  ["jsxgraph-offline-core", "jsxgraph", "../distrib/jsxgraphcore.js"],
]) {
  test(`${name} loads the installed browser runtime as raw text for SDK and app`, async () => {
    const expected = path.resolve(
      path.dirname(requireSdk.resolve(packageName)),
      file,
    );
    const { resolved, loaded } = await fixture()(`${name}?raw`);
    assert.deepEqual(resolved, { path: expected, namespace: "fcboard-raw" });
    assert.equal(loaded.loader, "text");
    assert.equal(loaded.contents, await fs.readFile(expected, "utf8"));
    assert.ok(loaded.contents.length > 10000);
    const alias = resourceAssetAliases.find(({ find }) =>
      find.test(`${name}?raw`),
    );
    assert.equal(
      `${name}?raw`.replace(alias.find, alias.replacement),
      `${expected}?raw`,
    );
    assert.equal(alias.find.test(`${name}-other?raw`), false);
  });
}

test("ordinary relative raw JavaScript and URL images keep their real bytes", async () => {
  const load = fixture();
  const script = await load("./vendor/vega/compatibility.js?raw");
  assert.equal(script.loaded.loader, "text");
  assert.equal(
    script.loaded.contents,
    await fs.readFile(
      path.join(sourceDirectory, "vendor/vega/compatibility.js"),
      "utf8",
    ),
  );
  const imagePath = path.resolve(
    sourceDirectory,
    "../../app/fcboard/assets/multiscreen/ic_black_pen.svg",
  );
  const image = await load(
    "../../app/fcboard/assets/multiscreen/ic_black_pen.svg?url",
  );
  assert.deepEqual(image.resolved, {
    path: imagePath,
    namespace: "fcboard-asset",
  });
  assert.equal(image.loaded.loader, "file");
  assert.deepEqual(image.loaded.contents, await fs.readFile(imagePath));
});

test("a missing raw asset fails instead of returning an empty runtime", async () => {
  await assert.rejects(fixture()("./nonexistent-offline-runtime.js?raw"), {
    code: "ENOENT",
  });
});
