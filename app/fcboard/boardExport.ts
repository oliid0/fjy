import { newFrameElement } from "@fcboard/element";

import type { AppState } from "@fcboard/fcboard/types";

import type { Board, Workspace } from "./boards";

export type BoardCanvasSize = {
  width: number;
  height: number;
  pixelRatio: number;
};
export type BoardPages = Workspace & { canvasSize: BoardCanvasSize };

const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/** HSlide.createBitmap uses the current device canvas, including its empty area. */
export const boardCanvasSize = (
  state?: Partial<Pick<AppState, "width" | "height">>,
): BoardCanvasSize => ({
  width: positive(state?.width) ? state.width : innerWidth,
  height: positive(state?.height) ? state.height : innerHeight,
  pixelRatio: positive(devicePixelRatio) ? devicePixelRatio : 1,
});

/** A temporary export frame never enters the scene, selection or undo history. */
export const boardPageExportOptions = (
  board: Pick<Board, "elements" | "files" | "view">,
  size: BoardCanvasSize,
  maxEdge = 4096,
) => {
  if (![size.width, size.height, size.pixelRatio, maxEdge].every(positive)) {
    throw new Error("Invalid whiteboard canvas size");
  }
  const zoom = board.view.zoom?.value ?? 1;
  const scrollX = board.view.scrollX ?? 0;
  const scrollY = board.view.scrollY ?? 0;
  if (!positive(zoom) || !Number.isFinite(scrollX + scrollY)) {
    throw new Error("Invalid whiteboard view");
  }
  const exportingFrame = newFrameElement({
    x: -scrollX,
    y: -scrollY,
    width: size.width / zoom,
    height: size.height / zoom,
  });
  const scale =
    zoom *
    size.pixelRatio *
    Math.min(
      1,
      maxEdge / (Math.max(size.width, size.height) * size.pixelRatio),
    );
  return {
    elements: board.elements.filter((element) => !element.isDeleted),
    files: board.files,
    appState: {
      ...board.view,
      exportBackground: true,
      exportWithDarkMode: false,
    },
    exportingFrame,
    exportPadding: 0,
    getDimensions: (width: number, height: number) => ({
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
      scale,
    }),
  };
};
