import { pointFrom } from "@fcboard/math";
import { convertToFcboardElements } from "@fcboard/fcboard";

import type { FcboardElementSkeleton } from "@fcboard/element/transform";

export const factoryShapeCatalog = [
  ["line", "toolBar.line"],
  ["arrow", "toolBar.arrow"],
  ["rightTriangle", "fcboard.right_triangle"],
  ["triangle", "fcboard.triangle"],
  ["trapezoid", "fcboard.trapezoid"],
  ["diamond", "toolBar.diamond"],
  ["rectangle", "toolBar.rectangle"],
  ["ellipse", "toolBar.ellipse"],
  ["circle", "fcboard.circle"],
  ["star", "fcboard.star"],
  ["pentagon", "fcboard.pentagon"],
  ["hexagon", "fcboard.hexagon"],
  ["cube", "fcboard.cube"],
  ["sphere", "fcboard.sphere"],
  ["cylinder", "fcboard.cylinder"],
  ["cone", "fcboard.cone"],
  ["pyramid", "fcboard.pyramid"],
  ["hemisphere", "fcboard.hemisphere"],
  ["frustum", "fcboard.frustum"],
  ["prism", "fcboard.prism"],
] as const;
export type FactoryShapeKind = typeof factoryShapeCatalog[number][0];
export type ShapePoint = [number, number];
export type FactoryShapeStyle = {
  color: string;
  width: number;
  opacity: number;
  fill: boolean;
};
export type FactoryFlatShapeData = {
  kind: FactoryShapeKind;
  start: ShapePoint;
  end: ShapePoint;
  fill: boolean;
  width: number;
  opacity: number;
};
export const validatedFactoryShape = (input: unknown): FactoryFlatShapeData => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid factory shape");
  }
  const value = input as FactoryFlatShapeData;
  if (
    !factoryShapeCatalog.slice(0, 12).some(([kind]) => kind === value.kind) ||
    ![value.start, value.end].every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        point.every(
          (value) =>
            typeof value === "number" &&
            Number.isFinite(value) &&
            Math.abs(value) <= 1e6,
        ),
    ) ||
    typeof value.fill !== "boolean" ||
    !Number.isFinite(value.width) ||
    value.width <= 0 ||
    value.width > 240 ||
    !Number.isFinite(value.opacity) ||
    value.opacity < 0 ||
    value.opacity > 100
  ) {
    throw new Error("Invalid factory shape");
  }
  return {
    kind: value.kind,
    start: [...value.start],
    end: [...value.end],
    fill: value.fill,
    width: value.width,
    opacity: value.opacity,
  };
};

/** HShapeObject 0..7/9/10 use only the initial and latest contact points.
 * Five/six-sided polygons are the two additional items photographed in IMG_1254. */
