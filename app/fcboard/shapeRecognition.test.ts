import {
  fitInkShape,
  latestShapeInk,
  recognizeAngleMark,
  recognizedShapeSkeleton,
} from "./shapeRecognition";
import { factoryFlatShape } from "./factoryShapeGeometry";
import { recognizeInkContent } from "./inkRecognition";
import { defaults, saveSettings } from "./settings";
import * as digitalInk from "./digitalInk";

import type { InkInput, InkPoint } from "./digitalInk";

const dense = (points: InkPoint[]): InkInput => [
  points
    .slice(1)
    .flatMap((point, i) =>
      Array.from(
        { length: 12 },
        (_, j): InkPoint => [
          points[i][0] + ((point[0] - points[i][0]) * j) / 12,
          points[i][1] + ((point[1] - points[i][1]) * j) / 12,
        ],
      ),
    )
    .concat([points.at(-1)!]),
];
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});
it("keeps an unsupported closed contour instead of collapsing the native ARROW guess into a tiny shaft", async () => {
  saveSettings({ ...defaults, apiKey: "" }, false);
  vi.spyOn(digitalInk, "hasDigitalInk").mockReturnValue(true);
  const classify = vi
    .spyOn(digitalInk, "recognizeNativeInk")
    .mockResolvedValue({ candidates: ["ARROW", "RECTANGLE"], engine: "mlkit" });
  const strokes = dense([
    [0, 0],
    [100, 20],
    [40, 100],
    [30, 30],
    [0, 0],
  ]);
  expect(fitInkShape(strokes)).toBeUndefined();
  const capture = vi.fn();
  await expect(
    recognizeInkContent(
      "shape",
      capture,
      strokes,
      new AbortController().signal,
    ),
  ).rejects.toThrow("No local shape match");
  expect(classify).toHaveBeenCalledTimes(1);
  expect(capture).not.toHaveBeenCalled();
  expect(() =>
    recognizedShapeSkeleton({ kind: "shape", shape: "arrow" }, strokes),
  ).toThrow("Shape endpoints");
});
it("recognizes a sampled circle locally with no API key or screenshot", async () => {
  saveSettings({ ...defaults, apiKey: "" }, false);
  const capture = vi.fn();
  const circle: InkInput = [
    Array.from({ length: 101 }, (_, i) => [
      200 + Math.cos((i * Math.PI) / 50) * 90,
      200 + Math.sin((i * Math.PI) / 50) * 90,
    ]),
  ];
  expect(
    await recognizeInkContent(
      "shape",
      capture,
      circle,
      new AbortController().signal,
    ),
  ).toMatchObject({ shape: "ellipse" });
  expect(capture).not.toHaveBeenCalled();
});
it.each(["star", "triangle", "pentagon", "hexagon"] as const)(
  "fits the APK %s geometry and preserves vertices",
  (kind) => {
    const shape = factoryFlatShape(kind, [50, 50], [250, 250], {
      color: "#000",
      width: 2,
      opacity: 100,
      fill: false,
    })[0];
    if (!("points" in shape) || !shape.points) {
      throw new Error("Expected polygon");
    }
    const points = shape.points.map(
      ([x, y]): InkPoint => [x + (shape.x || 0), y + (shape.y || 0)],
    );
    const result = fitInkShape(dense(points));
    expect(result?.shape).toBe(kind);
    expect(recognizedShapeSkeleton(result!, dense(points)).type).toBe("line");
  },
);
it("recognizes a rectangle from separate unordered edge strokes without recognizing an unfinished corner", () => {
  const strokes: InkInput = [
    [
      [100, 100],
      [300, 100],
    ],
    [
      [100, 200],
      [300, 200],
    ],
    [
      [300, 200],
      [300, 100],
    ],
    [
      [100, 200],
      [100, 100],
    ],
  ];
  expect(fitInkShape(strokes)?.shape).toBe("rectangle");
  expect(fitInkShape(strokes.slice(0, 2))).toBeUndefined();
  expect(
    latestShapeInk([
      [
        [900, 900],
        [1100, 1000],
      ],
      ...strokes,
    ]),
  ).toEqual(new Set([4, 1, 2, 3]));
});
it("fits a tilted hand-drawn square at its full size", () => {
  const angle = (17 * Math.PI) / 180;
  const points: InkPoint[] = [
    [-100, -100],
    [100, -100],
    [100, 100],
    [-100, 100],
    [-100, -100],
  ].map(([x, y]) => [
    300 + x * Math.cos(angle) - y * Math.sin(angle),
    300 + x * Math.sin(angle) + y * Math.cos(angle),
  ]);
  const result = fitInkShape(dense(points));
  expect(result?.shape).toBe("rectangle");
  const shape = recognizedShapeSkeleton(result!, dense(points));
  expect(shape.type).toBe("line");
  expect(
    "points" in shape &&
      Math.max(...shape.points!.map((point) => point[0])) -
        Math.min(...shape.points!.map((point) => point[0])),
  ).toBeGreaterThan(200);
});
it("measures a drawn corner arc as 90 degrees and ignores a mark elsewhere", () => {
  const polygon: InkPoint[] = [
    [100, 100],
    [300, 100],
    [100, 300],
    [100, 100],
  ];
  const arc: InkInput = [
    Array.from({ length: 20 }, (_, i) => [
      100 + 20 * Math.cos((i * Math.PI) / 38),
      100 + 20 * Math.sin((i * Math.PI) / 38),
    ]),
  ];
  const result = recognizeAngleMark(arc, [{ id: "triangle", points: polygon }]);
  expect(result?.target).toBe("triangle");
  expect(result?.shapes[1]).toMatchObject({ type: "text", text: "90°" });
  expect(
    recognizeAngleMark(
      [arc[0].map(([x, y]) => [x + 500, y + 500])],
      [{ id: "triangle", points: polygon }],
    ),
  ).toBeUndefined();
});

it("keeps unfinished multi-stroke edges offline while waiting for the remaining sides", async () => {
  saveSettings({ ...defaults, apiKey: "test" }, false);
  const capture = vi.fn();
  await expect(
    recognizeInkContent(
      "shape",
      capture,
      [
        [
          [0, 0],
          [100, 0],
        ],
        [
          [100, 0],
          [50, 100],
        ],
      ],
      new AbortController().signal,
    ),
  ).rejects.toThrow("Shape incomplete");
  expect(capture).not.toHaveBeenCalled();
});

it("keeps a concave vertex's reflex interior angle instead of reporting its exterior", () => {
  const points: InkPoint[] = [
    [0, 0],
    [100, 0],
    [100, 40],
    [40, 40],
    [40, 100],
    [0, 100],
    [0, 0],
  ];
  const arc: InkInput = [
    Array.from({ length: 40 }, (_, i) => [
      40 + 10 * Math.cos((-i * Math.PI) / 26),
      40 + 10 * Math.sin((-i * Math.PI) / 26),
    ]),
  ];
  expect(
    recognizeAngleMark(arc, [{ id: "concave", points }])?.shapes[1],
  ).toMatchObject({ type: "text", text: "270°" });
});
