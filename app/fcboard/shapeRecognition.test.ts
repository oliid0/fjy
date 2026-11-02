import {
  recognizeAngleMarks,
  recognizeLocalShape,
  recognizedShapeGeometry,
} from "./shapeRecognition";
import { recognizeInkContent } from "./inkRecognition";
import { defaults, saveSettings } from "./settings";

import type { InkPoint } from "./digitalInk";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

it("recognizes a rough circle immediately without a token or screenshot", async () => {
  saveSettings({ ...defaults, apiKey: "" }, false);
  const circle = Array.from({ length: 121 }, (_, i): InkPoint => {
    const angle = (i * Math.PI) / 60;
    return [
      230 + (90 + Math.sin(angle * 5) * 2) * Math.cos(angle),
      140 + 70 * Math.sin(angle),
    ];
  });
  const capture = vi.fn();
  expect(
    await recognizeInkContent(
      "shape",
      capture,
      [circle],
      new AbortController().signal,
    ),
  ).toEqual({ kind: "shape", shape: "ellipse" });
  expect(capture).not.toHaveBeenCalled();
});

it("recognizes a five-point pentagram and emits one closed, bounded star", () => {
  const vertices = Array.from(
    { length: 5 },
    (_, i): InkPoint => [
      200 + 100 * Math.cos(-Math.PI / 2 + (i * Math.PI * 2) / 5),
      180 + 100 * Math.sin(-Math.PI / 2 + (i * Math.PI * 2) / 5),
    ],
  );
  const star = [0, 2, 4, 1, 3, 0].map((i) => vertices[i]);
  expect(recognizeLocalShape([star])).toBe("star");
  const shape = recognizedShapeGeometry("star", [star]);
  expect(shape.type).toBe("line");
  if (shape.type === "line") {
    expect(shape.points).toHaveLength(11);
    expect(shape.points![0]).toEqual(shape.points!.at(-1));
    expect(shape.points!.flat().every(Number.isFinite)).toBe(true);
  }
});

it("measures an existing triangle's angle from its real vertices", () => {
  const arc = Array.from(
    { length: 15 },
    (_, i): InkPoint => [
      20 * Math.cos((i * Math.PI) / 28),
      20 * Math.sin((i * Math.PI) / 28),
    ],
  );
  const polygons = [
    {
      id: "triangle",
      points: [
        [0, 0],
        [200, 0],
        [0, 200],
        [0, 0],
      ] as InkPoint[],
    },
  ];
  expect(recognizeAngleMarks([arc], polygons)).toEqual([
    expect.objectContaining({ shapeId: "triangle", vertex: 0, text: "90°" }),
  ]);
  expect(
    recognizeAngleMarks([arc.map(([x, y]) => [x + 600, y + 600])], polygons),
  ).toEqual([]);
});

it("withholds an uncertain open scribble for visual recognition", () => {
  expect(
    recognizeLocalShape([
      [
        [0, 0],
        [10, 70],
        [80, 20],
        [20, 95],
        [90, 60],
      ],
    ]),
  ).toBeUndefined();
});
