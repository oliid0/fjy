import { renderHook } from "@testing-library/react";

import { placePanel, useAnchoredPanel } from "./floating";

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
  it("centers a factory popup over its trigger with the native 16 dp gap", () => {
    const panel = placePanel(
      { left: 582, right: 638, top: 634, bottom: 682 },
      { width: 1280, height: 688 },
      196,
      174,
      "above",
      16,
    );
    expect(panel.left).toBe(512);
    expect(panel.top).toBe(444);
    expect(panel.top + 174 + 16).toBe(634);
  });
});

it("centers an unanchored panel instead of leaving it at the DOM's top-left position", () => {
  const parent = document.createElement("div");
  const panel = document.createElement("section");
  const ref = { current: panel };
  vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    bottom: 720,
    width: 1280,
    height: 720,
  } as DOMRect);
  vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
    width: 320,
    height: 210,
  } as DOMRect);
  Object.defineProperty(panel, "offsetParent", { value: parent });
  Object.defineProperty(panel, "scrollHeight", { value: 210 });
  const { result, unmount } = renderHook(() =>
    useAnchoredPanel(ref, "[data-unavailable-anchor]", true),
  );
  expect(result.current.left).toBe(480);
  expect(result.current.top).toBe(255);
  unmount();
});
