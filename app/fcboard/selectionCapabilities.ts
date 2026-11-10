import { isLineElement, isPathALoop } from "@fcboard/element";
import { pointFrom } from "@fcboard/math";

import type { FcboardElement } from "@fcboard/element/types";

import type { InkStroke } from "./documents";

type Item = {
  id: string;
  group?: string;
  type: "ink" | "text" | "image" | "shape";
  croppable: boolean;
  color: string;
  background?: string;
  width: number;
  fontSize?: number;
  fontWeight?: 400 | 700;
  opacity: number;
  strokeStyle: "solid" | "dashed" | "dotted";
  locked: boolean;
  fillable: boolean;
};

/** q5.k B/C/D/G: the object's capabilities determine which native controls exist. */
const describe = (items: Item[]) => {
  const single = new Set(items.map((item) => item.group || item.id)).size === 1;
  const first = items[0];
  return {
    key: items
      .map((item) => item.id)
      .sort()
      .join(","),
    color: !!items.length && items.every((item) => item.type !== "image"),
    text: single && items.length === 1 && first.type === "text",
    image: single && items.length === 1 && first.croppable,
    border:
      single &&
      items.length === 1 &&
      first.type !== "image" &&
      first.type !== "text",
    opacity:
      single &&
      (items.length > 1 ||
        items.every((item) => item.type !== "image" && item.type !== "text")),
    fill: items.some((item) => item.fillable),
    layers: !!items.length,
    lock: single,
    locked: items.some((item) => item.locked),
    value: {
      color: first?.color || "#000000",
      background: first?.background || "transparent",
      width: first?.width || 1,
      fontSize: first?.fontSize || 24,
      fontWeight: first?.fontWeight || 400,
      opacity: first?.opacity ?? 100,
      strokeStyle: first?.strokeStyle || "solid",
    },
  };
};
export type SelectionPropertiesState = ReturnType<typeof describe>;

export const boardSelectionProperties = (elements: readonly FcboardElement[]) =>
  describe(
    elements.map(
      (element): Item => ({
        id: element.id,
        croppable: element.type === "image",
        group: element.groupIds.at(-1),
        type:
          element.type === "text"
            ? "text"
            : element.type === "image" ||
              element.type === "iframe" ||
              element.type === "embeddable"
            ? "image"
            : element.type === "freedraw"
            ? "ink"
            : "shape",
        color: element.strokeColor,
        background: element.backgroundColor,
        width: element.strokeWidth,
        fontSize: element.type === "text" ? element.fontSize : undefined,
        fontWeight: element.type === "text" ? element.fontWeight : undefined,
        opacity: element.opacity,
        strokeStyle: element.strokeStyle,
        locked: element.locked,
        fillable:
          ["rectangle", "ellipse", "diamond"].includes(element.type) ||
          (isLineElement(element) &&
            (element.polygon || isPathALoop(element.points))),
      }),
    ),
  );

export const documentSelectionProperties = (strokes: readonly InkStroke[]) =>
  describe(
    strokes.map(
      (stroke): Item => ({
        id: stroke.id,
        croppable: !!stroke.image,
        group:
          stroke.widget?.id ||
          stroke.insertion?.id ||
          stroke.plot?.id ||
          stroke.language?.group,
        type: stroke.text
          ? "text"
          : stroke.image || stroke.resource
          ? "image"
          : stroke.shapeType && stroke.shapeType !== "freedraw"
          ? "shape"
          : "ink",
        color: stroke.color,
        background: stroke.fill,
        width: stroke.width,
        fontSize: stroke.fontSize,
        fontWeight: stroke.fontWeight,
        opacity: stroke.opacity ?? 100,
        strokeStyle:
          stroke.strokeStyle ||
          (stroke.fcInk?.pen === "dashed" ? "dashed" : "solid"),
        locked: !!stroke.locked,
        fillable:
          ["rectangle", "ellipse", "diamond"].includes(
            stroke.shapeType || "",
          ) ||
          (stroke.shapeType === "line" &&
            isPathALoop(stroke.points.map(([x, y]) => pointFrom(x, y)))),
      }),
    ),
  );
