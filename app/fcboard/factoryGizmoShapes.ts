import { convertToFcboardElements } from "@fcboard/fcboard";
import { pointFrom } from "@fcboard/math";

import type { FcboardElementSkeleton } from "@fcboard/element/transform";

import { factoryProtractorFiles } from "./factoryGizmoAssets";

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
/** Scene geometry is normalized to 0.6 of the original physical-pixel grid. */
export const GIZMO_UNIT = 0.6;
export const gizmoLayout = (kind: WidgetKind, stretch = 1) =>
  kind === "ruler"
    ? { width: 360 * stretch, height: 120, pivot: [15, 0] }
    : kind === "protractor"
    ? { width: 360, height: 180, pivot: [180, 180] }
    : kind === "compass"
    ? { width: 260, height: 300, pivot: [0, 300] }
    : { width: 360 * stretch, height: 360 * stretch, pivot: [0, 0] };
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

/** CompassLayer.updateGeometry keeps both legs fixed and projects the opening
 * onto the foot baseline; the hinge remains on its original side of that line. */
export const compassGeometry = (widget: Widget) => {
  const dp =
    ((widget.params.gizmo?.unit ?? GIZMO_UNIT * widget.params.size) *
      (widget.params.gizmo?.density ?? window.devicePixelRatio ?? 1) *
      0.66) /
    widget.params.size;
  const leg = widget.params.gizmo?.leg ?? 260;
  const radius = Math.max(
    40 * dp,
    Math.min(
      2 * leg - 24 * dp,
      widget.params.gizmo?.opening ?? (200 * widget.params.length) / 1.5,
    ),
  );
  const height = Math.sqrt(Math.max(0, leg * leg - (radius * radius) / 4));
  const hinge: [number, number] = [radius / 2, 300 - height];
  const ux = -radius / (2 * leg);
  const uy = -height / leg;
  const buttonOffset = 41 * dp;
  const stretch: [number, number] = [
    radius + ux * buttonOffset,
    300 + uy * buttonOffset + 3 * dp,
  ];
  const draw: [number, number] = [
    radius + ux * buttonOffset - uy * 42 * dp,
    300 + uy * buttonOffset + ux * 42 * dp,
  ];
  const dx = radius / (2 * leg);
  const dy = height / leg - 1;
  const norm = Math.hypot(dx, dy) || 1;
  const remove: [number, number] = [
    hinge[0] + (dx / norm) * 73.4 * dp,
    hinge[1] + (dy / norm) * 73.4 * dp,
  ];
  return { dp, leg, radius, hinge, stretch, draw, remove };
};

/** RulerLayer / TrianglePlateLayer use 14 px ticks and a 600 px body.
 * The reference screenshot's transparent body and two protractor scales are retained. */
