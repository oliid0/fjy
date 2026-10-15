import { hitStroke, htmlText, shapeInk } from "./documents";
import {
  configureWidget,
  projectilePoint,
  teachingTools,
  widgetDefaults,
  widgetShapes,
  widgetTime,
} from "./widgets";

describe("document ink and classroom tools", () => {
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
