import { placePanel } from "./floating";

describe("context panel placement", () => {
  it("uses the other side at the edge without covering the graph", () => {
    const anchor = { left: 1000, right: 1500, top: 150, bottom: 650 };
    const panel = placePanel(anchor, { width: 1600, height: 850 });
    expect(panel.left + panel.width).toBeLessThan(anchor.left);
    expect(panel.top).toBeGreaterThanOrEqual(12);
  });
  it("places a toolbar surface above its actual trigger and keeps it on screen", () => {
    const panel = placePanel(
      { left: 1180, right: 1230, top: 620, bottom: 680 },
      { width: 1280, height: 700 },
      480,
      430,
      "above",
    );
    expect(panel.left + panel.width).toBeLessThanOrEqual(1268);
    expect(panel.top + 430).toBeLessThan(620);
  });
});