export const factoryGizmoShapes = (
  widget: Widget,
): FcboardElementSkeleton[] => {
  const shapes: FcboardElementSkeleton[] = [];
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
  const density = widget.params.gizmo?.layout
    ? widget.params.gizmo.unit / (GIZMO_UNIT * widget.params.size)
    : widget.params.gizmo?.density ?? (window.devicePixelRatio || 1);
  const { width: bodyWidth } = gizmoLayout(widget.kind, widget.params.stretchX);
  const ticks = (vertical = false) => {
    const count = Math.floor((bodyWidth - 50 * GIZMO_UNIT) / (14 * GIZMO_UNIT));
    for (let i = 0; i <= count; i++) {
      const offset =
        (widget.kind === "setSquare" ? (vertical ? 80 : 70) : 25) * GIZMO_UNIT +
        i * 14 * GIZMO_UNIT;
      const length =
        (i % 10 === 0
          ? widget.kind === "setSquare"
            ? 15
            : 20
          : i % 5 === 0
          ? widget.kind === "setSquare"
            ? 13
            : 15
          : 10) *
        density *
        GIZMO_UNIT;
      if (widget.kind === "setSquare" && offset + length > bodyWidth) {
        continue;
      }
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
          vertical ? 35 * density * GIZMO_UNIT : offset - 5,
          vertical ? offset - 8 : 35 * density * GIZMO_UNIT,
          String(i / 10),
          11 * density * GIZMO_UNIT,
        );
      }
    }
  };
  if (widget.kind === "ruler") {
    shapes.push({
      type: "rectangle",
      x: 0,
      y: 0,
      width: bodyWidth,
      height: 120,
      roughness: 0,
      strokeWidth: 8 * GIZMO_UNIT,
      strokeColor: color,
      backgroundColor: "transparent",
      roundness: { type: 3, value: 10 * GIZMO_UNIT },
    });
    ticks();
    text(
      bodyWidth / 2,
      180 * GIZMO_UNIT,
      String(widget.params.measurement || 0),
      11 * density * GIZMO_UNIT,
    );
  } else if (widget.kind === "setSquare") {
    path(
      [
        [0, 0],
        [bodyWidth, 0],
        [0, bodyWidth],
        [0, 0],
      ],
      2.5,
    );
    ticks();
    ticks(true);
    text(
      180 * GIZMO_UNIT,
      180 * GIZMO_UNIT,
      String(widget.params.measurement || 0),
      11 * density * GIZMO_UNIT,
    );
  } else if (widget.kind === "protractor") {
    // ProtractorLayer draws its native bitmap, not hundreds of regenerated
    // line/text scene objects. Keep the same actual image in board and export.
    const [body, ball] = factoryProtractorFiles(color);
    const unit =
      (widget.params.gizmo?.unit ?? GIZMO_UNIT * widget.params.size) /
      widget.params.size;
    const radius = widget.params.gizmo?.needle ?? 190;
    const diameter = widget.params.gizmo?.ball ?? 18;
    const angle = (widget.params.sweep * Math.PI) / 180;
    const endpoint = [
      180 + radius * Math.cos(angle),
      180 - radius * Math.sin(angle),
    ];
    path([[180, 180], endpoint], 4 * unit);
    shapes.push({
      type: "image",
      fileId: ball.id,
      x: endpoint[0] - diameter / 2,
      y: endpoint[1] - diameter / 2,
      width: diameter,
      height: diameter,
      strokeWidth: 0,
    });
    const height = (360 * 788) / 1563;
    shapes.push({
      type: "image",
      fileId: body.id,
      x: 0,
      y: 180 - height + 5 * unit,
      width: 360,
      height,
      strokeWidth: 0,
    });
    const normalized = Math.abs(widget.params.sweep) % 360;
    text(
      180 + 20 * unit,
      180 - 78 * unit,
      `${Math.round(Math.min(normalized, 360 - normalized))}°`,
      (widget.params.gizmo?.layout ? 18 : 48) * unit,
    );
  } else if (widget.kind === "compass") {
    const { dp, leg, radius, hinge } = compassGeometry(widget);
    const polygon = (points: number[][], fill: string, round = 0) => {
      let outline = points;
      if (round) {
        outline = points.flatMap((corner, index) => {
          const previous = points[(index + points.length - 1) % points.length];
          const next = points[(index + 1) % points.length];
          const back = Math.hypot(
            previous[0] - corner[0],
            previous[1] - corner[1],
          );
          const ahead = Math.hypot(next[0] - corner[0], next[1] - corner[1]);
          const entry = corner.map(
            (value, axis) =>
              value +
              ((previous[axis] - value) * Math.min(round, back / 2)) / back,
          );
          const exit = corner.map(
            (value, axis) =>
              value +
              ((next[axis] - value) * Math.min(round, ahead / 2)) / ahead,
          );
          // Same quadratic corners as drawLeg, sampled at four bounded steps.
          return Array.from({ length: 5 }, (_, step) => {
            const t = step / 4;
            return corner.map(
              (value, axis) =>
                (1 - t) ** 2 * entry[axis] +
                2 * (1 - t) * t * value +
                t * t * exit[axis],
            );
          });
        });
      }
      path([...outline, outline[0]], dp, "#000000");
      Object.assign(shapes.at(-1)!, {
        backgroundColor: fill,
        fillStyle: "solid",
      });
    };
    const circle = (r: number, fill: string) =>
      shapes.push({
        type: "ellipse",
        x: hinge[0] - r,
        y: hinge[1] - r,
        width: 2 * r,
        height: 2 * r,
        strokeColor: "#ffffff",
        strokeWidth: dp,
        backgroundColor: fill,
        fillStyle: "solid",
        roughness: 0,
      });
    path(
      [
        [0, 300],
        [radius, 300],
      ],
      dp,
      "#ffffff",
    );
    const count = Math.floor(radius / (7 * dp));
    for (let i = 0; i <= count; i++) {
      const x = i * 7 * dp;
      path(
        [
          [x, 300],
          [x, 300 + (i % 10 === 0 ? 30 : i % 5 === 0 ? 23 : 15) * dp],
        ],
        dp,
        "#ffffff",
      );
      if (i % 10 === 0) {
        text(x - 4 * dp, 300 + 30 * dp, String(i / 10), 14 * dp);
        Object.assign(shapes.at(-1)!, { strokeColor: "#ffffff" });
      }
    }
    // Native Path.addCircle(CCW) + inner circle(CW) is a ring with a clear
    // center. A transparent ellipse over a filled disk does not cut a hole.
    circle(29.76 * dp, "transparent");
    Object.assign(shapes.at(-1)!, {
      strokeColor: "#0f6a62",
      strokeWidth: 17.28 * dp,
    });
    circle(38.4 * dp, "transparent");
    circle(21.12 * dp, "transparent");
    shapes.push({
      type: "rectangle",
      x: hinge[0] - 8.64 * dp,
      y: hinge[1] - (38.4 + 5 + 46.08) * dp,
      width: 17.28 * dp,
      height: 46.08 * dp,
      strokeColor: "#ffffff",
      strokeWidth: dp,
      backgroundColor: "#0f6a62",
      fillStyle: "solid",
      roughness: 0,
      roundness: { type: 3, value: 3 * dp },
    });
    for (const right of [false, true]) {
      const foot = [right ? radius : 0, 300];
      const ux = (foot[0] - hinge[0]) / leg;
      const uy = (foot[1] - hinge[1]) / leg;
      const nx = -uy;
      const ny = ux;
      const edge = (along: number, across: number) => [
        hinge[0] + ux * along + nx * across,
        hinge[1] + uy * along + ny * across,
      ];
      const gap =
        (1 + Math.max(0, Math.min(1, (60 * dp - radius) / (20 * dp))) * 10) *
        dp *
        (right ? -1 : 1);
      polygon(
        [
          edge((46.4 + (right ? -4 : 4)) * dp, -11 * dp + gap),
          edge((46.4 + (right ? 4 : -4)) * dp, 11 * dp + gap),
          edge(leg - 23 * dp, 7.7 * dp),
          edge(leg - 23 * dp, -7.7 * dp),
        ],
        "#ffffff",
        6 * dp,
      );
      polygon(
        [
          edge(leg - 23 * dp, 4.5 * dp),
          edge(leg - 23 * dp, -4.5 * dp),
          edge(leg, -1.25 * dp),
          edge(leg, 1.25 * dp),
        ],
        "#0f6a62",
      );
    }
    const arrowRadius = 21.12 * dp * 0.42;
    const arc = Array.from({ length: 27 }, (_, i) => {
      const angle = ((200 + i * 10) * Math.PI) / 180;
      return [
        hinge[0] + arrowRadius * Math.cos(angle),
        hinge[1] + arrowRadius * Math.sin(angle),
      ];
    });
    path(arc, 5 * dp, "#0f6a62");
    const angle = (460 * Math.PI) / 180;
    const x = arc.at(-1)![0];
    const y = arc.at(-1)![1];
    const tx = -Math.sin(angle);
    const ty = Math.cos(angle);
    polygon(
      [
        [x + tx * 9 * dp, y + ty * 9 * dp],
        [x - tx * 2 * dp - ty * 8 * dp, y - ty * 2 * dp + tx * 8 * dp],
        [x - tx * 2 * dp + ty * 8 * dp, y - ty * 2 * dp - tx * 8 * dp],
      ],
      "#0f6a62",
    );
  }
  const radians = (widget.params.rotation * Math.PI) / 180;
  const size = widget.params.size;
  return convertToFcboardElements(shapes).map((element) => {
    if (widget.kind === "protractor" && element.type === "text") {
      const unit = widget.params.gizmo?.unit ?? GIZMO_UNIT * size;
      return {
        ...element,
        x:
          (180 * Math.cos(radians) - 180 * Math.sin(radians)) * size +
          20 * unit,
        y:
          (180 * Math.sin(radians) + 180 * Math.cos(radians)) * size -
          78 * unit,
        width: element.width * size,
        height: element.height * size,
        fontSize: (widget.params.gizmo?.layout ? 18 : 48) * unit,
        angle: 0,
      } as FcboardElementSkeleton;
    }
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
      strokeWidth: element.strokeWidth * size,
      ...(element.type === "line"
        ? {
            points: element.points.map(([x, y]) =>
              pointFrom(x * size, y * size),
            ),
          }
        : {}),
      ...(element.type === "text" ? { fontSize: element.fontSize * size } : {}),
    } as FcboardElementSkeleton;
  });
};
