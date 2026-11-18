import { createRequire } from "node:module";

import { resourceHtml } from "../resourceHtml";
import { validateInteractiveResource } from "../interactiveHtml";

import type { InteractiveResource } from "../interactiveHtml";

const cssEscape = createRequire(import.meta.url)("css.escape") as (
  value: string,
) => string;

const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (
    html: string,
    options: {
      runScripts: "dangerously";
      beforeParse?: (window: Window & typeof globalThis) => void;
    },
  ) => { window: Window & typeof globalThis };
};
const resource: InteractiveResource = {
  id: "geometry",
  title: "Dependent geometry",
  libraries: ["jsxgraph"],
  html: `<html><body><h1>Dependent geometry</h1><div id="board" data-fc-graphics style="width:600px;height:400px"></div><script>
    var board=JXG.JSXGraph.initBoard('board',{renderer:'svg',boundingbox:[-4,4,4,-4],showNavigation:false,showCopyright:false,resize:{enabled:false}});
    var A=board.create('point',[0,0],{name:'A'});
    var C=board.create('circle',[A,2]);
    var L=board.create('line',[[0,-3],[0,3]]);
    var I=board.create('intersection',[C,L,0],{name:'I'});
    var F=board.create('functiongraph',['sin(x)']);
    window.geometry={board:board,A:A,I:I,F:F,formula:board.jc.snippet('x^2+1',true,'x')};
  </script></body></html>`,
};

const open = (html: string) =>
  new JSDOM(html, {
    runScripts: "dangerously",
    beforeParse(window) {
      window.CSS = { escape: cssEscape } as typeof CSS;
      window.matchMedia = (media) =>
        Object.assign(new window.EventTarget(), {
          media,
          matches: false,
          onchange: null,
          addListener() {},
          removeListener() {},
        });
      window.eval = () => {
        throw new Error("Dynamic eval disabled");
      };
      window.Function = function () {
        throw new Error("Dynamic compilation disabled");
      } as unknown as FunctionConstructor;
      // jsdom has no layout engine. Supply the fixed fixture's actual CSS size.
      window.HTMLElement.prototype.getBoundingClientRect = function () {
        const width = parseFloat(this.style.width) || 600;
        const height = parseFloat(this.style.height) || 400;
        return {
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          right: width,
          bottom: height,
          width,
          height,
          toJSON: () => ({}),
        };
      };
    },
  });

it("loads the installed JSXGraph runtime only in the declared sandbox, interprets real terms and recomputes dependent geometry", async () => {
  const html = await resourceHtml(resource);
  const parsed = new DOMParser().parseFromString(html, "text/html");
  expect(
    [...parsed.querySelectorAll("[data-fc-library]")].map((script) =>
      script.getAttribute("data-fc-library"),
    ),
  ).toEqual(["resource-errors", "jsxgraph", "jsxgraph-config"]);
  expect(parsed.querySelector("script[src]")).toBeNull();
  expect(
    parsed
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute("content"),
  ).not.toContain("unsafe-eval");
  expect(html).toContain("JSXGraph 1.14.3");
  const frame = open(html);
  const window = frame.window as typeof frame.window & {
    JXG: {
      version: string;
      COORDS_BY_USER: number;
      boards: Record<string, unknown>;
    };
    geometry: {
      board: { update: () => void };
      A: { setPosition: (kind: number, point: number[]) => void };
      I: { X: () => number; Y: () => number };
      F: { points: unknown[] };
      formula: (x: number) => number;
    };
  };
  try {
    expect(window.JXG.version).toBe("1.14.3");
    expect(window.geometry.formula(3)).toBe(10);
    expect(window.geometry.I.X()).toBeCloseTo(0);
    expect(Math.abs(window.geometry.I.Y())).toBeCloseTo(2);
    expect(window.geometry.F.points.length).toBeGreaterThan(10);
    expect(window.document.querySelectorAll("svg path").length).toBeGreaterThan(
      1,
    );
    window.geometry.A.setPosition(window.JXG.COORDS_BY_USER, [1, 0]);
    window.geometry.board.update();
    expect(Math.abs(window.geometry.I.Y())).toBeCloseTo(Math.sqrt(3), 6);
    window.dispatchEvent(new window.Event("pagehide"));
    expect(Object.keys(window.JXG.boards)).toHaveLength(0);
  } finally {
    window.close();
  }
});

