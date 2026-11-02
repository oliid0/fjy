import { simplify } from "points-on-curve";
import { pointFrom } from "@fcboard/math";

import type { FcboardElementSkeleton } from "@fcboard/element/transform";

import { factoryFlatShape } from "./factoryShapeGeometry";

import type { InkInput, InkPoint } from "./digitalInk";

export const recognizedShapeKinds = [
  "rectangle",
  "ellipse",
  "line",
  "arrow",
  "triangle",
  "star",
  "pentagon",
  "hexagon",
  "diamond",
] as const;
export type RecognizedShape = typeof recognizedShapeKinds[number];
export type ShapePolygon = { id: string; points: InkPoint[] };
export type AngleLabel = {
  shapeId: string;
  vertex: number;
  x: number;
  y: number;
  text: string;
};

/** Angle marks are interpreted against actual polygon vertices, never by AI.
 * Short curved marks inside a vertex produce the measured interior angle.
 */
export const recognizeAngleMarks = (
  strokes: InkInput,
  polygons: ShapePolygon[],
): AngleLabel[] => {
  const labels: AngleLabel[] = [];
  for (const polygon of polygons) {
    const vertices = polygon.points;
    if (vertices.length < 4 || distance(vertices[0], vertices.at(-1)!) > 2) {
      continue;
    }
    for (let i = 0; i < vertices.length - 1; i++) {
      const vertex = vertices[i];
      const a = vertices[(i + vertices.length - 2) % (vertices.length - 1)];
      const b = vertices[(i + 1) % (vertices.length - 1)];
      const la = distance(a, vertex);
      const lb = distance(b, vertex);
      if (Math.min(la, lb) < 20) {
        continue;
      }
      const va: InkPoint = [(a[0] - vertex[0]) / la, (a[1] - vertex[1]) / la];
      const vb: InkPoint = [(b[0] - vertex[0]) / lb, (b[1] - vertex[1]) / lb];
      const angle = Math.acos(
        Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1])),
      );
      const bisector: InkPoint = [va[0] + vb[0], va[1] + vb[1]];
      const norm = Math.hypot(...bisector);
      if (norm < 0.1 || angle < 0.1) {
        continue;
      }
      for (const stroke of strokes) {
        if (stroke.length < 4) {
          continue;
        }
        const radii = stroke.map((p) => distance(p, vertex));
        const radius = Math.max(...radii);
        if (
          radius > Math.min(la, lb) * 0.3 ||
          radius < 4 ||
          Math.min(...radii) < radius * 0.45
        ) {
          continue;
        }
        const inside = stroke.every(
          (p, index) =>
            ((p[0] - vertex[0]) * bisector[0] +
              (p[1] - vertex[1]) * bisector[1]) /
              (radii[index] * norm) >
            Math.cos(angle / 2 + 0.15),
        );
        const span = distance(stroke[0], stroke.at(-1)!);
        if (!inside || span < radius * 0.3 || span > radius * 2.1) {
          continue;
        }
        labels.push({
          shapeId: polygon.id,
          vertex: i,
          x: vertex[0] + (bisector[0] / norm) * (radius + 14),
          y: vertex[1] + (bisector[1] / norm) * (radius + 14),
          text: `${Math.round((angle * 1800) / Math.PI) / 10}°`,
        });
        break;
      }
    }
  }
  return labels;
};

