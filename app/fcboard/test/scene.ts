import { convertToFcboardElements } from "@fcboard/fcboard";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";
import type { FcboardElement } from "@fcboard/element/types";

export const sceneAPI = () => {
  let tool = { type: "selection", customType: null };
  let scene: readonly FcboardElement[] = convertToFcboardElements([
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
      activeTool: tool,
    }),
    setActiveTool: vi.fn((value) => {
      tool = { ...tool, ...value };
    }),
    addFiles: vi.fn(),
    updateScene: vi.fn((update) => {
      if (update.elements) {
        scene = update.elements;
      }
    }),
  } as unknown as FcboardImperativeAPI;
  return api;
};