it("loads both engines before authored scripts without replacing either capability", async () => {
  const html = await resourceHtml({
    ...resource,
    libraries: ["vega", "jsxgraph"],
  });
  const document = new DOMParser().parseFromString(html, "text/html");
  const libraries = [...document.querySelectorAll("[data-fc-library]")].map(
    (script) => script.getAttribute("data-fc-library"),
  );
  expect(libraries).toEqual(
    expect.arrayContaining([
      "vega-0",
      "vega-1",
      "vega-2",
      "vega-3",
      "vega-config",
      "jsxgraph",
      "jsxgraph-config",
    ]),
  );
  expect(document.head.querySelectorAll("[data-fc-library]")).toHaveLength(8);
  expect(document.body.querySelector("script")!.textContent).toContain(
    "JXG.JSXGraph.initBoard",
  );
  const combined = await resourceHtml({
    ...resource,
    libraries: ["vega", "jsxgraph"],
    html: resource.html.replace(
      "</body>",
      `<div id="chart" data-fc-graphics></div><script>
        window.chartReady=vegaEmbed('#chart',{
          data:{values:[{x:'A',y:2},{x:'B',y:5}]},mark:'bar',
          encoding:{x:{field:'x',type:'nominal'},y:{field:'y',type:'quantitative'}}
        },{renderer:'svg',actions:false});
      </script></body>`,
    ),
  });
  const frame = open(combined);
  const window = frame.window as typeof frame.window & {
    chartReady: Promise<{ finalize: () => void }>;
    geometry: { formula: (x: number) => number };
  };
  let chart: Awaited<typeof window.chartReady> | undefined;
  try {
    chart = await window.chartReady;
    expect(window.geometry.formula(2)).toBe(5);
    expect(
      window.document.querySelectorAll("#chart .role-mark path"),
    ).toHaveLength(2);
    expect(window.document.querySelector("#board svg")).not.toBeNull();
  } finally {
    chart?.finalize();
    window.dispatchEvent(new window.Event("pagehide"));
    window.close();
  }
});

it("constructs real 3D points and curves from the installed package and updates dependent coordinates", async () => {
  const html = await resourceHtml({
    ...resource,
    html: `<html><body><h1>3D dependencies</h1><div id="board" data-fc-graphics style="width:600px;height:400px"></div><script>
      var board=JXG.JSXGraph.initBoard('board',{renderer:'svg',boundingbox:[-8,8,8,-8],showNavigation:false,showCopyright:false,resize:{enabled:false}});
      var view=board.create('view3d',[[-6,-3],[8,8],[[0,3],[0,3],[0,3]]],{});
      var P=view.create('point3d',[1,1,1],{name:'P'});
      var Q=view.create('point3d',[function(){return P.X()+1},function(){return P.Y()},function(){return P.Z()*2}],{name:'Q'});
      var curve=view.create('curve3d',[function(t){return 1+t*t},function(t){return 1+t},function(t){return 1-t*t},[-1,1]]);
      window.spatial={board:board,P:P,Q:Q,curve:curve};
    </script></body></html>`,
  });
  const frame = open(html);
  const window = frame.window as typeof frame.window & {
    JXG: { boards: Record<string, unknown> };
    spatial: {
      board: { update: () => void };
      P: { setPosition: (coords: number[]) => void };
      Q: {
        X: () => number;
        Y: () => number;
        Z: () => number;
        element2D: { X: () => number };
      };
      curve: { element2D: { dataX: number[] } };
    };
  };
  try {
    const { P, Q, board, curve } = window.spatial;
    expect([Q.X(), Q.Y(), Q.Z()]).toEqual([2, 1, 2]);
    P.setPosition([1, 2, 0.5]);
    board.update();
    expect([Q.X(), Q.Y(), Q.Z()]).toEqual([2, 2, 1]);
    expect(Number.isFinite(Q.element2D.X())).toBe(true);
    expect(curve.element2D.dataX.length).toBeGreaterThan(5);
    window.dispatchEvent(new window.Event("pagehide"));
    expect(Object.keys(window.JXG.boards)).toHaveLength(0);
  } finally {
    window.close();
  }
});

it("persists explicit JSON/HTML declarations and rejects unknown engines instead of pretending to provide them", () => {
  const value = validateInteractiveResource({
    ...resource,
    libraries: undefined,
    html: resource.html.replace(
      "<html>",
      '<html><head><meta name="fc-libraries" content="jsxgraph,vega"></head>',
    ),
  });
  expect(value.libraries).toEqual(["jsxgraph", "vega"]);
  expect(value.html).not.toContain('name="fc-libraries"');
  expect(validateInteractiveResource(value)).toEqual(value);
  expect(() =>
    validateInteractiveResource({ ...resource, libraries: ["phet"] }),
  ).toThrow("Unsupported");
  expect(() =>
    validateInteractiveResource({ ...resource, libraries: "jsxgraph" }),
  ).toThrow("Invalid");
});

it("keeps plain resources immediate and does not inject an unused engine", async () => {
  const html = await resourceHtml({
    id: "plain",
    title: "Plain",
    html: "<h1>Plain</h1><svg><circle r='2'/></svg>",
  });
  expect(html).not.toContain("data-fc-library");
  expect(html.length).toBeLessThan(120000);
});

it("shows actual authored initialization and async errors instead of a silently blank engine scene", async () => {
  const html = await resourceHtml({
    ...resource,
    html: `<html><body><h1>Invalid scene</h1><div data-fc-graphics></div><script>dispatchEvent(new ErrorEvent('error',{message:'Invalid point dependency'}));</script></body></html>`,
  });
  const { window } = open(html);
  try {
    expect(window.document.querySelector('[role="alert"]')?.textContent).toBe(
      "Invalid point dependency",
    );
    const failure = new window.Event("unhandledrejection");
    Object.defineProperty(failure, "reason", {
      value: new Error("Geometry update failed"),
    });
    window.dispatchEvent(failure);
    expect(window.document.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(window.document.querySelector('[role="alert"]')?.textContent).toBe(
      "Geometry update failed",
    );
  } finally {
    window.close();
  }
});
