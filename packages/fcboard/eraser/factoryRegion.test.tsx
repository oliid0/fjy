import { pointFrom } from "@fcboard/math";
import { getElementBounds } from "@fcboard/element";
import { factoryInkPath } from "@fcboard/element/factoryInk";
import { factoryNibPath } from "@fcboard/element/factoryNib";
import { exportToCanvas, exportToSvg } from "@fcboard/utils";

import type { GlobalPoint, LocalPoint, Radians } from "@fcboard/math";

import { getDefaultAppState } from "../appState";
import { serializeAsJSON } from "../data/json";
import { restoreElements } from "../data/restore";
import { AnimationFrameHandler } from "../animation-frame-handler";
import { Fcboard } from "../index";
import { API } from "../tests/helpers/api";
import { act, render } from "../tests/test-utils";

import { boardPageExportOptions } from "../../../app/fcboard/boardExport";

import { factoryCircleObject } from "./factoryRegion";
import { eraseSceneRegion } from "./stroke";
import { FactoryCircleTrail } from "./FactoryCircleTrail";

const loop = (points: [number, number][]) =>
  points.map(([x, y]) => pointFrom<GlobalPoint>(x, y));
const local = (points: [number, number][]) =>
  points.map(([x, y]) => pointFrom<LocalPoint>(x, y));
const square = (x: number, y: number, r: number) =>
  loop([
    [x - r, y - r],
    [x + r, y - r],
    [x + r, y + r],
    [x - r, y + r],
  ]);

it("does not treat an unfilled handwritten loop as a filled geometric shape", () => {
  const ink = {
    ...API.createElement({
      type: "freedraw",
      x: 0,
      y: 0,
      points: local([
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
        [0, 0],
      ]),
    }),
    customData: {
      fcInk: { version: 2, pen: "hard", unit: 1, centerline: true },
    },
  };
  expect(eraseSceneRegion([ink], square(50, 50, 5))).toEqual([ink]);
});

it.each([0, Math.PI / 3])(
  "hits the actual nib at rotation %s and deletes its source without changing the surviving undo geometry",
  (angle) => {
    const ink = {
      ...API.createElement({
        type: "freedraw",
        x: 100,
        y: 150,
        angle: angle as Radians,
        strokeWidth: 12,
        points: local([
          [0, 0],
          [30, 20],
          [60, 35],
          [80, 50],
          [90, 60],
        ]),
      }),
      customData: {
        fcInk: {
          version: 2,
          pen: "hard",
          unit: 1,
          nib: true,
          finished: true,
          subpixel: true,
        },
      },
    };
    const object = factoryCircleObject(ink, new Map([[ink.id, ink]]));
    const nib = object.paths.find((part) => part.closed)!;
    expect(nib).toBeDefined();
    const tip = nib.points[Math.floor(nib.points.length / 2)];
    const before = factoryNibPath(ink);
    const body = factoryInkPath(ink);
    const result = eraseSceneRegion([ink], square(tip[0], tip[1], 0.4));
    expect(result[0].isDeleted).toBe(true);
    expect(ink.isDeleted).toBe(false);
    expect(factoryNibPath(result[0] as typeof ink)).toBe(before);
    expect(factoryInkPath(result[0] as typeof ink)).toBe(body);
    expect((result[0] as typeof ink).points).toBe(ink.points);
  },
);

it("hits the thin end of the same brush ellipses used to paint the source, without splitting its widths", () => {
  const ink = {
    ...API.createElement({
      type: "freedraw",
      x: 100,
      y: 100,
      strokeWidth: 20,
      points: local([
        [0, 0],
        [100, 0],
      ]),
    }),
    customData: {
      fcInk: {
        version: 3,
        pen: "brush",
        unit: 1,
        brushWidths: [1, 0.08],
        brushAngle: 0,
        finished: true,
      },
    },
  };
  const result = eraseSceneRegion([ink], square(200.6, 100.05, 0.05), [], 0);
  expect(result[0].isDeleted).toBe(true);
  expect(result[0].customData).toBe(ink.customData);
  expect(ink.isDeleted).toBe(false);
});

