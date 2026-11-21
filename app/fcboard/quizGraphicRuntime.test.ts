import { createRequire } from "node:module";

import { waitFor } from "@testing-library/react";
import { resourceHtml } from "@fcboard/fcboard/resourceHtml";

import type { InteractiveResource } from "@fcboard/fcboard/interactiveHtml";

import runtime from "./quizGraphicRuntime.js?raw";

const require = createRequire(import.meta.url);
const cssEscape = require("css.escape") as (value: string) => string;
const { JSDOM } = require("jsdom") as {
  JSDOM: new (
    html: string,
    options: {
      runScripts: "dangerously";
      beforeParse: (window: Window & typeof globalThis) => void;
    },
  ) => { window: Window & typeof globalThis };
};

/** Execute the real bundled engines and snapshot script on fixed fixtures.
 * jsdom lacks layout/image decoding: only those browser surfaces are supplied;
 * serialized SVG is inspected before the test-only PNG encoder stand-in. */
const open = async (
  resource: InteractiveResource,
  white = false,
  pausedFrames = false,
) => {
  const exported: string[] = [];
  const packets: {
    type: string;
    channel: string;
    dataURL?: string;
    error?: string;
  }[] = [];
  const draws = vi.fn();
  const context = {
    fillStyle: "",
    fillRect: vi.fn(),
    drawImage: draws,
    measureText: (text: string) => ({ width: text.length * 8 }),
    getImageData: () => ({
      data: new Uint8ClampedArray(
        white ? [255, 255, 255, 255] : [0, 0, 0, 255],
      ),
    }),
  };
  const html = await resourceHtml(resource, [
    { name: "quiz-snapshot:test-channel", code: runtime },
  ]);
  const frame = new JSDOM(html, {
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
      window.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
      window.requestAnimationFrame = (callback) =>
        pausedFrames ? 0 : window.setTimeout(() => callback(0), 0);
      window.cancelAnimationFrame = (id) => window.clearTimeout(id);
      window.Element.prototype.getBoundingClientRect = function () {
        const owner = this.closest<HTMLElement>("[data-fc-graphics]");
        const width =
          parseFloat(this.getAttribute("width") || "") ||
          parseFloat(owner?.style.width || "") ||
          600;
        const height =
          parseFloat(this.getAttribute("height") || "") ||
          parseFloat(owner?.style.height || "") ||
          400;
        const left = parseFloat(owner?.style.left || "") || 0;
        return new window.DOMRect(left, 0, width, height);
      };
      Object.assign(window.SVGElement.prototype, {
        getBBox() {
          return { x: 0, y: 0, width: 40, height: 16 };
        },
      });
      window.HTMLCanvasElement.prototype.getContext = (() =>
        context) as unknown as HTMLCanvasElement["getContext"];
      window.HTMLCanvasElement.prototype.toBlob = (callback) => {
        window.setTimeout(
          () => callback(new window.Blob(["abc"], { type: "image/png" })),
          0,
        );
      };
      const OriginalImage = window.Image;
      window.Image = function () {
        const image = new OriginalImage();
        let source = "";
        Object.defineProperty(image, "src", {
          get: () => source,
          set(value: string) {
            source = value;
            exported.push(
              decodeURIComponent(value.split(",").slice(1).join(",")),
            );
            window.queueMicrotask(() =>
              image.onload?.call(image, new window.Event("load")),
            );
          },
        });
        return image;
      } as unknown as typeof window.Image;
      window.postMessage = ((data: typeof packets[number]) =>
        packets.push(data)) as typeof window.postMessage;
      window.eval = () => {
        throw new Error("Dynamic eval disabled");
      };
      window.Function = function () {
        throw new Error("Dynamic compilation disabled");
      } as unknown as FunctionConstructor;
    },
  });
  return { window: frame.window, exported, packets, draws };
};

