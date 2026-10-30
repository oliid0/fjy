import { factoryNibControls } from "@fcboard/element/factoryNib";

import { factoryInkPath } from "@fcboard/element/factoryInk";

import { selectDocumentLasso } from "./documents";

import {
  eraseDocumentInk,
  eraseDocumentObjects,
  hitStroke,
  htmlText,
  shapeInk,
  scaleDocumentStroke,
  moveDocumentStroke,
} from "./documents";
import { documentInkElement, documentStrokeGeometry } from "./documentInk";
import {
  configureWidget,
  projectilePoint,
  teachingTools,
  widgetDefaults,
  widgetShapes,
  widgetTime,
} from "./widgets";
import { insertionDefaults } from "./insertObjects";

import type { InkStroke } from "./documents";

it("scales a courseware insertion and its editable geometry together around the fixed opposite corner", () => {
  const original: InkStroke = {
    id: "cell-ink",
    points: [
      [100, 100],
      [140, 140],
    ],
    width: 2,
    color: "#123456",
    pressures: [0.2, 0.8],
    simulatePressure: false,
    fcInk: {
      version: 2,
      pen: "rainbow",
      unit: 1,
      rainbow: { x: 100, width: 200 },
      dashOffset: 5,
    },
    insertion: {
      ...insertionDefaults("table", { x: 100, y: 100 }),
      origin: { x: 100, y: 100 },
    },
  };
  const next = scaleDocumentStroke(original, { x: 80, y: 80 }, 2);
  expect(next.points).toEqual([
    [120, 120],
    [200, 200],
  ]);
  expect(next.width).toBe(4);
  expect(next.pressures).toEqual([0.2, 0.8]);
  expect(next.fcInk).toMatchObject({
    unit: 2,
    rainbow: { x: 120, width: 400 },
    dashOffset: 10,
  });
  expect(next.insertion).toMatchObject({
    position: { x: 120, y: 120 },
    origin: { x: 120, y: 120 },
    width: original.insertion!.width * 2,
    height: original.insertion!.height * 2,
  });
  expect(original.points).toEqual([
    [100, 100],
    [140, 140],
  ]);
});

describe("document ink and classroom tools", () => {
  it("removes whole swept objects and composite parts without splitting or changing missed ink", () => {
    const line = (id: string, y: number): InkStroke => ({
      id,
      color: "#000",
      width: 2,
      points: [
        [0, y],
        [100, y],
      ],
    });
    const widget = {
      id: "shared",
      kind: "cube" as const,
      params: widgetDefaults(),
      position: { x: 0, y: 0 },
      origin: { x: 0, y: 0 },
    };
    const input: InkStroke[] = [
      { ...line("face", 0), widget },
      { ...line("edge", 100), widget },
      {
        ...line("unrelated", 200),
        insertion: {
          ...insertionDefaults("table", { x: 0, y: 0 }),
          id: "shared",
          origin: { x: 0, y: 0 },
        },
      },
    ];
    const next = eraseDocumentObjects(input, [50, -40], [50, 40], 8, 8);
    expect(next).toEqual([input[2]]);
    expect(next[0]).toBe(input[2]);
    expect(input).toHaveLength(3);
    expect(eraseDocumentObjects(input, [400, 0], [500, 0], 8, 8)).toBe(input);
  });
  it("hits text interiors and fast image crossings but excludes a filled triangle's empty bounding corner", () => {
    const label = shapeInk(
      { type: "text", id: "label", x: 10, y: 20, text: "Notes", fontSize: 26 },
      "lesson",
    );
    expect(eraseDocumentObjects([label], [20, 30], [20, 30], 2, 2)).toEqual([]);
    const image: InkStroke = {
      id: "image",
      points: [[200, 0]],
      color: "#000",
      width: 1,
      image: "data:image/png;base64,AA",
      imageWidth: 100,
      imageHeight: 100,
    };
    expect(eraseDocumentObjects([image], [190, 50], [310, 50], 2, 2)).toEqual(
      [],
    );
    const triangle: InkStroke = {
      id: "triangle",
      points: [
        [0, 0],
        [100, 0],
        [0, 100],
        [0, 0],
      ],
      color: "#000",
      fill: "#f00",
      width: 1,
    };
    const input = [triangle];
    expect(eraseDocumentObjects(input, [90, 90], [92, 92], 2, 2)).toBe(input);
    expect(eraseDocumentObjects(input, [20, 20], [21, 21], 2, 2)).toEqual([]);
  });
  it("uses the board's rendered curves for document export and partial erasure without resmoothing survivors", () => {
    const stroke = {
      id: "curve",
      width: 4,
      color: "#000000",
      fcInk: { version: 2 as const, pen: "dashed" as const, unit: 1 },
      points: [
        [0, 0],
        [100, 100],
        [200, 0],
      ] as [number, number][],
    };
    expect(documentStrokeGeometry(stroke).path).toBe(
      factoryInkPath(documentInkElement(stroke)),
    );
    const cut = eraseDocumentInk([stroke], [100, 40], [100, 100], 8, 8);
    expect(cut).toHaveLength(2);
    expect(cut.every((part) => part.fcInk?.centerline)).toBe(true);
    expect(documentStrokeGeometry(cut[0]).path).not.toContain("Q");
    expect(cut[1].fcInk?.dashOffset).toBeGreaterThan(0);
    expect(stroke.points).toHaveLength(3);
  });
  it("cuts the swept part of a courseware annotation without removing the rest or its source text", () => {
    const input = [
      {
        id: "ink",
        color: "#000",
        width: 4,
        points: [
          [0, 0],
          [200, 0],
        ] as [number, number][],
      },
      {
        id: "text",
        text: "课件批注",
        color: "#000",
        width: 1,
        points: [[80, 0]] as [number, number][],
      },
    ];
    const cut = eraseDocumentInk(input, [100, -50], [100, 50], 20, 24);
    expect(cut).toHaveLength(3);
    expect(cut[0].points.at(-1)![0]).toBeCloseTo(88);
    expect(cut[1].points[0][0]).toBeCloseTo(112);
    expect(cut[2]).toBe(input[1]);
    expect(input[0].points).toHaveLength(2);
    expect(eraseDocumentInk(input, [400, 0], [500, 0], 20, 24)).toBe(input);
  });
  it("erases intersected ink segments and generated text without touching the source document", () => {
    const line = {
      id: "stroke",
      width: 3,
      color: "#000",
      points: [
        [0, 0],
        [200, 0],
      ] as [number, number][],
    };
    expect(hitStroke(line, [100, 4])).toBe(true);
    expect(hitStroke(line, [100, 100])).toBe(false);
    const label = shapeInk(
      { type: "text", id: "label", x: 10, y: 20, text: "解释", fontSize: 26 },
      "lesson",
    );
    expect(hitStroke(label, [30, 30])).toBe(true);
    expect(
      htmlText("<p>课件原文</p><script>code()</script><style>body{}</style>"),
    ).toBe("课件原文");
  });
  it("uses elapsed real time for a resumed timer and keeps seconds below 60", () => {
    const params = {
      ...widgetDefaults(),
      running: true,
      elapsed: 20,
      started: 1000,
      duration: 80,
    };
    expect(widgetTime(params, 2200)).toBeCloseTo(21.2);
    const text = widgetShapes(
      { id: "timer", kind: "timer", params, position: { x: 0, y: 0 } },
      2200,
    ).find((shape) => shape.type === "text");
    expect(text?.type === "text" && text.text).toBe("00:59");
  });
  it("renders native geometry for every palette item and validates physical parameters", () => {
    for (const kind of Object.keys(
      teachingTools,
    ) as (keyof typeof teachingTools)[]) {
      const shapes = widgetShapes({
        id: kind,
        kind,
        params: widgetDefaults(),
        position: { x: 0, y: 0 },
      });
      expect(shapes.length).toBeGreaterThan(0);
      expect(
        shapes.every(
          (shape) => Number.isFinite(shape.x) && Number.isFinite(shape.y),
        ),
      ).toBe(true);
    }
    expect(() => configureWidget(widgetDefaults(), { gravity: 0 })).toThrow();
    const flight = (2 * 16) / 9.81;
    expect(projectilePoint(12, 16, 9.81, flight)[1]).toBeCloseTo(0);
    expect(projectilePoint(12, 16, 9.81, flight)[0]).toBeCloseTo(12 * flight);
  });
});