export const factoryFlatShape = (
  kind: FactoryShapeKind,
  start: ShapePoint,
  end: ShapePoint,
  style: FactoryShapeStyle,
): FcboardElementSkeleton[] => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const left = Math.min(start[0], end[0]);
  const top = Math.min(start[1], end[1]);
  const width = Math.abs(dx);
  const height = Math.abs(dy);
  const right = left + width;
  const bottom = top + height;
  const center: ShapePoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  const common = {
    strokeColor: style.color,
    strokeWidth: style.width,
    opacity: style.opacity,
    roughness: 0,
    fillStyle: "solid" as const,
    backgroundColor: style.fill ? style.color : "transparent",
  };
  const path = (
    points: ShapePoint[],
    close = true,
  ): FcboardElementSkeleton[] => [
    {
      ...common,
      type: "line",
      x: points[0][0],
      y: points[0][1],
      points: [...points, ...(close ? [points[0]] : [])].map(([x, y]) =>
        pointFrom(x - points[0][0], y - points[0][1]),
      ),
      ...(kind === "line" || kind === "arrow"
        ? { backgroundColor: "transparent" }
        : {}),
    },
  ];
  if (kind === "line") {
    return path([start, end], false);
  }
  if (kind === "arrow") {
    const size = Math.max(10, Math.min(42, Math.hypot(dx, dy) / 8));
    const angle = Math.atan2(-dy, -dx);
    const a: ShapePoint = [
      end[0] + Math.cos(angle + Math.PI / 6) * size,
      end[1] + Math.sin(angle + Math.PI / 6) * size,
    ];
    const b: ShapePoint = [
      end[0] + Math.cos(angle - Math.PI / 6) * size,
      end[1] + Math.sin(angle - Math.PI / 6) * size,
    ];
    return path([
      start,
      end,
      a,
      [a[0] + 1, a[1]],
      [end[0] + 1, end[1]],
      [b[0] + 1, b[1]],
      b,
      [end[0], end[1] + 1],
      [start[0], start[1] + 1],
    ]);
  }
  if (kind === "rectangle" || kind === "ellipse" || kind === "diamond") {
    return [{ ...common, type: kind, x: left, y: top, width, height }];
  }
  if (kind === "circle") {
    const radius = Math.hypot(dx, dy) / 2;
    return [
      {
        ...common,
        type: "ellipse",
        x: center[0] - radius,
        y: center[1] - radius,
        width: radius * 2,
        height: radius * 2,
      },
    ];
  }
  if (kind === "triangle") {
    return path([
      [start[0], end[1]],
      [end[0], end[1]],
      [center[0], end[1] - Math.abs(dx) / Math.SQRT2],
    ]);
  }
  if (kind === "rightTriangle") {
    return path([
      [start[0], end[1]],
      [end[0], end[1]],
      [start[0], end[1] - dx],
    ]);
  }
  if (kind === "trapezoid") {
    return path([
      [left + width / 4, top],
      [left + (3 * width) / 4, top],
      [right, bottom],
      [left, bottom],
    ]);
  }
  if (kind === "star") {
    const outer = Math.hypot(dx, dy) / 2;
    const inner =
      (Math.sin(Math.PI / 10) / Math.sin((Math.PI * 4) / 5)) * outer;
    return path(
      Array.from({ length: 10 }, (_, index): ShapePoint => {
        const angle = ((18 + 36 * index) * Math.PI) / 180;
        const radius = index % 2 ? inner : outer;
        return [
          center[0] + Math.cos(angle) * radius,
          center[1] - Math.sin(angle) * radius,
        ];
      }),
    );
  }
  if (kind === "pentagon" || kind === "hexagon") {
    const count = kind === "pentagon" ? 5 : 6;
    const radius = Math.min(width, height) / 2;
    return path(
      Array.from({ length: count }, (_, index): ShapePoint => {
        const angle =
          (kind === "pentagon" ? -Math.PI / 2 : 0) +
          (2 * Math.PI * index) / count;
        return [
          center[0] + Math.cos(angle) * radius,
          center[1] + Math.sin(angle) * radius,
        ];
      }),
    );
  }
  return [];
};

/** Persist the drag's two axes, so later solid animations keep the chosen proportions. */
export const stretchFactoryShapes = (
  shapes: FcboardElementSkeleton[],
  sx: number,
  sy: number,
) =>
  shapes.map(
    (shape): FcboardElementSkeleton => ({
      ...shape,
      x: (shape.x || 0) * sx,
      y: (shape.y || 0) * sy,
      ...(shape.width !== undefined ? { width: shape.width * sx } : {}),
      ...(shape.height !== undefined ? { height: shape.height * sy } : {}),
      ...(shape.type === "line" || shape.type === "arrow"
        ? { points: shape.points?.map(([x, y]) => pointFrom(x * sx, y * sy)) }
        : {}),
    }),
  );

export const rotateFactoryShapes = (
  shapes: FcboardElementSkeleton[],
  rotation: number,
  size: number,
) => {
  if (!rotation && size === 1) {
    return shapes;
  }
  const radians = (rotation * Math.PI) / 180;
  return convertToFcboardElements(shapes).map(
    (element): FcboardElementSkeleton => {
      const cx = (element.x + element.width / 2) * size;
      const cy = (element.y + element.height / 2) * size;
      return {
        ...element,
        x:
          cx * Math.cos(radians) -
          cy * Math.sin(radians) -
          (element.width * size) / 2,
        y:
          cx * Math.sin(radians) +
          cy * Math.cos(radians) -
          (element.height * size) / 2,
        width: element.width * size,
        height: element.height * size,
        angle: radians,
        ...(element.type === "line"
          ? {
              points: element.points.map(([x, y]) =>
                pointFrom(x * size, y * size),
              ),
            }
          : {}),
      } as FcboardElementSkeleton;
    },
  );
};
