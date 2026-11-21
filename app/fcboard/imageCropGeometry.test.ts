import {
  cropImageFrame,
  fullCrop,
  moveCropRegion,
  validImageCrop,
} from "./imageCropGeometry";
const frame = {
  x: 100,
  y: 200,
  width: 400,
  height: 200,
  angle: 0,
  scale: [1, 1] as const,
  crop: null,
};
it("composes repeated crop regions against original pixels and preserves geometry", () => {
  const first = cropImageFrame(
    frame,
    { left: 0.25, top: 0, right: 0.75, bottom: 1 },
    1600,
    800,
  );
  expect(first).toEqual({
    x: 200,
    y: 200,
    width: 200,
    height: 200,
    crop: {
      x: 400,
      y: 0,
      width: 800,
      height: 800,
      naturalWidth: 1600,
      naturalHeight: 800,
    },
  });
  expect(
    cropImageFrame(
      { ...frame, ...first },
      { left: 0, top: 0.5, right: 1, bottom: 1 },
      1600,
      800,
    ),
  ).toMatchObject({
    x: 200,
    y: 300,
    width: 200,
    height: 100,
    crop: { x: 400, y: 400, width: 800, height: 400 },
  });
  expect(cropImageFrame(frame, fullCrop, 1600, 800)).toMatchObject({
    x: 100,
    y: 200,
    width: 400,
    height: 200,
  });
});
it("honors image flip and rotation while keeping cropped content in its original screen position", () => {
  const next = cropImageFrame(
    { ...frame, angle: Math.PI / 2, scale: [-1, 1] },
    { left: 0, top: 0, right: 0.5, bottom: 1 },
    1600,
    800,
  );
  expect(next.x).toBeCloseTo(200);
  expect(next.y).toBeCloseTo(100);
  expect(next.crop).toMatchObject({ x: 800, y: 0, width: 800, height: 800 });
});
it("clamps all eight handles and moves the rectangle within the source bitmap", () => {
  const before = { left: 0.2, top: 0.2, right: 0.8, bottom: 0.8 };
  for (const handle of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) {
    const next = moveCropRegion(before, handle, 10, 10, 0.1, 0.1);
    expect(next.left).toBeGreaterThanOrEqual(0);
    expect(next.top).toBeGreaterThanOrEqual(0);
    expect(next.right).toBeLessThanOrEqual(1);
    expect(next.bottom).toBeLessThanOrEqual(1);
    expect(next.right - next.left).toBeGreaterThanOrEqual(0.0999);
    expect(next.bottom - next.top).toBeGreaterThanOrEqual(0.0999);
  }
  const moved = moveCropRegion(before, "move", -10, 10, 0.1, 0.1);
  expect(moved.left).toBe(0);
  expect(moved.top).toBeCloseTo(0.4);
  expect(moved.right).toBeCloseTo(0.6);
  expect(moved.bottom).toBe(1);
});
it("refuses malformed, inverted and out-of-image crop data", () => {
  expect(
    validImageCrop({
      x: 0,
      y: 0,
      width: Infinity,
      height: 20,
      naturalWidth: 100,
      naturalHeight: 100,
    }),
  ).toBe(false);
  expect(() =>
    cropImageFrame(
      frame,
      { left: 0.8, top: 0, right: 0.2, bottom: 1 },
      100,
      100,
    ),
  ).toThrow("INVALID_IMAGE_CROP");
});