const geometry: InteractiveResource = {
  id: "dependent-figure",
  title: "Dependent geometry",
  libraries: ["jsxgraph"],
  html: `<html><head><title>Dependent geometry</title></head><body><div id="board" data-fc-graphics style="width:600px;height:400px"></div><script>
    var board=JXG.JSXGraph.initBoard('board',{renderer:'svg',boundingbox:[-4,4,4,-4],showNavigation:false,showCopyright:false,resize:{enabled:false}});
    var A=board.create('point',[1,2],{name:'A'});
    board.create('functiongraph',['x^2-1']);
    board.create('text',[-3,3,'AB = 3 cm']);
    window.figure={board:board,A:A};
    document.dispatchEvent(new Event('fc-figure-ready'));
  </script></body></html>`,
};

it.each([false, true])(
  "exports actual JSXGraph construction paths and labels when hidden frames are paused=%s",
  async (pausedFrames) => {
    const frame = await open(geometry, false, pausedFrames);
    try {
      await waitFor(() => expect(frame.packets).toHaveLength(1));
      expect(frame.packets[0]).toEqual({
        type: "quiz-graphic",
        channel: "test-channel",
        dataURL: "data:image/png;base64,YWJj",
      });
      expect(frame.draws).toHaveBeenCalledTimes(1);
      const svg = new DOMParser().parseFromString(
        frame.exported[0],
        "image/svg+xml",
      );
      expect(svg.querySelector("parsererror")).toBeNull();
      expect(svg.querySelectorAll("path").length).toBeGreaterThan(1);
      expect(svg.documentElement.textContent).toContain("AB = 3 cm");
      expect(svg.documentElement.textContent).toContain("A");
      expect(svg.querySelector("foreignObject")).toBeNull();
      expect(svg.documentElement.getAttribute("width")).toBe("1200");
      frame.window.dispatchEvent(new frame.window.Event("pagehide"));
      expect(
        Object.keys(
          (frame.window as unknown as { JXG: { boards: object } }).JXG.boards,
        ),
      ).toHaveLength(0);
    } finally {
      frame.window.close();
    }
  },
);

it("waits for a real asynchronous Vega chart and exports both figures in a combined engine construction", async () => {
  const frame = await open({
    ...geometry,
    libraries: ["vega", "jsxgraph"],
    html: `<html><head><title>Two figures</title></head><body>
      <div id="chart" data-fc-graphics style="width:280px;height:280px"></div>
      <div id="board" data-fc-graphics style="width:280px;height:280px;left:300px"></div><script>
      var board=JXG.JSXGraph.initBoard('board',{renderer:'svg',boundingbox:[-4,4,4,-4],showNavigation:false,showCopyright:false,resize:{enabled:false}});
      board.create('point',[1,2],{name:'P'});
      vegaEmbed('#chart',{data:{values:[{name:'Apples',value:2},{name:'Pears',value:3}]},mark:'bar',width:180,height:180,encoding:{x:{field:'name',type:'nominal'},y:{field:'value',type:'quantitative'}}},{renderer:'svg',actions:false}).then(function(){document.dispatchEvent(new Event('fc-figure-ready'))});
      </script></body></html>`,
  });
  try {
    await waitFor(() => expect(frame.packets).toHaveLength(1));
    expect(frame.packets[0].error).toBeUndefined();
    expect(frame.draws).toHaveBeenCalledTimes(2);
    expect(frame.exported.join("\n")).toContain("Apples");
    expect(frame.exported.join("\n")).toContain("Pears");
    expect(frame.exported.some((svg) => /<text[^>]*>P<\/text>/.test(svg))).toBe(
      true,
    );
  } finally {
    frame.window.close();
  }
});

it.each<[string, boolean, string]>([
  [
    '<svg width="100" height="100"><text x="5" y="20">x</text></svg><span>AB = 3 cm</span>',
    false,
    "labels must be drawn inside",
  ],
  [
    '<svg width="100" height="100"><text x="5" y="20">x</text></svg>',
    true,
    "blank",
  ],
])(
  "rejects missing exported labels or blank pixels: %s",
  async (body, white, error) => {
    const frame = await open(
      { id: "bad", title: "Bad", html: `<html><body>${body}</body></html>` },
      white,
    );
    try {
      await waitFor(() => expect(frame.packets).toHaveLength(1));
      expect(frame.packets[0].error).toContain(error);
      expect(frame.packets[0].dataURL).toBeUndefined();
    } finally {
      frame.window.close();
    }
  },
);
