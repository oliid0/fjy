import { selectionToolbarPosition } from "./selection";

it.each([
  [1280, 720],
  [1920, 1080],
  [3080, 1240],
  [3840, 2160],
])(
  "keeps the factory-sized selection toolbar visible at %s by %s",
  (width, height) => {
    const viewport = { left: 0, top: 0, right: width, bottom: height - 68 };
    for (const zoom of [0.5, 1, 2]) {
      const bounds = {
        left: width - 180 * zoom,
        right: width - 20 * zoom,
        top: height - 160,
        bottom: height - 70,
      };
      const position = selectionToolbarPosition(bounds, viewport);
      expect(position.left).toBeGreaterThanOrEqual(12);
      expect(position.left + 184).toBeLessThanOrEqual(width - 12);
      expect(position.top + 42).toBeLessThan(bounds.top);
      expect(position.top).toBeGreaterThanOrEqual(12);
    }
    expect(
      selectionToolbarPosition(
        { left: 100, right: 300, top: 100, bottom: 200 },
        viewport,
      ),
    ).toEqual({ left: 108, top: 228 });
  },
);
