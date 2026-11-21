import { simplify } from "points-on-curve";
import { distanceToLineSegment, lineSegment, pointFrom } from "@fcboard/math";

import type { FcboardElementSkeleton } from "@fcboard/element/transform";

import { factoryFlatShape } from "./factoryShapeGeometry";

import type { InkInput, InkPoint } from "./digitalInk";
import type { FactoryShapeKind } from "./factoryShapeGeometry";

export type RecognizedShape = {
  kind: "shape";
  shape:
    | "rectangle"
    | "ellipse"
    | "line"
    | "arrow"
    | "triangle"
    | "star"
    | "diamond"
    | "pentagon"
    | "hexagon";
  points?: InkPoint[];
};
const bounds = (points: InkPoint[]) => {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const [x, y] of points) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  return { left, top, width: right - left, height: bottom - top };
};
const segments = (strokes: InkInput): [InkPoint, InkPoint][] =>
  strokes.flatMap((stroke) =>
    stroke.slice(1).map((point, i): [InkPoint, InkPoint] => [stroke[i], point]),
  );
const distance = (point: InkPoint, lines: [InkPoint, InkPoint][]) => {
  let nearest = Infinity;
  for (const [a, b] of lines) {
    nearest = Math.min(
      nearest,
      distanceToLineSegment(
        pointFrom(...point),
        lineSegment(pointFrom(...a), pointFrom(...b)),
      ),
    );
  }
  return nearest;
};
const samples = (lines: [InkPoint, InkPoint][], step: number): InkPoint[] =>
  lines.flatMap(([a, b]) => {
    const count = Math.max(
      1,
      Math.min(64, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)),
    );
    return Array.from(
      { length: count },
      (_, i): InkPoint => [
        a[0] + ((b[0] - a[0]) * i) / count,
        a[1] + ((b[1] - a[1]) * i) / count,
      ],
    );
  });

/** Only combine nearby strokes; an unfinished shape elsewhere must not contaminate the next one. */
export const latestShapeInk = (strokes: InkInput) => {
  const boxes = strokes.map(bounds);
  const selected = new Set<number>();
  if (!boxes.length) {
    return selected;
  }
  selected.add(boxes.length - 1);
  for (let pass = 0; pass < boxes.length; pass++) {
    let changed = false;
    boxes.forEach((box, index) => {
      if (selected.has(index)) {
        return;
      }
      for (const included of selected) {
        const other = boxes[included];
        const gap = Math.max(
          10,
          Math.hypot(other.width, other.height, box.width, box.height) * 0.12,
        );
        if (
          box.left <= other.left + other.width + gap &&
          box.left + box.width >= other.left - gap &&
          box.top <= other.top + other.height + gap &&
          box.top + box.height >= other.top - gap
        ) {
          selected.add(index);
          changed = true;
          break;
        }
      }
    });
    if (!changed) {
      break;
    }
  }
  return selected;
};

/** Unpaired endpoints are unfinished edges, not a failed shape request. */
export const isShapeClosed = (strokes: InkInput) => {
  const endpoints = strokes
    .filter((stroke) => stroke.length > 1)
    .flatMap((stroke) => [stroke[0], stroke.at(-1)!]);
  if (!endpoints.length || endpoints.length > 128) {
    return false;
  }
  const box = bounds(strokes.flat());
  const gap = Math.hypot(box.width, box.height) * 0.12;
  return endpoints.every((point, index) =>
    endpoints.some(
      (other, candidate) =>
        candidate !== index &&
        Math.hypot(point[0] - other[0], point[1] - other[1]) <= gap,
    ),
  );
};

/** Bidirectional boundary fitting uses the APK-derived factory paths. Coverage in
 * both directions rejects incomplete polygons; stroke order/direction is irrelevant.
 * Work is bounded by simplifying and sampling, independent of raw pen sample count.
 */
