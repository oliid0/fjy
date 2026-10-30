import { MAX_ALLOWED_FILE_BYTES } from "@fcboard/common";

import p1 from "./factory-backgrounds/pattern-1.png?url";
import p2 from "./factory-backgrounds/pattern-2.png?url";
import p3 from "./factory-backgrounds/pattern-3.png?url";
import p4 from "./factory-backgrounds/pattern-4.png?url";
import p5 from "./factory-backgrounds/pattern-5.png?url";
import p6 from "./factory-backgrounds/pattern-6.png?url";
import p7 from "./factory-backgrounds/pattern-7.png?url";
import p8 from "./factory-backgrounds/pattern-8.png?url";
import p9 from "./factory-backgrounds/pattern-9.png?url";
import p10 from "./factory-backgrounds/pattern-10.png?url";
import p11 from "./factory-backgrounds/pattern-11.png?url";
import p12 from "./factory-backgrounds/pattern-12.png?url";
import p13 from "./factory-backgrounds/pattern-13.png?url";

import type { DataURL } from "./types";

/** HDataSet.getBackground / HCanvas.resetBitmapBG: original bitmap, stretched
 * to the board. HCanvas.setBitmapPaint uses alpha 255 for custom images,
 * and 150 (BuiltinOperator.GELU) for the built-in patterns. */
export const factoryBackgrounds = [
  p1,
  p2,
  p3,
  p4,
  p5,
  p6,
  p7,
  p8,
  p9,
  p10,
  p11,
  p12,
  p13,
];
export type WhiteboardBackground = {
  pattern: number;
  width: number;
  height: number;
  image?: DataURL;
};
export const validBackgroundImage = (value: unknown): value is DataURL =>
  typeof value === "string" &&
  value.length <= Math.ceil(MAX_ALLOWED_FILE_BYTES / 3) * 4 + 100 &&
  /^data:image\/(png|jpeg|webp);base64,[\da-z+/]/i.test(value.slice(0, 64));
export const validWhiteboardBackground = (
  value: unknown,
): value is WhiteboardBackground => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const { pattern, width, height, image } = value as WhiteboardBackground;
  return (
    Number.isInteger(pattern) &&
    pattern >= 1 &&
    ((pattern <= factoryBackgrounds.length && image === undefined) ||
      (pattern === 14 && validBackgroundImage(image))) &&
    Number.isFinite(width) &&
    width >= 1 &&
    width <= 100000 &&
    Number.isFinite(height) &&
    height >= 1 &&
    height <= 100000
  );
};
const source = (background: WhiteboardBackground) =>
  background.pattern === 14
    ? background.image!
    : factoryBackgrounds[background.pattern - 1];
const loaded = new Map<string, HTMLImageElement>();
const loading = new Map<string, Promise<HTMLImageElement>>();
export const backgroundImage = (background: WhiteboardBackground) =>
  loaded.get(source(background));
export const backgroundOpacity = (background: WhiteboardBackground) =>
  background.pattern === 14 ? 1 : 150 / 255;
export const loadBackground = (
  background: WhiteboardBackground | undefined,
) => {
  if (!validWhiteboardBackground(background)) {
    return Promise.resolve(undefined);
  }
  const url = source(background);
  if (loaded.has(url)) {
    const image = loaded.get(url)!;
    loaded.delete(url);
    loaded.set(url, image);
    return Promise.resolve(image);
  }
  let task = loading.get(url);
  if (!task) {
    task = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        loading.delete(url);
        loaded.set(url, image);
        // Retain the original patterns and a few current custom images, rather
        // than pinning decoded bitmaps from every page for the whole session.
        if (loaded.size > 16) {
          loaded.delete(loaded.keys().next().value!);
        }
        resolve(image);
      };
      image.onerror = () => {
        loading.delete(url);
        reject(new Error("Background image unavailable"));
      };
      image.src = url;
    });
    loading.set(url, task);
  }
  return task;
};
