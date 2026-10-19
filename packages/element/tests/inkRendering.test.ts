import rough from "roughjs/bin/rough";
import { pointFrom } from "@excalidraw/math";
import { toBrandedType } from "@excalidraw/common";
import { exportToSvg } from "@excalidraw/excalidraw";

import type { LocalPoint } from "@excalidraw/math";
import type {
  RenderableElementsMap,
  StaticCanvasRenderConfig,
} from "@excalidraw/excalidraw/scene/types";

import { Scene } from "../src/Scene";
import { syncInvalidIndices } from "../src/fractionalIndex";

import { getDefaultAppState } from "../../excalidraw/appState";
import { getNormalizedZoom } from "../../excalidraw/scene";
import { API } from "../../excalidraw/tests/helpers/api";
import { renderElement, elementWithCanvasCache } from "../src/renderElement";
import { factoryInkPath } from "../src/factoryInk";
import { factoryBrushPath } from "../src/factoryBrush";

describe("whiteboard vector ink", () => {
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
  it.each(["legacy", "hard", "brush"])(
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
            version: pen === "brush" ? 3 : pen === "hard" ? 2 : 1,
            unit: 1,
          },
        },
      };
      const scene = new Scene(syncInvalidIndices([element]));
      const map = scene.getNonDeletedElementsMap();
      const visible = toBrandedType<RenderableElementsMap>(map);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d")!;
      const draw = vi.spyOn(context, pen === "hard" ? "stroke" : "fill");
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
    },
  );
});