export const fitInkShape = (strokes: InkInput): RecognizedShape | undefined => {
  const points = strokes.flat().filter((p) => p.every(Number.isFinite));
  if (points.length < 4) {
    return;
  }
  const box = bounds(points);
  const diagonal = Math.hypot(box.width, box.height);
  if (Math.min(box.width, box.height) < 8 || !Number.isFinite(diagonal)) {
    return;
  }
  const input = strokes.map(
    (stroke) => simplify(stroke, diagonal * 0.012) as InkPoint[],
  );
  // A tilted square/rectangle is still a rectangle. Preserve its measured
  // corners rather than choosing between equivalent rotated diamond templates.
  const contour = input.length === 1 ? input[0] : undefined;
  if (contour?.length === 5 && isShapeClosed(strokes)) {
    const corners = contour.slice(0, -1);
    const edges = corners.map(
      (point, index): InkPoint => [
        corners[(index + 1) % 4][0] - point[0],
        corners[(index + 1) % 4][1] - point[1],
      ],
    );
    if (
      edges.every(([x, y], index) => {
        const next = edges[(index + 1) % 4];
        const length = Math.hypot(x, y);
        return (
          length > diagonal * 0.1 &&
          Math.abs(x * next[0] + y * next[1]) <
            length * Math.hypot(...next) * 0.15
        );
      })
    ) {
      return {
        kind: "shape",
        shape: "rectangle",
        points: [...corners, corners[0]],
      };
    }
  }
  const inkSegments = segments(input);
  const inkSamples = samples(inkSegments, diagonal / 48);
  if (!inkSamples.length) {
    return;
  }
  const best: { match?: { error: number; result: RecognizedShape } } = {};
  const check = (shape: RecognizedShape["shape"], path: InkPoint[]) => {
    const template = segments([path]);
    const templateSamples = samples(template, diagonal / 48);
    const rms = (values: InkPoint[], lines: [InkPoint, InkPoint][]) =>
      Math.sqrt(
        values.reduce((sum, p) => sum + distance(p, lines) ** 2, 0) /
          values.length,
      ) / diagonal;
    const error = Math.max(
      rms(inkSamples, template),
      rms(templateSamples, inkSegments),
    );
    if (error < 0.045 && (!best.match || error < best.match.error)) {
      best.match = {
        error,
        result: {
          kind: "shape",
          shape,
          ...(shape === "ellipse" ? {} : { points: path }),
        },
      };
    }
  };
  const center: InkPoint = [box.left + box.width / 2, box.top + box.height / 2];
  check(
    "ellipse",
    Array.from(
      { length: 49 },
      (_, i): InkPoint => [
        center[0] + (Math.cos((i * Math.PI) / 24) * box.width) / 2,
        center[1] + (Math.sin((i * Math.PI) / 24) * box.height) / 2,
      ],
    ),
  );
  if (best.match && best.match.error < 0.018) {
    return best.match.result;
  }
  for (const kind of [
    "rectangle",
    "triangle",
    "star",
    "diamond",
    "pentagon",
    "hexagon",
  ] as const) {
    const shape = factoryFlatShape(kind, [0, 0], [100, 100], {
      color: "#000000",
      width: 1,
      opacity: 100,
      fill: false,
    })[0];
    const path: InkPoint[] =
      shape.type === "rectangle"
        ? [
            [0, 0],
            [100, 0],
            [100, 100],
            [0, 100],
            [0, 0],
          ]
        : "points" in shape && shape.points
        ? shape.points.map(
            (p): InkPoint => [p[0] + (shape.x || 0), p[1] + (shape.y || 0)],
          )
        : [
            [50, 0],
            [100, 50],
            [50, 100],
            [0, 50],
            [50, 0],
          ];
    const paths = [path];
    if (kind === "star") {
      const tips = path.slice(0, -1).filter((_, i) => i % 2 === 0);
      paths.push([0, 2, 4, 1, 3, 0].map((i) => tips[i]));
    }
    for (const candidate of paths) {
      for (let rotation = 0; rotation < 24; rotation++) {
        const angle = (rotation * Math.PI) / 12;
        const rotated = candidate.map(
          ([x, y]): InkPoint => [
            x * Math.cos(angle) - y * Math.sin(angle),
            x * Math.sin(angle) + y * Math.cos(angle),
          ],
        );
        const extent = bounds(rotated);
        if (!extent.width || !extent.height) {
          continue;
        }
        check(
          kind,
          rotated.map(
            ([x, y]): InkPoint => [
              box.left + ((x - extent.left) / extent.width) * box.width,
              box.top + ((y - extent.top) / extent.height) * box.height,
            ],
          ),
        );
        if (best.match && best.match.error < 0.006) {
          return best.match.result;
        }
      }
    }
  }
  return best.match?.result;
};

/** Both board and document use the same fitted vertices and native element schema. */
export const recognizedShapeSkeleton = (
  result: RecognizedShape,
  strokes: InkInput,
): FcboardElementSkeleton => {
  const box = bounds(strokes.flat());
  if (result.points?.length) {
    const first = result.points[0];
    return {
      type: "line",
      x: first[0],
      y: first[1],
      points: result.points.map(([x, y]) =>
        pointFrom(x - first[0], y - first[1]),
      ),
      roughness: 0,
    };
  }
  if (result.shape === "line" || result.shape === "arrow") {
    const first = strokes[0][0];
    const last = strokes.at(-1)!.at(-1)!;
    if (
      Math.hypot(last[0] - first[0], last[1] - first[1]) <
      Math.hypot(box.width, box.height) * 0.5
    ) {
      throw new Error("Shape endpoints do not describe a line or arrow");
    }
    return {
      type: result.shape,
      x: first[0],
      y: first[1],
      points: [
        pointFrom(0, 0),
        pointFrom(last[0] - first[0], last[1] - first[1]),
      ],
    };
  }
  if (
    result.shape === "rectangle" ||
    result.shape === "ellipse" ||
    result.shape === "diamond"
  ) {
    return {
      type: result.shape,
      x: box.left,
      y: box.top,
      width: box.width,
      height: box.height,
    };
  }
  const [shape] = factoryFlatShape(
    result.shape as FactoryShapeKind,
    [box.left, box.top],
    [box.left + box.width, box.top + box.height],
    { color: "#000000", width: 1, opacity: 100, fill: false },
  );
  return shape;
};

