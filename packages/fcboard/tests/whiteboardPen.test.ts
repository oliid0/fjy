import { getDefaultAppState } from "../appState";
import { restoreAppState } from "../data/restore";
import {
  contactPenPreferences,
  switchWhiteboardTip,
  whiteboardInkStyle,
} from "../whiteboardPen";

it("retains distinct fine/thick modes, widths, colours and assistance across saving and switching", () => {
  const fine = {
    ...getDefaultAppState(),
    whiteboardPenTip: "fine" as const,
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
    whiteboardPenTip: "fine" as const,
    whiteboardDualPen: true,
    whiteboardThickThreshold: 8,
    whiteboardPenTips: {
      thick: { mode: "brush" as const, color: "#0000ff", width: 2 },
    },
  };
  const snapshot = JSON.stringify(state);
  expect(
    contactPenPreferences(state, { width: 9, height: 7 }).whiteboardPenTip,
  ).toBe("fine");
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
  ).toBe(state.whiteboardPenTip);
  expect(
    contactPenPreferences(
      { ...state, whiteboardDualPen: false },
      { width: 100, height: 100 },
      { dualPen: true, thickThreshold: 8 },
    ).whiteboardPenTip,
  ).toBe(state.whiteboardPenTip);
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

it("keeps independent native gradients through tip switches and restored browser preferences", () => {
  const state = {
    ...getDefaultAppState(),
    whiteboardPenTip: "fine" as const,
    currentItemInkGradient: "mint" as const,
  };
  const thick = {
    ...state,
    ...switchWhiteboardTip(state, "thick"),
    currentItemInkGradient: "spectrum" as const,
  };
  const fine = { ...thick, ...switchWhiteboardTip(thick, "fine") };
  const saved = restoreAppState(JSON.parse(JSON.stringify(fine)), null);
  expect(saved.currentItemInkGradient).toBe("mint");
  expect(switchWhiteboardTip(saved, "thick").currentItemInkGradient).toBe(
    "spectrum",
  );
  expect(
    whiteboardInkStyle(
      saved,
      { width: 1, height: 1, pointerType: "pen" },
      undefined,
      2,
    ).customData.fcInk.gradient,
  ).toEqual({ palette: "mint", size: 640 / Math.max(1, devicePixelRatio) });
});

it("migrates reversed stored tip names once without losing custom styles or changing ink width", () => {
  const legacy = {
    ...getDefaultAppState(),
    whiteboardPenTipsVersion: undefined,
    whiteboardPenTip: "fine" as const,
    currentItemStrokeWidth: 2,
    currentItemStrokeColor: "#ff0000",
    whiteboardPenTips: {
      thick: { mode: "hard" as const, color: "#0000ff", width: 1 },
    },
  };
  const saved = restoreAppState(legacy, null);
  expect(saved).toMatchObject({
    whiteboardPenTip: "thick",
    currentItemStrokeWidth: 2,
  });
  expect(switchWhiteboardTip(saved, "fine")).toMatchObject({
    currentItemStrokeWidth: 1,
    currentItemStrokeColor: "#0000ff",
  });
  const reloaded = restoreAppState(JSON.parse(JSON.stringify(saved)), null);
  expect(reloaded.whiteboardPenTipsVersion).toBe(2);
  expect(reloaded.whiteboardPenTip).toBe(saved.whiteboardPenTip);
  expect(reloaded.whiteboardPenTips).toEqual(saved.whiteboardPenTips);
  expect(reloaded.currentItemStrokeWidth).toBe(saved.currentItemStrokeWidth);
  expect(switchWhiteboardTip(reloaded, "fine")).toEqual(
    switchWhiteboardTip(saved, "fine"),
  );
});
