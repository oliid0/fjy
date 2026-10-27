import { DEFAULT_ELEMENT_PROPS } from "@excalidraw/common";

import type { FactoryInkData } from "@excalidraw/element/factoryInk";

import type { AppState } from "./types";
import type { UIOptions } from "./types";

export type PenPreferences = Pick<
  AppState,
  | "currentItemStrokeWidth"
  | "currentItemPenMode"
  | "whiteboardPenWidths"
  | "currentItemStrokeColor"
  | "currentItemInkAssist"
  | "whiteboardPenTip"
  | "whiteboardPenTips"
  | "whiteboardDualPen"
  | "whiteboardThickThreshold"
>;

/** HPenSettingWindow selects a profile to edit; HTool chooses one per contact. */
export const switchWhiteboardTip = (
  state: PenPreferences,
  tip: "fine" | "thick",
) => {
  const previous = state.whiteboardPenTip || "fine";
  if (tip === previous) {
    return {
      currentItemStrokeColor: state.currentItemStrokeColor,
      currentItemStrokeWidth: state.currentItemStrokeWidth,
    };
  }
  const profiles = {
    ...state.whiteboardPenTips,
    [previous]: {
      mode: state.currentItemPenMode || "hard",
      color: state.currentItemStrokeColor,
      width: state.currentItemStrokeWidth,
      widths: state.whiteboardPenWidths,
      assist: state.currentItemInkAssist,
    },
  };
  // BaseApplication.PEN_WIDTH_THICK=2; the fine hard pen defaults to 4.
  const next = profiles[tip] || {
    mode: "hard" as const,
    color: state.currentItemStrokeColor,
    width: DEFAULT_ELEMENT_PROPS.strokeWidth * (tip === "thick" ? 0.5 : 1),
    widths: undefined,
    assist: undefined,
  };
  return {
    whiteboardPenTip: tip,
    whiteboardPenTips: profiles,
    currentItemPenMode: next.mode,
    currentItemStrokeColor: next.color,
    currentItemStrokeWidth: next.width,
    whiteboardPenWidths: next.widths,
    currentItemInkAssist: next.assist,
  };
};

export const contactPenPreferences = <T extends PenPreferences>(
  state: T,
  contact: { width: number; height: number },
  device?: { thickThreshold?: number; dualPen?: boolean },
): T => {
  const threshold = state.whiteboardThickThreshold ?? device?.thickThreshold;
  if (
    !(state.whiteboardDualPen ?? device?.dualPen) ||
    !threshold ||
    !Number.isFinite(threshold) ||
    threshold <= 0
  ) {
    return state;
  }
  const size = Math.min(contact.width, contact.height);
  const tip = Number.isFinite(size) && size >= threshold ? "thick" : "fine";
  return { ...state, ...switchWhiteboardTip(state, tip) };
};

/** One calibrated style for the main canvas and courseware's normalized coordinates. */
export const whiteboardInkStyle = (
  state: PenPreferences &
    Pick<
      AppState,
      "currentItemOpacity" | "whiteboardBrushVariation" | "whiteboardHardNib"
    >,
  contact: { width: number; height: number; pointerType: string },
  device: UIOptions["inkProfile"] | undefined,
  sceneUnitsPerCssPixel: number,
) => {
  const pen = contactPenPreferences(state, contact, device);
  const mode = pen.currentItemPenMode || "hard";
  const fcInk: FactoryInkData = {
    version: mode === "brush" ? 3 : 2,
    pen: mode,
    assist: pen.currentItemInkAssist,
    tip: pen.whiteboardPenTip || "fine",
    variation: state.whiteboardBrushVariation ?? 45,
    ...(mode === "hard"
      ? {
          nib:
            device?.hardNibAvailable !== false &&
            (state.whiteboardHardNib ?? device?.hardNib ?? false),
        }
      : {}),
    unit: ((device?.hardPenWidth ?? 4) / 4) * sceneUnitsPerCssPixel,
  };
  return {
    strokeColor: pen.currentItemStrokeColor,
    strokeWidth:
      (pen.currentItemStrokeWidth / DEFAULT_ELEMENT_PROPS.strokeWidth) *
      (mode === "brush"
        ? device?.brushPenWidth ?? 15
        : device?.hardPenWidth ?? 4) *
      sceneUnitsPerCssPixel,
    opacity:
      mode === "highlighter"
        ? Math.round((state.currentItemOpacity * 110) / 255)
        : state.currentItemOpacity,
    simulatePressure:
      contact.pointerType !== "pen" &&
      !(contact.pointerType === "touch" && device?.touchPressure === true),
    strokeStyle: mode === "dashed" ? ("dashed" as const) : ("solid" as const),
    customData: { fcInk },
  };
};

/** HDataSet keeps PenWidth and BZPenWidth separately; colour stays shared. */
export const switchWhiteboardPen = (
  state: Pick<
    AppState,
    "currentItemStrokeWidth" | "currentItemPenMode" | "whiteboardPenWidths"
  >,
  mode: NonNullable<AppState["currentItemPenMode"]>,
): Pick<
  AppState,
  "currentItemStrokeWidth" | "currentItemPenMode" | "whiteboardPenWidths"
> => {
  const previous = state.currentItemPenMode === "brush" ? "brush" : "hard";
  const next = mode === "brush" ? "brush" : "hard";
  const widths = {
    ...state.whiteboardPenWidths,
    [previous]: state.currentItemStrokeWidth,
  };
  return {
    whiteboardPenWidths: widths,
    currentItemPenMode: mode,
    currentItemStrokeWidth: widths[next] || DEFAULT_ELEMENT_PROPS.strokeWidth,
  };
};