it("selects sparse segments crossing the actual lasso but excludes its empty bounding-box corner", () => {
  const stroke = (id: string, points: [number, number][]) => ({
    id,
    points,
    color: "#000000",
    width: 2,
  });
  const strokes = [
    stroke("outside", [
      [265, 265],
      [285, 285],
    ]),
    stroke("inside", [
      [120, 120],
      [140, 140],
    ]),
    stroke("crossing", [
      [0, 180],
      [500, 180],
    ]),
  ];
  expect(
    new Set(
      selectDocumentLasso(strokes, [
        [100, 100],
        [300, 100],
        [100, 300],
        [100, 100],
      ]),
    ),
  ).toEqual(new Set(["inside", "crossing"]));
});

it("keeps the original courseware nib through erasure, moving and uniform resizing", () => {
  const stroke: InkStroke = {
    id: "hard-tail",
    color: "#123456",
    width: 4,
    points: [
      [100, 100],
      [140, 120],
      [180, 120],
      [220, 120],
      [220, 120],
    ],
    fcInk: { version: 2, pen: "hard", unit: 1, nib: true, finished: true },
  };
  const original = factoryNibControls(documentInkElement(stroke))!;
  const parts = eraseDocumentInk([stroke], [150, 120], [150, 120], 4, 4);
  expect(parts).toHaveLength(2);
  expect(documentStrokeGeometry(parts[0]).nib).toBe("");
  const tail = parts[1];
  expect(factoryNibControls(documentInkElement(tail))).toEqual(original);
  const moved = moveDocumentStroke(tail, 80, 50);
  expect(factoryNibControls(documentInkElement(moved))).toEqual(
    original.map(([x, y]) => [x + 80, y + 50]),
  );
  const scaled = scaleDocumentStroke(moved, { x: 100, y: 100 }, 2);
  factoryNibControls(documentInkElement(scaled))!.forEach(([x, y], index) => {
    expect(x).toBeCloseTo(100 + (original[index][0] + 80 - 100) * 2, 10);
    expect(y).toBeCloseTo(100 + (original[index][1] + 50 - 100) * 2, 10);
  });
  expect(documentStrokeGeometry(scaled).nib).not.toMatch(/NaN|Infinity/);
});
