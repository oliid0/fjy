import type { DataURL } from "@excalidraw/excalidraw/types";

/** Remove only edge-connected white paper, retaining enclosed whites and existing alpha. */
export const transparentInkPixels = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
) => {
  const count = width * height;
  if (!count || count > 4_194_304 || pixels.length !== count * 4) {
    throw new Error("Invalid generated image dimensions");
  }
  const paper = (index: number) => {
    const i = index * 4;
    return (
      pixels[i + 3] < 8 ||
      (Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) >= 235 &&
        Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) -
          Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) <
          15)
    );
  };
  const corners = [0, width - 1, (height - 1) * width, count - 1];
  if (!corners.every(paper)) {
    throw new Error(
      "Generated picture has an opaque background; request an isolated subject on transparent or plain white background",
    );
  }
  const visited = new Uint8Array(count);
  const queue = new Uint32Array(count);
  let read = 0;
  let write = 0;
  const add = (index: number) => {
    if (!visited[index] && paper(index)) {
      visited[index] = 1;
      queue[write++] = index;
    }
  };
  for (let x = 0; x < width; x++) {
    add(x);
    add((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    add(y * width);
    add(y * width + width - 1);
  }
  while (read < write) {
    const index = queue[read++];
    pixels[index * 4 + 3] = 0;
    if (index % width) {
      add(index - 1);
    }
    if (index % width < width - 1) {
      add(index + 1);
    }
    if (index >= width) {
      add(index - width);
    }
    if (index < count - width) {
      add(index + width);
    }
  }
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  for (let index = 0; index < count; index++) {
    if (pixels[index * 4 + 3] < 8) {
      continue;
    }
    const x = index % width;
    const y = Math.floor(index / width);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + 1);
    bottom = Math.max(bottom, y + 1);
  }
  if (left >= right || top >= bottom) {
    throw new Error("The generated image contains no visible subject");
  }
  return { left, top, right, bottom };
};

export const transparentInkImage = (image: HTMLImageElement) => {
  const scale = Math.min(
    1,
    2048 / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Unable to prepare a transparent drawing");
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const data = context.getImageData(0, 0, canvas.width, canvas.height);
  const bounds = transparentInkPixels(data.data, canvas.width, canvas.height);
  context.putImageData(data, 0, 0);
  const output = document.createElement("canvas");
  output.width = bounds.right - bounds.left;
  output.height = bounds.bottom - bounds.top;
  output
    .getContext("2d")!
    .drawImage(
      canvas,
      bounds.left,
      bounds.top,
      output.width,
      output.height,
      0,
      0,
      output.width,
      output.height,
    );
  return {
    dataURL: output.toDataURL("image/png") as DataURL,
    width: output.width,
    height: output.height,
  };
};
