import { convertToFcboardElements } from "@fcboard/fcboard";
import { getDefaultAppState } from "@fcboard/fcboard/appState";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";
import type { FcboardElement } from "@fcboard/element/types";

export const splitSceneAPI = (): FcboardImperativeAPI => {
  const api = sceneAPI();
  let state = { ...getDefaultAppState(), ...api.getAppState() };
  const listeners = new Set<() => void>();
  return {
    ...api,
    getAppState: () => state,
    onChange: (listener) => {
      const notify = () => listener(api.getSceneElements(), state, {});
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    updateScene: (update) => {
      api.updateScene(update);
      state = { ...state, ...update.appState };
      listeners.forEach((notify) => notify());
    },
  };
};

export const sceneAPI = () => {
  let tool = { type: "selection", customType: null };
  let scene: readonly FcboardElement[] = convertToFcboardElements([
    { type: "text", text: "学生的题目", x: 10, y: 10 },
  ]);
  const api = {
    getSceneElements: () =>
      scene.some((element) => element.isDeleted)
        ? scene.filter((element) => !element.isDeleted)
        : scene,
    getSceneElementsIncludingDeleted: () => scene,
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
