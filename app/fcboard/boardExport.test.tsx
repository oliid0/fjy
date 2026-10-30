import {
  exportToCanvas,
  convertToFcboardElements,
  Fcboard,
} from "@fcboard/fcboard";

import { render, act } from "@fcboard/fcboard/tests/test-utils";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { boardCanvasSize, boardPageExportOptions } from "./boardExport";

import type { Board } from "./boards";

const page = (): Board => ({
  id: "one",
  name: "整张白板",
  elements: convertToFcboardElements([
    { type: "rectangle", x: 100, y: 80, width: 30, height: 20 },
    { type: "rectangle", x: 3000, y: 5000, width: 50, height: 40 },
  ]),
  files: {},
  view: {
    scrollX: 0,
    scrollY: 0,
    zoom: { value: 1 as Board["view"]["zoom"]["value"] },
    viewBackgroundColor: "#253a35",
  },
  updated: 1,
});

it.each([
  [1280, 720, 1],
  [390, 844, 3],
  [800, 1280, 2],
])(
  "renders the full %sx%s canvas at pixel ratio %s without cropping to sparse content",
  async (width, height, pixelRatio) => {
    const board = page();
    const before = JSON.stringify(board);
    const options = boardPageExportOptions(board, {
      width,
      height,
      pixelRatio,
    });
    const canvas = await exportToCanvas(options);
    expect(canvas.width).toBe(width * pixelRatio);
    expect(canvas.height).toBe(height * pixelRatio);
    expect(options.exportingFrame).toMatchObject({ width, height });
    expect(options.exportingFrame.x).toBeCloseTo(0);
    expect(options.exportingFrame.y).toBeCloseTo(0);
    expect(JSON.stringify(board)).toBe(before);
  },
);

it("keeps pan / zoom coordinates while exporting at the actual device canvas size", async () => {
  const board = page();
  board.view = {
    ...board.view,
    scrollX: -80 as Board["view"]["scrollX"],
    scrollY: 25 as Board["view"]["scrollY"],
    zoom: { value: 2 as Board["view"]["zoom"]["value"] },
  };
  const options = boardPageExportOptions(board, {
    width: 1280,
    height: 720,
    pixelRatio: 2,
  });
  expect(options.exportingFrame).toMatchObject({
    x: 80,
    y: -25,
    width: 640,
    height: 360,
  });
  const canvas = await exportToCanvas(options);
  expect([canvas.width, canvas.height]).toEqual([2560, 1440]);
  // World (100,80) remains at device pixel (80,420), including its empty margins.
  const transform = options.getDimensions(640, 360);
  expect([
    (100 - options.exportingFrame.x) * transform.scale,
    (80 - options.exportingFrame.y) * transform.scale,
  ]).toEqual([80, 420]);
});

it("renders a completely empty page at full size with its actual background and no temporary scene objects", async () => {
  let api!: FcboardImperativeAPI;
  const editor = await render(
    <Fcboard
      onMount={({ excalidrawAPI }) => {
        api = excalidrawAPI;
      }}
    />,
  );
  try {
    act(() =>
      api.updateScene({
        appState: { width: 1600, height: 900, viewBackgroundColor: "#253a35" },
      }),
    );
    const board = { ...page(), elements: api.getSceneElements() };
    const canvas = await exportToCanvas(
      boardPageExportOptions(board, boardCanvasSize(api.getAppState())),
    );
    expect([canvas.width, canvas.height]).toEqual([1600, 900]);
    expect(api.getSceneElements()).toHaveLength(0);
    const draw = (
      canvas.getContext("2d") as unknown as {
        __getEvents: () => { type: string; props: { value?: unknown } }[];
      }
    ).__getEvents();
    expect(
      draw.some(
        (event) =>
          event.type === "fillStyle" && event.props.value === "#253a35",
      ),
    ).toBe(true);
  } finally {
    editor.unmount();
  }
});

it("uses one proportional size limit for high resolution output and thumbnails", async () => {
  const board = page();
  const size = { width: 3840, height: 2160, pixelRatio: 2 };
  const canvas = await exportToCanvas(boardPageExportOptions(board, size));
  expect([canvas.width, canvas.height]).toEqual([4096, 2304]);
  const thumbnail = await exportToCanvas(
    boardPageExportOptions(board, size, 280),
  );
  expect([thumbnail.width, thumbnail.height]).toEqual([280, 158]);
});
