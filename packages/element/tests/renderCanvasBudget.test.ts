import rough from "roughjs/bin/rough";
import { pointFrom, type LocalPoint, type Radians } from "@fcboard/math";
import { toBrandedType } from "@fcboard/common";

import type {
  RenderableElementsMap,
  StaticCanvasRenderConfig,
} from "@fcboard/fcboard/scene/types";

import { getDefaultAppState } from "../../fcboard/appState";
import { getNormalizedZoom } from "../../fcboard/scene";
import { API } from "../../fcboard/tests/helpers/api";
import { Scene } from "../src/Scene";
import { syncInvalidIndices } from "../src/fractionalIndex";
import { elementWithCanvasCache, renderElement } from "../src/renderElement";

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
afterEach(() => vi.unstubAllGlobals());

it.each([
  [5000, 2, 1, 0],
  [50000, 3, 8, Math.PI / 3],
  [100, 2, 1, 0],
])(
  "caps both real arrow cache canvases for width %s / DPR %s / zoom %s / angle %s",
  (width, ratio, zoom, angle) => {
    vi.stubGlobal("devicePixelRatio", ratio);
    const label = API.createElement({
      type: "text",
      id: "arrow-label",
      containerId: "budget-arrow",
      text: "A",
    });
    const arrow = API.createElement({
      type: "arrow",
      id: "budget-arrow",
      x: 0,
      y: 0,
      width,
      height: 0,
      angle: angle as Radians,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(width, 0)],
      boundElements: [{ id: label.id, type: "text" }],
    });
    const scene = new Scene(syncInvalidIndices([arrow, label]));
    const map = scene.getNonDeletedElementsMap();
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    const draw = vi.spyOn(context, "drawImage");
    renderElement(
      arrow,
      toBrandedType<RenderableElementsMap>(map),
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
    const cached = elementWithCanvasCache.get(arrow)!;
    expect(cached).toBeDefined();
    for (const surface of [cached.canvas, cached.boundTextCanvas]) {
      expect(surface.width * surface.height).toBeLessThanOrEqual(16_777_216);
      expect(Math.max(surface.width, surface.height)).toBeLessThanOrEqual(
        32_767,
      );
      expect(surface.width * surface.height).toBeGreaterThan(0);
    }
    expect(draw).toHaveBeenCalledWith(
      cached.boundTextCanvas,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
    if (width === 100) {
      expect(cached.scale).toBe(zoom);
    }
  },
);
