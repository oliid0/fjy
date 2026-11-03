import { getDefaultAppState } from "../appState";
import { restoreAppState } from "../data/restore";
import {
  contactPenPreferences,
  scaleWhiteboardPen,
  switchWhiteboardTip,
  whiteboardInkStyle,
} from "../whiteboardPen";

it("scales the original fine pen with zoom, clips its physical range, and keeps the thick pen independent", () => {
  const fine = { ...getDefaultAppState(), currentItemStrokeWidth: 2 };
  expect(scaleWhiteboardPen(fine, 1.5)).toMatchObject({
    currentItemStrokeWidth: 3,
  });
  // A hard pen's nominal 4px is represented by DEFAULT_ELEMENT_PROPS width 2.
  expect(scaleWhiteboardPen(fine, 0.1)).toMatchObject({
    currentItemStrokeWidth: 0.5,
  });
  expect(scaleWhiteboardPen(fine, 10, 20)).toMatchObject({
    currentItemStrokeWidth: 10,
  });
  const brush = { ...fine, currentItemPenMode: "brush" as const };
  expect(scaleWhiteboardPen(brush, 2, 20).currentItemStrokeWidth).toBeCloseTo(
    8 / 3,
  );
  const thick = { ...fine, ...switchWhiteboardTip(fine, "thick") };
  const update = scaleWhiteboardPen(thick, 1.5);
  expect(update.currentItemStrokeWidth).toBeUndefined();
  expect({ ...thick, ...update }.currentItemStrokeWidth).toBe(
    thick.currentItemStrokeWidth,
  );
  expect(
    switchWhiteboardTip({ ...thick, ...update }, "fine").currentItemStrokeWidth,
  ).toBe(3);
});

it("retains distinct fine/thick modes, widths, colours and assistance across saving and switching", () => {
  const fine = {
    ...getDefaultAppState(),
    currentItemStrokeColor: "#ff0000",
    currentItemStrokeWidth: 2,
    currentItemPenMode: "brush" as const,
    whiteboardPenWidths: { hard: 1 },
    currentItemInkAssist: undefined,
  };
  const thick = {
    ...fine,
    ...switchWhiteboardTip(fine, "thick"),
    currentItemStrokeColor: "#0000ff",
    currentItemStrokeWidth: 3,
    currentItemInkAssist: "function" as const,
  };
  expect(thick.currentItemPenMode).toBe("hard");
  const returned = { ...thick, ...switchWhiteboardTip(thick, "fine") };
  expect(returned).toMatchObject({
    currentItemPenMode: "brush",
    currentItemStrokeWidth: 2,
    currentItemStrokeColor: "#ff0000",
    whiteboardPenWidths: { hard: 1 },
  });
  const saved = restoreAppState(JSON.parse(JSON.stringify(returned)), null);
  expect(switchWhiteboardTip(saved, "thick")).toMatchObject({
    currentItemStrokeWidth: 3,
    currentItemStrokeColor: "#0000ff",
    currentItemInkAssist: "function",
  });
});

it("selects profiles per contact with a measured threshold and never mutates the other active pen", () => {
  const state = {
    ...getDefaultAppState(),
    whiteboardDualPen: true,
    whiteboardThickThreshold: 8,
    whiteboardPenTips: {
      thick: { mode: "brush" as const, color: "#0000ff", width: 2 },
    },
  };
  const snapshot = JSON.stringify(state);
  expect(
    contactPenPreferences(state, { width: 9, height: 7 }).whiteboardPenTip,
  ).toBeUndefined();
  const thick = contactPenPreferences(state, { width: 8, height: 9 });
  expect(thick).toMatchObject({
    whiteboardPenTip: "thick",
    currentItemPenMode: "brush",
    currentItemStrokeColor: "#0000ff",
  });
  expect(JSON.stringify(state)).toBe(snapshot);
  expect(
    contactPenPreferences(
      { ...state, whiteboardThickThreshold: undefined },
      { width: 100, height: 100 },
    ).whiteboardPenTip,
  ).toBeUndefined();
  expect(
    contactPenPreferences(
      { ...state, whiteboardDualPen: false },
      { width: 100, height: 100 },
      { dualPen: true, thickThreshold: 8 },
    ).whiteboardPenTip,
  ).toBeUndefined();
});

it.each([0.5, 1, 2])(
  "uses the same physical style in board and normalized courseware at zoom %s",
  (zoom) => {
    const state = {
      ...getDefaultAppState(),
      currentItemPenMode: "brush" as const,
      whiteboardBrushVariation: 12,
    };
    const profile = {
      hardPenWidth: 4 / 3,
      brushPenWidth: 5,
      eraserSize: 50,
      palmThreshold: 36,
    };
    const contact = { width: 1, height: 1, pointerType: "pen" };
    const board = whiteboardInkStyle(state, contact, profile, 1 / zoom);
    const courseware = whiteboardInkStyle(
      state,
      contact,
      profile,
      1000 / (1920 * zoom),
    );
    expect(board.strokeWidth * zoom).toBeCloseTo(
      (courseware.strokeWidth * 1920 * zoom) / 1000,
    );
    expect(courseware.customData.fcInk.variation).toBe(12);
    expect(courseware.simulatePressure).toBe(false);
  },
);
