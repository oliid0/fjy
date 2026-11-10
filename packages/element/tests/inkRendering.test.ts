import rough from "roughjs/bin/rough";
import { pointFrom } from "@fcboard/math";
import { toBrandedType } from "@fcboard/common";
import { exportToSvg } from "@fcboard/fcboard";

import type { LocalPoint } from "@fcboard/math";
import type { Radians } from "@fcboard/math";
import type {
  RenderableElementsMap,
  StaticCanvasRenderConfig,
} from "@fcboard/fcboard/scene/types";

import { nativeInkGradient, nativeInkPalettes } from "../src/nativeInkColor";

import { Scene } from "../src/Scene";
import { syncInvalidIndices } from "../src/fractionalIndex";

import { getDefaultAppState } from "../../fcboard/appState";
import { getNormalizedZoom } from "../../fcboard/scene";
import { API } from "../../fcboard/tests/helpers/api";
import { renderElement, elementWithCanvasCache } from "../src/renderElement";
import {
  factoryInkPath,
  factoryInkSamples,
  traceFactoryInk,
} from "../src/factoryInk";
import { factoryPath2D } from "../src/factoryPath";
import { factoryBrushPath } from "../src/factoryBrush";
import { rainbowInkCoordinates, rainbowInkStops } from "../src/rainbowInk";
import { getElementAbsoluteCoords } from "../src/bounds";
import { eraseStroke } from "../../fcboard/eraser/stroke";

