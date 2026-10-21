import type { AppState, NormalizedZoomValue } from "../types";

export const getStateForZoom = (
  {
    viewportX,
    viewportY,
    nextZoom,
  }: {
    viewportX: number;
    viewportY: number;
    nextZoom: NormalizedZoomValue;
  },
  appState: AppState,
) => {
  const appLayerX = viewportX - appState.offsetLeft;
  const appLayerY = viewportY - appState.offsetTop;

  const currentZoom = appState.zoom.value;

  // get original scroll position without zoom
  const baseScrollX = appState.scrollX + (appLayerX - appLayerX / currentZoom);
  const baseScrollY = appState.scrollY + (appLayerY - appLayerY / currentZoom);

  // get scroll offsets for target zoom level
  const zoomOffsetScrollX = -(appLayerX - appLayerX / nextZoom);
  const zoomOffsetScrollY = -(appLayerY - appLayerY / nextZoom);

  return {
    scrollX: baseScrollX + zoomOffsetScrollX,
    scrollY: baseScrollY + zoomOffsetScrollY,
    zoom: {
      value: nextZoom,
    },
  };
};

/** Keep the scene point under the old centroid under the new centroid. */
export const getStateForPinch = (
  previous: { x: number; y: number },
  center: { x: number; y: number },
  nextZoom: NormalizedZoomValue,
  appState: AppState,
) => {
  const state = getStateForZoom(
    { viewportX: previous.x, viewportY: previous.y, nextZoom },
    appState,
  );
  return {
    ...state,
    scrollX: state.scrollX + (center.x - previous.x) / nextZoom,
    scrollY: state.scrollY + (center.y - previous.y) / nextZoom,
  };
};
