import { Capacitor, registerPlugin } from "@capacitor/core";
import { getLanguage } from "@excalidraw/excalidraw/i18n";
import { getElementAbsoluteCoords } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { currentSettings } from "./settings";

export type InkPoint = [number, number];
export type InkInput = InkPoint[][];
export type InkRegion = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
const engine = registerPlugin<{
  prepare(): Promise<void>;
  recognize(options: {
    strokes: InkInput;
    language: string;
  }): Promise<{ candidates: string[]; engine: string }>;
}>("FcboardDigitalInk");

// Clip each sampled segment to the selected rectangle, without connecting gaps
// or admitting handwriting outside the selection. Coordinates remain in scene units.
export const clipInk = (input: InkInput, region?: InkRegion): InkInput => {
  if (!region) {
    return input;
  }
  const output: InkInput = [];
  for (const points of input) {
    let part: InkPoint[] = [];
    const end = () => {
      if (part.length) {
        output.push(part);
        part = [];
      }
    };
    if (points.length === 1) {
      const [x, y] = points[0];
      if (
        x >= region.left &&
        x <= region.right &&
        y >= region.top &&
        y <= region.bottom
      ) {
        output.push(points);
      }
    }
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1];
      const b = points[index];
      let start = 0;
      let finish = 1;
      for (const [origin, delta, low, high] of [
        [a[0], b[0] - a[0], region.left, region.right],
        [a[1], b[1] - a[1], region.top, region.bottom],
      ]) {
        if (!delta) {
          if (origin < low || origin > high) {
            finish = -1;
          }
        } else {
          const t1 = (low - origin) / delta;
          const t2 = (high - origin) / delta;
          start = Math.max(start, Math.min(t1, t2));
          finish = Math.min(finish, Math.max(t1, t2));
        }
      }
      if (start > finish) {
        end();
        continue;
      }
      const point = (t: number): InkPoint => [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
      ];
      const first = point(start);
      const last = part.at(-1);
      if (!last || Math.hypot(last[0] - first[0], last[1] - first[1]) > 1e-6) {
        end();
        part.push(first);
      }
      part.push(point(finish));
      if (finish < 1) {
        end();
      }
    }
    end();
  }
  return output;
};

/** Raw samples, with object movement/rotation applied, in the original stroke order. */
export const boardInk = (
  elements: readonly ExcalidrawElement[],
  region?: InkRegion,
): InkInput =>
  clipInk(
    elements.flatMap((element) => {
      if (element.isDeleted || element.type !== "freedraw") {
        return [];
      }
      const [, , , , cx, cy] = getElementAbsoluteCoords(element, new Map());
      const cos = Math.cos(element.angle);
      const sin = Math.sin(element.angle);
      const points = element.points.map(([x, y]): InkPoint => {
        const dx = element.x + x - cx;
        const dy = element.y + y - cy;
        return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
      });
      return points.length ? [points] : [];
    }),
    region,
  );

export const hasDigitalInk = () => Capacitor.isNativePlatform();
let preparation: Promise<void> | undefined;
export const prepareDigitalInk = () => {
  preparation ||= engine.prepare().catch((error) => {
    preparation = undefined;
    throw error;
  });
  return preparation;
};

export const recognizeDigitalInk = async (
  strokes: InkInput,
  signal: AbortSignal,
  kind: "text" | "math",
  languageHint?: "en-US",
) => {
  signal.throwIfAborted();
  const language = currentSettings().inkLanguage;
  const result = await engine.recognize({
    strokes,
    language:
      kind === "math"
        ? "en-US"
        : languageHint
        ? languageHint
        : language !== "auto"
        ? language
        : !getLanguage().code.startsWith("zh")
        ? "en-US"
        : "zh-Hani-CN",
  });
  signal.throwIfAborted();
  return result.candidates.filter(
    (text) => typeof text === "string" && text.trim(),
  );
};
