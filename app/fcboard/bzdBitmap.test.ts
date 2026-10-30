import { convertToFcboardElements } from "@fcboard/fcboard";

import type { FcboardImageElement, FileId } from "@fcboard/element/types";
import type { DataURL } from "@fcboard/fcboard/types";

import { parseBzd, serializeBzd } from "./bzd";

import type { BzdAssetLoader } from "./bzd";
import type { Board } from "./boards";

const asset = {
  dataURL: "data:image/png;base64,YQ==" as DataURL,
  mimeType: "image/png" as const,
  width: 200,
  height: 100,
};
const original = (matrix: string) =>
  `<bzd><slide><object eType="OBJECT_BITMAP" picUrl="/Whiteboard/picture.png" matrix="${matrix}" photoRectLeft="0" photoRectTop="0" photoRectRight="4000" photoRectBottom="2000" nRGBA_A="0"><lstPt/></object></slide></bzd>`;
const imageOf = (board: Board) => {
  const image = board.elements[0];
  if (image?.type !== "image") {
    throw new Error("Expected an editable image");
  }
  return image;
};
/** Source-pixel corners transformed by Fcboard's actual center rotation / flip. */
const imageCorner = (image: FcboardImageElement, u: number, v: number) => {
  const x = (u - 0.5) * image.width * image.scale[0];
  const y = (v - 0.5) * image.height * image.scale[1];
  return [
    image.x +
      image.width / 2 +
      x * Math.cos(image.angle) -
      y * Math.sin(image.angle),
    image.y +
      image.height / 2 +
      x * Math.sin(image.angle) +
      y * Math.cos(image.angle),
  ];
};

it("uses the original matrix and actual decoded bitmap size, rather than treating photoRectSrc as board coordinates", async () => {
  const load = vi.fn<BzdAssetLoader>().mockResolvedValue(asset);
  const [board] = await parseBzd(original("2,0,120,0,3,80,0,0,1"), load);
  expect(load).toHaveBeenCalledWith("/Whiteboard/picture.png", undefined);
  const image = imageOf(board);
  expect(image).toMatchObject({
    x: 120,
    y: 80,
    width: 400,
    height: 300,
    angle: 0,
    opacity: 100,
    scale: [1, 1],
  });
  expect(board.files[image.fileId!].dataURL).toBe(asset.dataURL);
});

it.each([
  [0, -3, 600, 2, 0, 50, 0, 0, 1],
  [-2, 0, 600, 0, 3, 50, 0, 0, 1],
  [0, 6, 1200, 4, 0, 100, 0, 0, 2],
  [
    Math.sqrt(2),
    -3 / Math.sqrt(2),
    600,
    Math.sqrt(2),
    3 / Math.sqrt(2),
    50,
    0,
    0,
    1,
  ],
])(
  "preserves every source corner after rotation, reflection and homogeneous scale (%j)",
  async (...matrix) => {
    const [board] = await parseBzd(
      original(matrix.join(",")),
      async () => asset,
    );
    const image = imageOf(board);
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      const actual = imageCorner(image, u, v);
      const x = u * asset.width;
      const y = v * asset.height;
      expect(actual[0]).toBeCloseTo(
        (matrix[0] * x + matrix[1] * y + matrix[2]) / matrix[8],
      );
      expect(actual[1]).toBeCloseTo(
        (matrix[3] * x + matrix[4] * y + matrix[5]) / matrix[8],
      );
    }
  },
);

it.each(["1,0.5,20,0,1,30,0,0,1", "1,0,20,0,1,30,0.001,0,1"])(
  "delegates non-orthogonal matrices to Android's real bitmap renderer (%s)",
  async (matrix) => {
    const bounds = { x: 20, y: 30, width: 250, height: 100 };
    const load = vi
      .fn<BzdAssetLoader>()
      .mockResolvedValue({ ...asset, bounds });
    const [board] = await parseBzd(original(matrix), load);
    expect(load).toHaveBeenCalledWith(
      "/Whiteboard/picture.png",
      matrix.split(",").map(Number),
    );
    expect(imageOf(board)).toMatchObject({
      ...bounds,
      angle: 0,
      scale: [1, 1],
    });
    await expect(parseBzd(original(matrix), async () => asset)).rejects.toThrow(
      "native matrix conversion",
    );
  },
);

it.each([
  "1,0,0",
  "1,,0,0,1,0,0,0,1",
  "1,0,NaN,0,1,0,0,0,1",
  "1,0,0,0,1,0,0,0,Infinity",
])("rejects invalid matrices before loading an image (%s)", async (matrix) => {
  const load = vi.fn<BzdAssetLoader>();
  await expect(parseBzd(original(matrix), load)).rejects.toThrow(
    "bitmap matrix",
  );
  expect(load).not.toHaveBeenCalled();
});

it("exports unit-square placement for native decode/crop normalization, and retains the lossless editable crop", async () => {
  const elements = convertToFcboardElements([
    {
      type: "image",
      fileId: "picture" as FileId,
      x: 100,
      y: 80,
      width: 180,
      height: 90,
      angle: (Math.PI / 3) as FcboardImageElement["angle"],
      scale: [-1, 1],
      opacity: 50,
      crop: {
        x: 40,
        y: 10,
        width: 120,
        height: 60,
        naturalWidth: 200,
        naturalHeight: 100,
      },
    },
  ]);
  const board = {
    id: "one",
    name: "图片",
    elements,
    files: { picture: { ...asset, id: "picture" as FileId, created: 1 } },
    view: {
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 1 as Board["view"]["zoom"]["value"] },
      viewBackgroundColor: "#ffffff",
    },
    updated: 1,
  } as Board;
  const xml = serializeBzd([board]);
  const object = new DOMParser()
    .parseFromString(xml, "application/xml")
    .querySelector("object")!;
  expect(object.getAttribute("fcboardNormalizedImage")).toBe("true");
  expect(object.getAttribute("photoRectRight")).toBe("1");
  expect(JSON.parse(object.getAttribute("fcboardImageCrop")!)).toEqual(
    imageOf(board).crop,
  );
  const m = object.getAttribute("matrix")!.split(",").map(Number);
  for (const [u, v] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]) {
    const [x, y] = imageCorner(imageOf(board), u, v);
    expect(m[0] * u + m[1] * v + m[2]).toBeCloseTo(x);
    expect(m[3] * u + m[4] * v + m[5]).toBeCloseTo(y);
  }
  const [restored] = await parseBzd(xml);
  expect(imageOf(restored)).toMatchObject({
    crop: imageOf(board).crop,
    angle: imageOf(board).angle,
    scale: [-1, 1],
    opacity: 50,
  });
  expect(restored.files.picture.dataURL).toBe(asset.dataURL);
  expect(() => serializeBzd([{ ...board, files: {} }])).toThrow(
    "image data is missing",
  );
});