it.each([1, 2])(
  "matches the native measured image hit region after moving, rotating, cropping and scaling %s",
  (scale) => {
    const image = {
      ...API.createElement({
        type: "image",
        x: 80 * scale,
        y: 160 * scale,
        width: 200 * scale,
        height: 120 * scale,
        angle: (Math.PI / 4) as Radians,
        scale: [-1, 1],
      }),
      crop: {
        x: 10,
        y: 20,
        width: 100,
        height: 60,
        naturalWidth: 200,
        naturalHeight: 120,
      },
    };
    const bounds = getElementBounds(image, new Map([[image.id, image]]));
    const result = eraseSceneRegion(
      [image],
      square(bounds[0] + 3, bounds[1] + 3, 1),
    );
    expect(result[0].isDeleted).toBe(true);
    expect(result[0]).toMatchObject({
      x: image.x,
      y: image.y,
      width: image.width,
      height: image.height,
      angle: image.angle,
      crop: image.crop,
      scale: image.scale,
    });
  },
);

it("persists source identities and exports only survivors to both SVG and canvas", async () => {
  const underneath = API.createElement({
    type: "freedraw",
    x: 20,
    y: 50,
    points: local([
      [0, 0],
      [100, 0],
    ]),
    strokeWidth: 4,
  });
  const image = API.createElement({
    type: "image",
    x: 0,
    y: 0,
    width: 160,
    height: 100,
  });
  const result = eraseSceneRegion([underneath, image], square(70, 50, 10));
  const persisted = JSON.parse(
    serializeAsJSON(result, getDefaultAppState(), {}, "local"),
  );
  const restored = restoreElements(persisted.elements, null);
  expect(restored.find((element) => element.id === image.id)?.isDeleted).toBe(
    true,
  );
  expect(
    restored.find((element) => element.id === underneath.id),
  ).toMatchObject({ points: underneath.points });
  // Exercise the actual board save/share/thumbnail entry: export APIs require
  // live elements, and boardPageExportOptions supplies that filtered scene.
  const options = boardPageExportOptions(
    { elements: restored, files: {}, view: getDefaultAppState() },
    { width: 1600, height: 900, pixelRatio: 1 },
  );
  const baselineOptions = boardPageExportOptions(
    { elements: [underneath], files: {}, view: getDefaultAppState() },
    { width: 1600, height: 900, pixelRatio: 1 },
  );
  expect(options.elements.map((element) => element.id)).toEqual([
    underneath.id,
  ]);
  const svg = await exportToSvg(options);
  const baseline = await exportToSvg(baselineOptions);
  expect(svg.querySelectorAll("image, use")).toHaveLength(0);
  expect(svg.getAttribute("viewBox")).toBe(baseline.getAttribute("viewBox"));
  const painted = svg.querySelector(`[data-id="${underneath.id}"] path`)!;
  expect(painted).not.toBeNull();
  expect(painted.getAttribute("d")).toBe(
    baseline
      .querySelector(`[data-id="${underneath.id}"] path`)
      ?.getAttribute("d"),
  );
  const canvas = await exportToCanvas(options);
  const expected = await exportToCanvas(baselineOptions);
  expect([canvas.width, canvas.height]).toEqual([
    expected.width,
    expected.height,
  ]);
});

it("uses the factory red circle overlay and clears it immediately without the selection animation", async () => {
  await render(<Fcboard UIOptions={{ unifiedToolbar: true }} />);
  const { h } = window;
  const frames: FrameRequestCallback[] = [];
  const raf = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
  const frame = () => frames.splice(0).forEach((callback) => callback(0));
  const trail = new FactoryCircleTrail(new AnimationFrameHandler(), h.app);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  try {
    act(() => {
      trail.start(svg);
      trail.startPath(100, 100);
      trail.addPointToPath(200, 100);
      trail.addPointToPath(200, 200);
      frame();
    });
    const path = svg.querySelector("path")!;
    expect(path).not.toBeNull();
    expect(path.getAttribute("stroke")).toBe("#ff0000");
    expect(path.getAttribute("fill")).toBe("#ff000030");
    expect(path.getAttribute("stroke-width")).toBe("2");
    expect(path.getAttribute("stroke-dasharray")).toBe("8 16");
    expect(path.getAttribute("d")).toContain("L");
    expect(path.getAttribute("d")).not.toContain("Z");
    expect(svg.querySelector("animate")).toBeNull();
    act(() => trail.endPath());
    expect(svg.querySelector("path")).toBeNull();
  } finally {
    trail.endPath();
    raf.mockRestore();
  }
});