describe("whiteboard vector ink", () => {
  it("retains signed subpixel samples across live vectors, erasure geometry and SVG while preserving older ink", async () => {
    const element = {
      ...API.createElement({
        type: "freedraw",
        points: [
          pointFrom<LocalPoint>(0, 0),
          pointFrom<LocalPoint>(-0.34, -0.44),
          pointFrom<LocalPoint>(0.62, 0.82),
        ],
        strokeWidth: 2,
      }),
      customData: {
        fcInk: { version: 2, pen: "hard", unit: 1, subpixel: true },
      },
    };
    const quadraticCurveTo = vi.fn();
    traceFactoryInk(element, {
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo,
    });
    expect(quadraticCurveTo.mock.calls[0]).toEqual([0, 0, -0.17, -0.22]);
    expect(factoryInkSamples(element).at(-1)).toMatchObject({
      x: 0.62,
      y: 0.82,
    });
    const precise = factoryInkPath(element);
    const live = factoryPath2D(element);
    expect(factoryPath2D(element)).toBe(live);
    const svg = await exportToSvg({
      elements: [element],
      appState: getDefaultAppState(),
      files: {},
    });
    expect(
      svg.querySelector("path[stroke-linecap='round']")?.getAttribute("d"),
    ).toBe(precise);
    element.customData.fcInk.subpixel = false;
    expect(factoryInkPath(element)).not.toBe(precise);
    expect(factoryPath2D(element)).not.toBe(live);
  });
  it.each([0, Math.PI / 3])(
    "keeps the board-wide rainbow colors through partial erasure and cropped SVG export at angle %s",
    async (angle) => {
      const element = {
        ...API.createElement({
          type: "freedraw",
          x: 100,
          y: 200,
          angle: angle as Radians,
          points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(800, 0)],
          strokeWidth: 4,
        }),
        customData: {
          fcInk: {
            version: 2,
            pen: "rainbow",
            rainbow: { x: 0, width: 1000 },
          },
        },
      };
      const parts = eraseStroke(
        element,
        { x: 500, y: 150 },
        { x: 500, y: 250 },
        10,
        10,
      )!;
      expect(parts).toHaveLength(2);
      for (const stroke of [element, ...parts]) {
        const [x1, y1, x2, y2] = rainbowInkCoordinates(stroke)!;
        const [, , , , cx, cy] = getElementAbsoluteCoords(stroke, new Map());
        const world = (x: number, y: number) => {
          const dx = x + stroke.x - cx;
          const dy = y + stroke.y - cy;
          return [
            cx + dx * Math.cos(stroke.angle) - dy * Math.sin(stroke.angle),
            cy + dx * Math.sin(stroke.angle) + dy * Math.cos(stroke.angle),
          ];
        };
        const start = world(x1, y1);
        const end = world(x2, y2);
        expect(start[0]).toBeCloseTo(0);
        expect(end[0]).toBeCloseTo(1000);
        expect(start[1]).toBeCloseTo(end[1]);
      }
      const svg = await exportToSvg({
        elements: parts,
        appState: getDefaultAppState(),
        files: {},
      });
      expect(svg.querySelectorAll("linearGradient")).toHaveLength(2);
      for (const part of parts) {
        const id = `rainbow-${part.id}`;
        const gradient = svg.querySelector(`[id='${id}']`)!;
        expect(gradient.getAttribute("gradientUnits")).toBe("userSpaceOnUse");
        expect(gradient.getAttribute("spreadMethod")).toBe("pad");
        expect(
          [...gradient.querySelectorAll("stop")].map((stop) => [
            Number(stop.getAttribute("offset")),
            stop.getAttribute("stop-color"),
          ]),
        ).toEqual(rainbowInkStops);
        expect(svg.querySelector(`path[stroke='url(#${id})']`)).not.toBeNull();
      }
    },
  );
  it("falls back to ordinary ink when imported rainbow coordinates are invalid", () => {
    const element = API.createElement({ type: "freedraw" });
    for (const rainbow of [
      undefined,
      { x: 0, width: 0 },
      { x: NaN, width: 10 },
      { x: Number.MAX_VALUE, width: Number.MAX_VALUE },
    ]) {
      expect(
        rainbowInkCoordinates({
          ...element,
          customData: { fcInk: { version: 2, pen: "rainbow", rainbow } },
        }),
      ).toBeNull();
    }
  });
  it("exports brush stamps as one filled vector so overlapping ellipses do not compound opacity", async () => {
    const element = {
      ...API.createElement({
        type: "freedraw",
        points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(100, 30)],
        strokeWidth: 15,
        opacity: 50,
      }),
      customData: { fcInk: { version: 3, pen: "brush", unit: 1 } },
    };
    const svg = await exportToSvg({
      elements: [element],
      appState: getDefaultAppState(),
      files: {},
    });
    const paths = [...svg.querySelectorAll("path")].filter(
      (path) => path.getAttribute("d") === factoryBrushPath(element),
    );
    expect(paths).toHaveLength(1);
    expect(paths[0].getAttribute("stroke")).not.toBe(element.strokeColor);
    expect(paths[0].getAttribute("fill")).toBe(element.strokeColor);
  });
  it("uses the APK midpoint quadratics and exports the same round-capped dashed vector path", async () => {
    const element = {
      ...API.createElement({
        type: "freedraw",
        points: [
          pointFrom<LocalPoint>(0, 0),
          pointFrom<LocalPoint>(10, 10),
          pointFrom<LocalPoint>(20, 0),
        ],
        strokeWidth: 4,
        strokeStyle: "dashed",
      }),
      customData: { fcInk: { version: 2, pen: "dashed", unit: 1 } },
    };
    expect(factoryInkPath(element)).toBe("M0,0 Q0,0 5,5 Q10,10 15,5 L20,0");
    const svg = await exportToSvg({
      elements: [element],
      appState: getDefaultAppState(),
      files: {},
    });
    const path = svg.querySelector("path[stroke-linecap='round']")!;
    expect(path.getAttribute("d")).toBe(factoryInkPath(element));
    expect(path.getAttribute("fill")).toBe("none");
    expect(path.getAttribute("stroke-width")).toBe("4");
    expect(path.getAttribute("stroke-dasharray")).toBe("8 10");
  });
  it.each(["legacy", "hard", "brush", "rainbow"])(
    "keeps %s ink as the same vector at every zoom without allocating per-element bitmaps",
    (pen) => {
      const element = {
        ...API.createElement({
          type: "freedraw",
          x: 20,
          y: 40,
          points: [
            pointFrom<LocalPoint>(0, 0),
            pointFrom<LocalPoint>(80, 20),
            pointFrom<LocalPoint>(160, 0),
          ],
          strokeWidth: 4,
        }),
        customData: {
          fcInk: {
            pen,
            version: pen === "brush" ? 3 : pen === "legacy" ? 1 : 2,
            unit: 1,
            rainbow: { x: 0, width: 1000 },
          },
        },
      };
      const scene = new Scene(syncInvalidIndices([element]));
      const map = scene.getNonDeletedElementsMap();
      const visible = toBrandedType<RenderableElementsMap>(map);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d")!;
      const draw = vi.spyOn(
        context,
        ["hard", "rainbow"].includes(pen) ? "stroke" : "fill",
      );
      const gradient = vi.spyOn(context, "createLinearGradient");
      const config: StaticCanvasRenderConfig = {
        imageCache: new Map(),
        renderGrid: false,
        isExporting: false,
        canvasBackgroundColor: "#ffffff",
        embedsValidationStatus: new Map(),
        elementsPendingErasure: new Set(),
        pendingFlowchartNodes: null,
        theme: "light",
      };
      for (const zoom of [0.25, 1, 4]) {
        renderElement(
          element,
          visible,
          map,
          rough.canvas(canvas),
          context,
          config,
          {
            ...getDefaultAppState(),
            width: 1000,
            height: 600,
            offsetLeft: 0,
            offsetTop: 0,
            zoom: { value: getNormalizedZoom(zoom) },
          },
        );
        expect(elementWithCanvasCache.has(element)).toBe(false);
      }
      expect(draw).toHaveBeenCalledTimes(3);
      expect(draw.mock.calls[0][0]).toBe(draw.mock.calls[1][0]);
      expect(draw.mock.calls[1][0]).toBe(draw.mock.calls[2][0]);
      expect(element.points.at(-1)).toEqual([160, 0]);
      if (pen === "rainbow") {
        expect(gradient).toHaveBeenCalledTimes(3);
        expect(gradient.mock.calls[0]).toEqual(gradient.mock.calls[1]);
        expect(gradient.mock.calls[1]).toEqual(gradient.mock.calls[2]);
      }
    },
  );
});

