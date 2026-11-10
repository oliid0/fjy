import type { ImageCrop } from "@fcboard/element/types";
export type CropRegion = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
export type CropFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  scale: readonly [number, number];
  crop: ImageCrop | null;
};
export const fullCrop: CropRegion = { left: 0, top: 0, right: 1, bottom: 1 };
export const validImageCrop = (crop: ImageCrop) =>
  [
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    crop.naturalWidth,
    crop.naturalHeight,
  ].every(Number.isFinite) &&
  crop.x >= 0 &&
  crop.y >= 0 &&
  crop.width > 0 &&
  crop.height > 0 &&
  crop.naturalWidth > 0 &&
  crop.naturalHeight > 0 &&
  crop.x + crop.width <= crop.naturalWidth + 0.001 &&
  crop.y + crop.height <= crop.naturalHeight + 0.001;
/** Native crop rectangle is bounded by the currently visible bitmap. Preserve its original pixels. */
export const cropImageFrame = (
  frame: CropFrame,
  region: CropRegion,
  naturalWidth: number,
  naturalHeight: number,
) => {
  if (
    !Object.values(region).every(Number.isFinite) ||
    region.left < 0 ||
    region.top < 0 ||
    region.right > 1 ||
    region.bottom > 1 ||
    region.right <= region.left ||
    region.bottom <= region.top
  ) {
    throw Error("INVALID_IMAGE_CROP");
  }
  const previous = frame.crop || {
    x: 0,
    y: 0,
    width: naturalWidth,
    height: naturalHeight,
    naturalWidth,
    naturalHeight,
  };
  if (!validImageCrop(previous)) {
    throw Error("INVALID_IMAGE_CROP");
  }
  const width = frame.width * (region.right - region.left);
  const height = frame.height * (region.bottom - region.top);
  const dx = (frame.width * (region.left + region.right - 1)) / 2;
  const dy = (frame.height * (region.top + region.bottom - 1)) / 2;
  const cos = Math.cos(frame.angle);
  const sin = Math.sin(frame.angle);
  const crop: ImageCrop = {
    ...previous,
    x:
      previous.x +
      previous.width * (frame.scale[0] < 0 ? 1 - region.right : region.left),
    y:
      previous.y +
      previous.height * (frame.scale[1] < 0 ? 1 - region.bottom : region.top),
    width: previous.width * (region.right - region.left),
    height: previous.height * (region.bottom - region.top),
  };
  return {
    x: frame.x + frame.width / 2 + dx * cos - dy * sin - width / 2,
    y: frame.y + frame.height / 2 + dx * sin + dy * cos - height / 2,
    width,
    height,
    crop,
  };
};

export const moveCropRegion = (
  before: CropRegion,
  handle: string,
  dx: number,
  dy: number,
  minX: number,
  minY: number,
): CropRegion => {
  const clamp = (n: number, low: number, high: number) =>
    Math.max(low, Math.min(high, n));
  if (handle === "move") {
    dx = clamp(dx, -before.left, 1 - before.right);
    dy = clamp(dy, -before.top, 1 - before.bottom);
    return {
      left: before.left + dx,
      top: before.top + dy,
      right: before.right + dx,
      bottom: before.bottom + dy,
    };
  }
  return {
    left: handle.includes("w")
      ? clamp(before.left + dx, 0, before.right - minX)
      : before.left,
    right: handle.includes("e")
      ? clamp(before.right + dx, before.left + minX, 1)
      : before.right,
    top: handle.includes("n")
      ? clamp(before.top + dy, 0, before.bottom - minY)
      : before.top,
    bottom: handle.includes("s")
      ? clamp(before.bottom + dy, before.top + minY, 1)
      : before.bottom,
  };
};
