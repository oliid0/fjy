import { adaptGizmo, compactGizmoControl, gizmoBounds } from "./adaptiveGizmo";
import { factoryGizmoShapes, gizmoPoint } from "./factoryGizmoShapes";
import { configureWidget, widgetDefaults } from "./widgets";

import type { Widget, WidgetKind } from "./widgets";

it.each([320, 390, 768])(
  "fits all ruler bodies and reachable controls into a %ipx portrait viewport",
  (width) => {
    const viewport = { left: 16, top: 16, right: width - 16, bottom: 740 };
    for (const kind of [
      "ruler",
      "setSquare",
      "protractor",
      "compass",
    ] as WidgetKind[]) {
      const source: Widget = {
        id: kind,
        kind,
        params: widgetDefaults(),
        position: { x: width / 2, y: 400 },
      };
      const widget = adaptGizmo(source, viewport, 1);
      if (width === 768) {
        expect(widget).toBe(source);
        continue;
      }
      const bounds = gizmoBounds(widget);
      expect(bounds.left).toBeGreaterThanOrEqual(viewport.left - 0.01);
      expect(bounds.top).toBeGreaterThanOrEqual(viewport.top - 0.01);
      expect(bounds.right).toBeLessThanOrEqual(viewport.right + 0.01);
      expect(bounds.bottom).toBeLessThanOrEqual(viewport.bottom + 0.01);
      const controls = [
        "delete",
        "rotate",
        "resize",
        "drawArc",
        "angle",
        "sector",
        "arc",
      ]
        .map((action) => compactGizmoControl(widget, action))
        .filter((value) => value !== undefined)
        .map(([x, y]) => gizmoPoint(widget, x, y));
      for (let index = 1; index < controls.length; index++) {
        expect(
          Math.hypot(
            controls[index][0] - controls[index - 1][0],
            controls[index][1] - controls[index - 1][1],
          ),
        ).toBeGreaterThanOrEqual(44);
      }
      expect(
        configureWidget(widget.params, { gizmo: widget.params.gizmo }).gizmo,
      ).toEqual(widget.params.gizmo);
    }
  },
);

it("reflows short landscape controls to the side while preserving readable ticks and drawing scale", () => {
  const source: Widget = {
    id: "ruler",
    kind: "ruler",
    params: widgetDefaults(),
    position: { x: 400, y: 250 },
  };
  const portrait = adaptGizmo(
    source,
    { left: 20, top: 20, right: 370, bottom: 730 },
    1,
  );
  const landscape = adaptGizmo(
    portrait,
    { left: 5, top: 5, right: 420, bottom: 140 },
    2,
  );
  expect(portrait.params.gizmo?.layout).toBe("bottom");
  expect(landscape.params.gizmo?.layout).toBe("side");
  const bounds = gizmoBounds(landscape);
  expect(bounds.right).toBeLessThanOrEqual(420);
  expect(bounds.bottom).toBeLessThanOrEqual(140);
  for (const widget of [portrait, landscape]) {
    const labels = factoryGizmoShapes(widget).filter(
      (shape) => shape.type === "text",
    );
    expect(labels.length).toBeGreaterThan(1);
    expect(labels[0].fontSize! * (widget === portrait ? 1 : 2)).toBeCloseTo(11);
  }
});