it.each(["hard", "brush"] as const)(
  "renders native mirrored gradients for %s and preserves their coordinates through erasure/export",
  async (pen) => {
    const element = {
      ...API.createElement({
        type: "freedraw",
        x: 100,
        y: 200,
        points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(800, 30)],
        strokeWidth: 15,
      }),
      customData: {
        fcInk: {
          version: pen === "brush" ? 3 : 2,
          pen,
          unit: 1,
          gradient: { palette: "mint" as const, size: 320 },
        },
      },
    };
    const original = nativeInkGradient(element)!;
    expect(original.stops.map(([, color]) => color)).toContain(
      nativeInkPalettes.mint[0],
    );
    expect(original.stops.map(([, color]) => color)).toContain(
      nativeInkPalettes.mint[1],
    );
    // Each mirror reverses its direction at the shared stop.
    expect(original.stops.slice(0, 3).map(([, color]) => color)).toEqual([
      "#4dd7af",
      "#3b52c8",
      "#4dd7af",
    ]);
    const parts = eraseStroke(
      element,
      { x: 500, y: 100 },
      { x: 500, y: 300 },
      10,
      10,
    )!;
    expect(parts).toHaveLength(2);
    const svg = await exportToSvg({
      elements: parts,
      appState: getDefaultAppState(),
      files: {},
    });
    for (const part of parts) {
      const gradient = svg.querySelector(`[id='native-${part.id}']`)!;
      expect(gradient).not.toBeNull();
      expect(gradient.getAttribute("gradientUnits")).toBe("userSpaceOnUse");
      const paint = pen === "brush" ? "fill" : "stroke";
      expect(
        svg.querySelector(`path[${paint}='url(#native-${part.id})']`),
      ).not.toBeNull();
      // Transform local start/end back to world: both endpoints stay on x=y,
      // and every 320 units is a mirror seam, independent of the new fragment origin.
      const [x1, y1, x2, y2] = nativeInkGradient(part)!.coordinates;
      expect(x1 + part.x).toBeCloseTo(y1 + part.y);
      expect(x2 + part.x).toBeCloseTo(y2 + part.y);
      expect((x1 + part.x) / 320).toBeCloseTo(Math.round((x1 + part.x) / 320));
    }
    const scene = new Scene(syncInvalidIndices([element]));
    const map = scene.getNonDeletedElementsMap();
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    const gradient = vi.spyOn(context, "createLinearGradient");
    renderElement(
      element,
      toBrandedType<RenderableElementsMap>(map),
      map,
      rough.canvas(canvas),
      context,
      {
        imageCache: new Map(),
        renderGrid: false,
        isExporting: false,
        canvasBackgroundColor: "#ffffff",
        embedsValidationStatus: new Map(),
        elementsPendingErasure: new Set(),
        pendingFlowchartNodes: null,
        theme: "light",
      },
      {
        ...getDefaultAppState(),
        width: 1000,
        height: 600,
        offsetLeft: 0,
        offsetTop: 0,
      },
    );
    expect(gradient).toHaveBeenCalledWith(...original.coordinates);
  },
);
