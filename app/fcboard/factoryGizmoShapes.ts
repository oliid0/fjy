import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { pointFrom } from "@excalidraw/math";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element/transform";

import type { Widget, WidgetKind } from "./widgets";

export const factoryGizmoKinds = new Set<WidgetKind>([
  "ruler",
  "protractor",
  "compass",
  "setSquare",
]);
/** Utils.containsWhite compares each channel, rather than just the hex prefix. */
export const factoryGizmoColor = (background: string) => {
  const rgb = background.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  return rgb && rgb.slice(1).every((channel) => parseInt(channel, 16) >= 200)
    ? "#666666"
    : "#ffffff";
};
export const gizmoLayout = (kind: WidgetKind) =>
  kind === "ruler"
    ? { width: 360, height: 120, pivot: [15, 0] }
    : kind === "protractor"
    ? { width: 360, height: 180, pivot: [180, 180] }
    : kind === "compass"
    ? { width: 260, height: 300, pivot: [0, 300] }
    : { width: 360, height: 360, pivot: [0, 0] };
export const gizmoPoint = (
  widget: Widget,
  x: number,
  y: number,
): [number, number] => {
  const radians = (widget.params.rotation * Math.PI) / 180;
  return [
    widget.position.x +
      widget.params.size * (x * Math.cos(radians) - y * Math.sin(radians)),
    widget.position.y +
      widget.params.size * (x * Math.sin(radians) + y * Math.cos(radians)),
  ];
};

/** RulerLayer / TrianglePlateLayer use 14 px ticks and a 600 px body.
 * The reference screenshot's transparent body and two protractor scales are retained. */
export const factoryGizmoShapes = (
  widget: Widget,
): ExcalidrawElementSkeleton[] => {
  const shapes: ExcalidrawElementSkeleton[] = [];
  const color = widget.params.solid.stroke || "#ffffff";
  const path = (points: number[][], width = 1.5, strokeColor = color) =>
    shapes.push({
      type: "line",
      x: points[0][0],
      y: points[0][1],
      points: points.map(([x, y]) =>
        pointFrom(x - points[0][0], y - points[0][1]),
      ),
      roughness: 0,
      strokeWidth: width,
      strokeColor,
    });
  const text = (x: number, y: number, value: string, fontSize = 15) =>
    shapes.push({
      type: "text",
      x,
      y,
      text: value,
      fontFamily: 2,
      fontSize,
      strokeColor: color,
    });
  const ticks = (vertical = false) => {
    for (let i = 0; i <= 40; i++) {
      const offset = 15 + i * 8.4;
      const length = i % 10 === 0 ? 34 : i % 5 === 0 ? 25 : 17;
      path(
        vertical
          ? [
              [0, offset],
              [length, offset],
            ]
          : [
              [offset, 0],
              [offset, length],
            ],
      );
      if (i % 10 === 0) {
        text(
          vertical ? 40 : offset - 5,
          vertical ? offset - 8 : 42,
          String(i / 10),
          19,
        );
      }
    }
  };
  if (widget.kind === "ruler") {
    shapes.push({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 360,
      height: 120,
      roughness: 0,
      strokeWidth: 2.5,
      strokeColor: color,
      backgroundColor: "transparent",
      roundness: { type: 3 },
    });
    ticks();
    text(168, 90, "0.0", 19);
  } else if (widget.kind === "setSquare") {
    path(
      [
        [0, 0],
        [360, 0],
        [0, 360],
        [0, 0],
      ],
      2.5,
    );
    ticks();
    ticks(true);
    text(120, 115, "0.0", 19);
  } else if (widget.kind === "protractor") {
    const arc = (radius: number) =>
      Array.from({ length: 181 }, (_, degree) => [
        180 - Math.cos((degree * Math.PI) / 180) * radius,
        180 - Math.sin((degree * Math.PI) / 180) * radius,
      ]);
    path(arc(180), 2.5);
    path(arc(120));
    path(
      [
        [0, 180],
        [360, 180],
      ],
      2.5,
    );
    for (let degree = 0; degree <= 180; degree++) {
      const angle = (degree * Math.PI) / 180;
      const tick = degree % 10 === 0 ? 20 : degree % 5 === 0 ? 14 : 8;
      path([
        [180 - Math.cos(angle) * 180, 180 - Math.sin(angle) * 180],
        [
          180 - Math.cos(angle) * (180 - tick),
          180 - Math.sin(angle) * (180 - tick),
        ],
      ]);
      if (degree % 10 === 0) {
        text(
          174 - Math.cos(angle) * 149,
          171 - Math.sin(angle) * 149,
          String(degree),
          11,
        );
        text(
          172 - Math.cos(angle) * 106,
          173 - Math.sin(angle) * 106,
          String(180 - degree),
          9,
        );
        path([
          [180 - Math.cos(angle) * 120, 180 - Math.sin(angle) * 120],
          [180 - Math.cos(angle) * 113, 180 - Math.sin(angle) * 113],
        ]);
      }
    }
    const angle = (widget.params.sweep * Math.PI) / 180;
    const endpoint = [180 + 190 * Math.cos(angle), 180 - 190 * Math.sin(angle)];
    path([[180, 180], endpoint]);
    shapes.push({
      type: "ellipse",
      x: endpoint[0] - 9,
      y: endpoint[1] - 9,
      width: 18,
      height: 18,
      backgroundColor: "#ffff00",
      strokeColor: "#ffff00",
      fillStyle: "solid",
      roughness: 0,
    });
    text(190, 145, `${Math.round(Math.abs(widget.params.sweep))}°`, 21);
  } else if (widget.kind === "compass") {
    // CompassLayer's two white legs, green tips, hinge and foot-to-foot ruler.
    const radius = (200 * widget.params.length) / 1.5;
    const hinge = [radius / 2, 80];
    path([[0, 284], hinge, [radius, 284]], 16, "#ffffff");
    path(
      [
        [0, 284],
        [-8, 308],
      ],
      7,
      "#0f6a62",
    );
    path(
      [
        [radius, 284],
        [radius + 8, 308],
      ],
      7,
      "#0f6a62",
    );
    shapes.push({
      type: "ellipse",
      x: hinge[0] - 36,
      y: hinge[1] - 36,
      width: 72,
      height: 72,
      strokeColor: "#ffffff",
      strokeWidth: 2,
      backgroundColor: "#0f6a62",
      fillStyle: "solid",
      roughness: 0,
    });
    path(
      [
        [hinge[0], 0],
        [hinge[0], 36],
      ],
      12,
      "#0f6a62",
    );
    path(
      [
        [0, 312],
        [200, 312],
      ],
      1,
      "#ffffff",
    );
    for (let i = 0; i <= 30; i++) {
      const x = (i * 200) / 30;
      path(
        [
          [x, 312],
          [x, 312 + (i % 10 === 0 ? 25 : 12)],
        ],
        1,
        "#ffffff",
      );
      if (i % 10 === 0) {
        text(x - 3, 340, String(i / 10), 15);
      }
    }
  }
  const radians = (widget.params.rotation * Math.PI) / 180;
  const size = widget.params.size;
  return convertToExcalidrawElements(shapes).map((element) => {
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
      ...(element.type === "text" ? { fontSize: element.fontSize * size } : {}),
    } as ExcalidrawElementSkeleton;
  });
};