/** A small arc drawn at a polygon vertex requests its measured interior angle. */
export const recognizeAngleMark = (
  strokes: InkInput,
  polygons: { id: string; points: InkPoint[] }[],
) => {
  const rawMarks = strokes.flat();
  const marks = rawMarks.filter(
    (_, i) => i % Math.max(1, Math.ceil(rawMarks.length / 256)) === 0,
  );
  if (marks.length < 3) {
    return;
  }
  const box = bounds(marks);
  const center: InkPoint = [box.left + box.width / 2, box.top + box.height / 2];
  for (const polygon of polygons) {
    const points = polygon.points.slice();
    if (
      points.length < 4 ||
      Math.hypot(
        points[0][0] - points.at(-1)![0],
        points[0][1] - points.at(-1)![1],
      ) > 1
    ) {
      continue;
    }
    points.pop();
    const area = points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];
      return sum + point[0] * next[1] - next[0] * point[1];
    }, 0);
    if (Math.abs(area) < 1) {
      continue;
    }
    for (let i = 0; i < points.length; i++) {
      const vertex = points[i];
      const before = points[(i + points.length - 1) % points.length];
      const after = points[(i + 1) % points.length];
      const edge = Math.min(
        Math.hypot(before[0] - vertex[0], before[1] - vertex[1]),
        Math.hypot(after[0] - vertex[0], after[1] - vertex[1]),
      );
      const radii = marks.map(([x, y]) =>
        Math.hypot(x - vertex[0], y - vertex[1]),
      );
      const radius = radii.reduce((sum, r) => sum + r, 0) / radii.length;
      if (
        radius < 3 ||
        radius > edge * 0.3 ||
        Math.hypot(center[0] - vertex[0], center[1] - vertex[1]) > edge * 0.3 ||
        radii.some((r) => Math.abs(r - radius) > radius * 0.4)
      ) {
        continue;
      }
      const start = Math.atan2(before[1] - vertex[1], before[0] - vertex[0]);
      let sweep =
        Math.atan2(after[1] - vertex[1], after[0] - vertex[0]) - start;
      while (sweep > Math.PI) {
        sweep -= 2 * Math.PI;
      }
      while (sweep < -Math.PI) {
        sweep += 2 * Math.PI;
      }
      if (area > 0 && sweep > 0) {
        sweep -= 2 * Math.PI;
      }
      if (area < 0 && sweep < 0) {
        sweep += 2 * Math.PI;
      }
      const angleFrom = (point: InkPoint) => {
        let value =
          Math.atan2(point[1] - vertex[1], point[0] - vertex[0]) - start;
        if (sweep < 0 && value > 0) {
          value -= 2 * Math.PI;
        }
        if (sweep > 0 && value < 0) {
          value += 2 * Math.PI;
        }
        return value / sweep;
      };
      if (
        Math.abs(sweep) < 0.1 ||
        marks.some((p) => angleFrom(p) < -0.15 || angleFrom(p) > 1.15)
      ) {
        continue;
      }
      const positions = marks.map(angleFrom);
      if (Math.max(...positions) - Math.min(...positions) < 0.25) {
        continue;
      }
      const arc: InkPoint[] = Array.from({ length: 25 }, (_, n) => [
        vertex[0] + Math.cos(start + (sweep * n) / 24) * radius,
        vertex[1] + Math.sin(start + (sweep * n) / 24) * radius,
      ]);
      const labelRadius = radius * 1.65;
      const label: InkPoint = [
        vertex[0] + Math.cos(start + sweep / 2) * labelRadius,
        vertex[1] + Math.sin(start + sweep / 2) * labelRadius,
      ];
      const fontSize = Math.max(8, Math.min(20, radius * 0.65));
      return {
        target: polygon.id,
        shapes: [
          {
            type: "line",
            x: vertex[0],
            y: vertex[1],
            points: arc.map(([x, y]) =>
              pointFrom(x - vertex[0], y - vertex[1]),
            ),
            roughness: 0,
          },
          {
            type: "text",
            x: label[0] - fontSize,
            y: label[1] - fontSize / 2,
            text: `${Math.round((Math.abs(sweep) * 1800) / Math.PI) / 10}°`,
            fontSize,
            fontFamily: 2,
          },
        ] as FcboardElementSkeleton[],
      };
    }
  }
};
