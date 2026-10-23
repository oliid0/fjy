import { getFreeDrawSvgPath, newFreeDrawElement } from "@excalidraw/element";
import {
  factoryInkDashes,
  factoryInkSamples,
} from "@excalidraw/element/factoryInk";
import { factoryBrushSamples } from "@excalidraw/element/factoryBrush";
import { pointFrom } from "@excalidraw/math";

import type { InkStroke } from "./documents";

const elements = new WeakMap<
  InkStroke,
  ReturnType<typeof newFreeDrawElement>
>();
export const documentInkElement = (stroke: InkStroke) => {
  let element = elements.get(stroke);
  if (!element) {
    element = {
      ...newFreeDrawElement({
        type: "freedraw",
        x: 0,
        y: 0,
        points: stroke.points.map(([x, y]) => pointFrom(x, y)),
        pressures: stroke.pressures || [],
        simulatePressure: stroke.simulatePressure !== false,
        strokeWidth: stroke.width,
        strokeColor: stroke.color,
        opacity: stroke.opacity ?? 100,
        strokeStyle:
          stroke.fcInk?.pen === "dashed"
            ? "dashed"
            : stroke.strokeStyle || "solid",
        customData: { fcInk: stroke.fcInk || { pen: "hard" } },
      }),
      id: stroke.id,
    };
    elements.set(stroke, element);
  }
  return element;
};

const geometry = new WeakMap<InkStroke, ReturnType<typeof createGeometry>>();
const createGeometry = (stroke: InkStroke) => ({
  path: stroke.fcInk
    ? getFreeDrawSvgPath(documentInkElement(stroke))
    : `M${stroke.points.map((point) => point.join(",")).join(" L")}`,
  filled: stroke.fcInk?.pen === "brush",
  dashes:
    stroke.fcInk?.pen === "dashed"
      ? factoryInkDashes(documentInkElement(stroke))
      : stroke.strokeStyle === "dashed"
      ? [8, 8]
      : undefined,
  dashOffset: stroke.fcInk?.dashOffset || 0,
});
export const documentStrokeGeometry = (stroke: InkStroke) => {
  let value = geometry.get(stroke);
  if (!value) {
    value = createGeometry(stroke);
    geometry.set(stroke, value);
  }
  return value;
};

export const documentStrokeSamples = (stroke: InkStroke) =>
  !stroke.fcInk
    ? stroke.points
    : (stroke.fcInk.pen === "brush"
        ? factoryBrushSamples(documentInkElement(stroke))
        : factoryInkSamples(documentInkElement(stroke))
      ).map(({ x, y }): [number, number] => [x, y]);
