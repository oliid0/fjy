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
    ).toEqual({ left: 108, top: 228, width: 184 });
  },
);

it.each([240, 320, 390])(
  "wraps a full table/AI action bar inside a narrow %spx viewport",
  (width) => {
    const position = selectionToolbarPosition(
      { left: 10, right: width - 10, top: 200, bottom: 400 },
      { left: 0, right: width, top: 0, bottom: 600 },
      1,
      7,
    );
    expect(position.width).toBeLessThanOrEqual(width - 24);
    expect(position.left).toBeGreaterThanOrEqual(12);
    expect(position.left + position.width).toBeLessThanOrEqual(width - 12);
    const columns = Math.floor((position.width - 8) / 44);
    expect(position.top + Math.ceil(7 / columns) * 42).toBeLessThanOrEqual(588);
  },
);
