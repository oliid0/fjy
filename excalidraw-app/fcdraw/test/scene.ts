import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

export const sceneAPI = () => {
  let scene: readonly ExcalidrawElement[] = convertToExcalidrawElements([
    { type: "text", text: "学生的题目", x: 10, y: 10 },
  ]);
  const api = {
    getSceneElements: () => scene,
    getAppState: () => ({
      scrollX: 0,
      scrollY: 0,
      width: 1600,
      height: 900,
      zoom: { value: 1 },
      selectedElementIds: {},
    }),
    addFiles: vi.fn(),
    updateScene: vi.fn((update) => {
      if (update.elements) {
        scene = update.elements;
      }
    }),
  } as unknown as ExcalidrawImperativeAPI;
  return api;
};
