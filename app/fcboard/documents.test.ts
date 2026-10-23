import { factoryInkPath } from "@excalidraw/element/factoryInk";

import { eraseDocumentInk, hitStroke, htmlText, shapeInk } from "./documents";
import { documentInkElement, documentStrokeGeometry } from "./documentInk";
import {
  configureWidget,
  projectilePoint,
  teachingTools,
  widgetDefaults,
  widgetShapes,
  widgetTime,
} from "./widgets";

describe("document ink and classroom tools", () => {
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
