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

/** HDataSet.getBackground / HCanvas.resetBitmapBG: original bitmap, stretched
 * to the board, with bitmapPaint alpha 150 (BuiltinOperator.GELU). */
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
};
export const validWhiteboardBackground = (
  value: unknown,
): value is WhiteboardBackground => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const { pattern, width, height } = value as WhiteboardBackground;
  return (
    Number.isInteger(pattern) &&
    pattern >= 1 &&
    pattern <= factoryBackgrounds.length &&
    Number.isFinite(width) &&
    width >= 1 &&
    width <= 100000 &&
    Number.isFinite(height) &&
    height >= 1 &&
    height <= 100000
  );
};
const loaded = new Map<number, HTMLImageElement>();
const loading = new Map<number, Promise<HTMLImageElement>>();
export const backgroundImage = (pattern: number) => loaded.get(pattern);
export const loadBackground = (
  background: WhiteboardBackground | undefined,
) => {
  if (!validWhiteboardBackground(background)) {
    return Promise.resolve(undefined);
  }
  const pattern = background.pattern;
  if (loaded.has(pattern)) {
    return Promise.resolve(loaded.get(pattern));
  }
  let task = loading.get(pattern);
  if (!task) {
    task = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        loaded.set(pattern, image);
        resolve(image);
      };
      image.onerror = () => {
        loading.delete(pattern);
        reject(new Error("Background image unavailable"));
      };
      image.src = factoryBackgrounds[pattern - 1];
    });
    loading.set(pattern, task);
  }
  return task;
};