const distance = (a: InkPoint, b: InkPoint) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);
const bounds = (points: InkPoint[]) => {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

/** Equal arc-length sampling keeps dense touch events from changing the match.
 * Point-cloud comparison follows the $P recognizer's stroke-order-independent
 * normalization; templates come from our existing factory shape geometry.
 */
const cloud = (strokes: InkInput): InkPoint[] => {
  const segments = strokes
    .flatMap((stroke) =>
      stroke.slice(1).map((end, i) => ({
        start: stroke[i],
        end,
        length: distance(stroke[i], end),
      })),
    )
    .filter((s) => s.length > 0);
  const length = segments.reduce((sum, s) => sum + s.length, 0);
  if (!length) {
    return [];
  }
  const sampled: InkPoint[] = [];
  let index = 0;
  let offset = 0;
  for (let i = 0; i < 48; i++) {
    const target = (length * i) / 47;
    while (
      index < segments.length - 1 &&
      offset + segments[index].length < target
    ) {
      offset += segments[index++].length;
    }
    const s = segments[index];
    const t = (target - offset) / s.length;
    sampled.push([
      s.start[0] + (s.end[0] - s.start[0]) * t,
      s.start[1] + (s.end[1] - s.start[1]) * t,
    ]);
  }
  const [left, top, right, bottom] = bounds(sampled);
  const width = Math.max(1e-6, right - left);
  const height = Math.max(1e-6, bottom - top);
  return sampled.map(([x, y]) => [
    (x - left) / width - 0.5,
    (y - top) / height - 0.5,
  ]);
};

const outline = (shape: RecognizedShape): InkInput => {
  if (shape === "ellipse") {
    return [
      Array.from(
        { length: 97 },
        (_, i): InkPoint => [
          Math.cos((i * Math.PI) / 48),
          Math.sin((i * Math.PI) / 48),
        ],
      ),
    ];
  }
  if (shape === "rectangle" || shape === "diamond") {
    return [
      shape === "rectangle"
        ? [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ]
        : [
            [0.5, 0],
            [1, 0.5],
            [0.5, 1],
            [0, 0.5],
            [0.5, 0],
          ],
    ];
  }
  const part = factoryFlatShape(shape, [0, 0], [1, 1], {
    color: "#000",
    width: 1,
    opacity: 100,
    fill: false,
  })[0];
  return part?.type === "line" && part.points
    ? [part.points.map(([x, y]) => [x, y])]
    : [];
};

const templates = recognizedShapeKinds
  .filter((kind) => kind !== "line" && kind !== "arrow")
  .flatMap((shape) => {
    const paths = [outline(shape)];
    // A five-point star may be drawn as an outline or as a single pentagram.
    if (shape === "star") {
      const vertices = Array.from(
        { length: 5 },
        (_, i): InkPoint => [
          Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / 5),
          Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / 5),
        ],
      );
      paths.push([[0, 2, 4, 1, 3, 0].map((i) => vertices[i])]);
    }
    return paths.flatMap((path) =>
      Array.from({ length: shape === "ellipse" ? 1 : 12 }, (_, index) => {
        const angle = (index * Math.PI) / 6;
        return {
          shape,
          points: cloud(
            path.map((stroke) =>
              stroke.map(
                ([x, y]): InkPoint => [
                  x * Math.cos(angle) - y * Math.sin(angle),
                  x * Math.sin(angle) + y * Math.cos(angle),
                ],
              ),
            ),
          ),
        };
      }),
    );
  });

export const recognizeLocalShape = (
  strokes: InkInput,
): RecognizedShape | undefined => {
  const points = strokes.flat();
  if (points.length < 3 || points.some((p) => !p.every(Number.isFinite))) {
    return undefined;
  }
  const [left, top, right, bottom] = bounds(points);
  const diagonal = Math.hypot(right - left, bottom - top);
  if (diagonal < 8) {
    return undefined;
  }
  const length = strokes.reduce(
    (sum, s) => sum + s.slice(1).reduce((n, p, i) => n + distance(s[i], p), 0),
    0,
  );
  if (
    strokes.length === 1 &&
    distance(points[0], points.at(-1)!) / length > 0.97
  ) {
    return "line";
  }
  if (length < diagonal * 1.8) {
    return undefined;
  }
  const input = cloud(strokes);
  const nearest = (a: InkPoint[], b: InkPoint[]) =>
    a.reduce((sum, p) => sum + Math.min(...b.map((q) => distance(p, q))), 0) /
    a.length;
  const scores = new Map<RecognizedShape, number>();
  for (const template of templates) {
    const score =
      (nearest(input, template.points) + nearest(template.points, input)) / 2;
    scores.set(
      template.shape,
      Math.min(scores.get(template.shape) ?? Infinity, score),
    );
  }
  const ranked = [...scores].sort((a, b) => a[1] - b[1]);
  return ranked[0][1] < 0.06 && ranked[1][1] - ranked[0][1] > 0.008
    ? ranked[0][0]
    : undefined;
};

/** Both board and document preserve the source bounds and real line direction. */
export const recognizedShapeGeometry = (
  shape: RecognizedShape,
  strokes: InkInput,
): FcboardElementSkeleton => {
  const points = strokes.flat();
  const [left, top, right, bottom] = bounds(points);
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  if (shape === "ellipse" || shape === "rectangle" || shape === "diamond") {
    return { type: shape, x: left, y: top, width, height };
  }
  if (shape === "line" || shape === "arrow") {
    const first = points[0];
    const last = points.at(-1)!;
    return {
      type: shape,
      x: first[0],
      y: first[1],
      points: [
        pointFrom(0, 0),
        pointFrom(last[0] - first[0], last[1] - first[1]),
      ],
    };
  }
  if (shape === "triangle" && strokes.length === 1) {
    const corners = simplify(points, Math.hypot(width, height) * 0.08);
    if (
      corners.length === 4 &&
      distance(corners[0], corners[3]) < Math.hypot(width, height) * 0.2
    ) {
      return {
        type: "line",
        x: left,
        y: top,
        points: [...corners.slice(0, 3), corners[0]].map(([x, y]) =>
          pointFrom(x - left, y - top),
        ),
      };
    }
  }
  const template = outline(shape)[0];
  const [x1, y1, x2, y2] = bounds(template);
  return {
    type: "line",
    x: left,
    y: top,
    points: template.map(([x, y]) =>
      pointFrom(
        ((x - x1) * width) / (x2 - x1),
        ((y - y1) * height) / (y2 - y1),
      ),
    ),
  };
};
