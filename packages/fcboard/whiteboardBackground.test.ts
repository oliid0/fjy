import rough from "roughjs";

import { toBrandedType } from "@fcboard/common";

import type { NonDeletedSceneElementsMap } from "@fcboard/element/types";

import { renderStaticScene } from "./renderer/staticScene";

import { getDefaultAppState } from "./appState";
import { restoreAppState } from "./data/restore";
import { exportToSvg } from "./scene/export";
import {
  backgroundImage,
  backgroundOpacity,
  loadBackground,
  validWhiteboardBackground,
} from "./whiteboardBackground";

import type {
  RenderableElementsMap,
  StaticSceneRenderConfig,
} from "./scene/types";
import type { Zoom } from "./types";

import type { DataURL } from "./types";

const first = "data:image/png;base64,YQ==" as DataURL;
const second = "data:image/png;base64,Yg==" as DataURL;
afterEach(() => vi.unstubAllGlobals());
const mockImages = (fail = false) => {
  const images: HTMLImageElement[] = [];
  vi.stubGlobal(
    "Image",
    vi.fn(() => {
      const image = document.createElement("img");
      Object.defineProperties(image, {
        naturalWidth: { value: 640 },
        naturalHeight: { value: 480 },
      });
      images.push(image);
      queueMicrotask(() =>
        image.dispatchEvent(new Event(fail ? "error" : "load")),
      );
      return image;
    }),
  );
  return images;
};

it("keeps custom backgrounds from different pages distinct and exports them at the original full opacity", async () => {
  const images = mockImages();
  const a = { pattern: 14, width: 1600, height: 900, image: first };
  const b = { ...a, image: second };
  expect(await loadBackground(a)).not.toBe(await loadBackground(b));
  expect(await loadBackground(a)).toBe(backgroundImage(a));
  expect(images).toHaveLength(2);
  expect(backgroundOpacity(a)).toBe(1);
  expect(backgroundOpacity({ pattern: 1, width: 1600, height: 900 })).toBe(
    150 / 255,
  );
  const state = {
    ...getDefaultAppState(),
    whiteboardBackground: a,
    whiteboardCustomBackground: first,
    exportBackground: true,
    exportEmbedScene: false,
    exportWithDarkMode: false,
  };
  expect(restoreAppState(state, null).whiteboardBackground).toEqual(a);
  expect(restoreAppState(state, null).whiteboardCustomBackground).toEqual(
    first,
  );
  const svg = await exportToSvg([], state, {});
  expect(svg.querySelector("image")).toHaveAttribute("opacity", "1");
  expect(svg.querySelector("image")).toHaveAttribute(
    "preserveAspectRatio",
    "none",
  );
  expect(svg.querySelector("image")).toHaveAttribute("width", "1600");
});

it("rejects external or unsupported backgrounds and allows retry after an actual image decoding failure", async () => {
  for (const image of [
    "https://example.com/a.png",
    "data:image/svg+xml;base64,YQ==",
    "data:image/png;base64,",
  ]) {
    expect(
      validWhiteboardBackground({
        pattern: 14,
        width: 100,
        height: 100,
        image,
      }),
    ).toBe(false);
  }
  const background = {
    pattern: 14,
    width: 100,
    height: 100,
    image: "data:image/png;base64,Yw==" as DataURL,
  };
  mockImages(true);
  await expect(loadBackground(background)).rejects.toThrow();
  expect(backgroundImage(background)).toBeUndefined();
  const images = mockImages();
  expect(await loadBackground(background)).toBe(images[0]);
});

it.each([
  [1920, 1080, 1, 1],
  [1920, 1080, 2, 0.5],
  [480, 1080, 2, 2],
  [960, 540, 1.5, 1.25],
])(
  "paints the full current %sx%s viewport at pixel ratio %s and zoom %s, ignoring saved board dimensions",
  async (width, height, scale, zoom) => {
    mockImages();
    const background = { pattern: 3, width: 640, height: 360 };
    const image = await loadBackground(background);
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext("2d")!;
    const draw = vi.spyOn(context, "drawImage");
    const config: StaticSceneRenderConfig = {
      canvas,
      rc: rough.canvas(canvas),
      scale,
      elementsMap: toBrandedType<RenderableElementsMap>(new Map()),
      allElementsMap: toBrandedType<NonDeletedSceneElementsMap>(new Map()),
      visibleElements: [],
      appState: {
        ...getDefaultAppState(),
        width,
        height,
        offsetLeft: 0,
        offsetTop: 0,
        zoom: { value: zoom } as Zoom,
        scrollX: 123,
        scrollY: -456,
        whiteboardBackground: background,
      },
      renderConfig: {
        canvasBackgroundColor: "#fffff9",
        imageCache: new Map(),
        renderGrid: false,
        isExporting: false,
        embedsValidationStatus: new Map(),
        elementsPendingErasure: new Set(),
        pendingFlowchartNodes: null,
        theme: "light",
      },
    };
    renderStaticScene(config);
    expect(draw).toHaveBeenLastCalledWith(
      image,
      0,
      0,
      width / zoom,
      height / zoom,
    );
    canvas.width = (width * scale) / 2;
    config.appState = { ...config.appState, width: width / 2 };
    renderStaticScene(config);
    expect(draw).toHaveBeenLastCalledWith(
      image,
      0,
      0,
      width / zoom / 2,
      height / zoom,
    );
  },
);
