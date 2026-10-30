import type { FcboardImageElement } from "@fcboard/element/types";
import type { Radians } from "@fcboard/math";

/** Android Matrix.getValues / setValues order used by HSaxSlideParser. */
export type BzdMatrix = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
export const readBzdMatrix = (value: string | null): BzdMatrix => {
  if (!value?.trim()) {
    return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }
  const entries = value.split(",");
  const matrix = entries.map(Number);
  if (
    entries.length !== 9 ||
    entries.some((part) => !part.trim()) ||
    matrix.some((value) => !Number.isFinite(value) || Math.abs(value) > 1e7)
  ) {
    throw new Error("Invalid BZD bitmap matrix");
  }
  return matrix as BzdMatrix;
};
export const bzdBitmapNeedsWarp = (m: BzdMatrix) =>
  !!m[6] ||
  !!m[7] ||
  !m[8] ||
  Math.abs(m[0] * m[1] + m[3] * m[4]) >
    1e-6 * Math.hypot(m[0], m[3]) * Math.hypot(m[1], m[4]);

/** HBitmapObject draws the whole bitmap with its matrix, not into photoRectSrc. */
export const bzdBitmapPlacement = (
  m: BzdMatrix,
  naturalWidth: number,
  naturalHeight: number,
) => {
  const a = m[0] / m[8];
  const b = m[1] / m[8];
  const c = m[3] / m[8];
  const d = m[4] / m[8];
  const width = naturalWidth * Math.hypot(a, c);
  const height = naturalHeight * Math.hypot(b, d);
  const cx = (a * naturalWidth + b * naturalHeight) / 2 + m[2] / m[8];
  const cy = (c * naturalWidth + d * naturalHeight) / 2 + m[5] / m[8];
  const values = [width, height, cx, cy];
  if (
    values.some((value) => !Number.isFinite(value) || Math.abs(value) > 1e7) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("Invalid BZD bitmap dimensions");
  }
  return {
    x: cx - width / 2,
    y: cy - height / 2,
    width,
    height,
    angle: Math.atan2(c, a) as Radians,
    scale: [1, a * d - b * c < 0 ? -1 : 1] as [number, number],
  };
};

/** Map a unit square to the currently displayed image, including axis flips.
 * Native materialization divides each column by the actual raster dimensions
 * after SVG decoding/cropping, matching Android's source-pixel coordinate system. */
export const bzdNormalizedImageMatrix = (
  image: FcboardImageElement,
): BzdMatrix => {
  const cos = Math.cos(image.angle);
  const sin = Math.sin(image.angle);
  const a = image.width * image.scale[0] * cos;
  const c = image.width * image.scale[0] * sin;
  const b = -image.height * image.scale[1] * sin;
  const d = image.height * image.scale[1] * cos;
  return [
    a,
    b,
    image.x + image.width / 2 - (a + b) / 2,
    c,
    d,
    image.y + image.height / 2 - (c + d) / 2,
    0,
    0,
    1,
  ];
};
