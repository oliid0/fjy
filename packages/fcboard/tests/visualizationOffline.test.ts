import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createContext, runInContext } from "node:vm";

import core from "vega-offline-core?raw";
import lite from "vega-offline-lite?raw";
import embed from "vega-offline-embed?raw";

import compatibility from "../vendor/vega/compatibility.js?raw";
import {
  createVisualizationView,
  inlineVisualizationLoader,
} from "../visualizationRuntime";

const require = createRequire(import.meta.url);

it("packages the exact pinned browser releases from installed modules", () => {
  for (const [name, file, text] of [
    ["vega", "vega.min.js", core],
    ["vega-lite", "vega-lite.min.js", lite],
    ["vega-embed", "vega-embed.min.js", embed],
  ]) {
    expect(text).toBe(
      fs.readFileSync(
        path.join(path.dirname(require.resolve(name)), file),
        "utf8",
      ),
    );
  }
});

it("executes the real offline browser releases with JavaScript code generation disabled", async () => {
  const target = document.createElement("div");
  const sandbox = createContext(
    {
      document,
      HTMLElement,
      target,
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      performance,
    },
    {
      codeGeneration: { strings: false, wasm: false },
    },
  );
  runInContext(`${compatibility}\n${core}\n${lite}\n${embed}`, sandbox);
  const svg = await runInContext(
    `
    vegaEmbed(target, {
      data: {values:[{x:1},{x:2}]},
      transform:[{calculate:'datum.x*datum.x',as:'y'}],
      mark:'bar',encoding:{x:{field:'x',type:'ordinal'},y:{field:'y',type:'quantitative'}}
    },{mode:'vega-lite',renderer:'svg',actions:false,defaultStyle:false,tooltip:false,ast:true})
      .then(async function(result){try{return await result.view.toSVG()}finally{result.finalize()}})
  `,
    sandbox,
  );
  expect(svg).toContain('role="graphics-symbol"');
  expect(target.querySelectorAll(".role-mark path")).toHaveLength(2);
});

it("uses the package interpreter in the host and refuses network and filesystem loading", async () => {
  const loader = inlineVisualizationLoader();
  await expect(loader.load("https://example.test/data.csv")).rejects.toThrow();
  await expect(
    loader.http("https://example.test/data.csv", {}),
  ).rejects.toThrow();
  await expect(loader.file("/tmp/data.csv")).rejects.toThrow();
  const target = document.createElement("div");
  const original = globalThis.Function;
  vi.stubGlobal("Function", () => {
    throw new Error("Dynamic code disabled");
  });
  try {
    const result = await createVisualizationView(target, {
      mode: "vega",
      spec: {
        width: 100,
        height: 100,
        data: [
          {
            name: "values",
            values: [{ x: 2 }],
            transform: [{ type: "formula", expr: "datum.x*datum.x", as: "y" }],
          },
        ],
        marks: [
          {
            type: "rect",
            from: { data: "values" },
            encode: {
              update: {
                x: { value: 0 },
                y: { value: 0 },
                width: { field: "y" },
                height: { value: 10 },
              },
            },
          },
        ],
      },
    });
    try {
      expect(await result.view.toSVG()).toContain('d="M0,0h4v10h-4Z"');
    } finally {
      result.finalize();
    }
  } finally {
    vi.stubGlobal("Function", original);
  }
});
