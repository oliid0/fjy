import { DEFAULT_ELEMENT_PROPS } from "@excalidraw/common";

import type { AppState } from "./types";

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
