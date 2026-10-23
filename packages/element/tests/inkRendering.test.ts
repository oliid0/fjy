import rough from "roughjs/bin/rough";
import { pointFrom } from "@excalidraw/math";
import { toBrandedType } from "@excalidraw/common";
import { exportToSvg } from "@excalidraw/excalidraw";

import type { LocalPoint } from "@excalidraw/math";
import type { Radians } from "@excalidraw/math";
import type {
  RenderableElementsMap,
  StaticCanvasRenderConfig,
} from "@excalidraw/excalidraw/scene/types";

import { Scene } from "../src/Scene";
import { syncInvalidIndices } from "../src/fractionalIndex";

import { getDefaultAppState } from "../../fcboard/appState";
import { getNormalizedZoom } from "../../fcboard/scene";
import { API } from "../../fcboard/tests/helpers/api";
import { renderElement, elementWithCanvasCache } from "../src/renderElement";
import { factoryInkPath } from "../src/factoryInk";
import { factoryBrushPath } from "../src/factoryBrush";
import { rainbowInkCoordinates, rainbowInkStops } from "../src/rainbowInk";
import { getElementAbsoluteCoords } from "../src/bounds";
import { eraseStroke } from "../../fcboard/eraser/stroke";

describe("whiteboard vector ink", () => {
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
