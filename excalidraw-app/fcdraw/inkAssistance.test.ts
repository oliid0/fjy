import { act } from "@testing-library/react";
import { newFreeDrawElement } from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { observeInkAssistance } from "./inkAssistance";
import { saveSettings, defaults } from "./settings";
import * as ai from "./ai";
import * as ocr from "./ocr";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
});

const setup = (mode: "text" | "shape") => {
  let scene: readonly ExcalidrawElement[] = [];
  let refresh = () => {};
  const api = {
    getSceneElements: () => scene,
    getAppState: () => ({
      currentItemInkAssist: mode,
      cursorButton: "up",
      activeTool: { type: "freedraw" },
    }),
    onChange: (callback: () => void) => {
      refresh = callback;
      return () => {};
    },
    updateScene: vi.fn((update) => {
      scene = update.elements;
      refresh();
    }),
  } as unknown as ExcalidrawImperativeAPI;
  const ink = newFreeDrawElement({
    type: "freedraw",
    x: 100,
    y: 100,
    points: [pointFrom(0, 0), pointFrom(100, 60)],
    strokeColor: "#ff0000",
    simulatePressure: true,
    customData: { fcInk: { version: 2, pen: "hard", assist: mode } },
  });
  vi.spyOn(ai, "boardContext").mockResolvedValue({
    elements: [ink],
    text: "",
    image: undefined,
  });
  saveSettings(
    { ...defaults, model: "mock-vision", apiKey: "mock-key" },
    false,
  );
  return {
    api,
    ink,
    draw: () => {
      scene = [ink];
      refresh();
    },
    append: () => {
      scene = [...scene, { ...ink, id: "second-stroke", x: 240 }];
      refresh();
    },
    erase: () => {
      scene = [];
      refresh();
    },
  };
};

it.each(["text", "shape"] as const)(
  "keeps %s pen ink until a validated result is ready",
  async (mode) => {
    vi.useFakeTimers();
    const { api, ink, draw } = setup(mode);
    let finish!: (value: string) => void;
    const recognizer =
      mode === "text"
        ? vi.spyOn(ocr, "recognizeHandwriting")
        : vi.spyOn(ai, "chat");
    recognizer.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const error = vi.fn();
    const stop = observeInkAssistance(api, () => {}, error);
    try {
      draw();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      expect(api.getSceneElements()).toEqual([ink]);
      expect(recognizer).toHaveBeenCalledTimes(1);
      expect(recognizer.mock.calls[0][1]?.aborted).toBe(false);
      await act(async () => {
        finish(mode === "text" ? "牛顿定律" : '{"shape":"ellipse"}');
      });
      expect(error.mock.calls).toEqual([]);
      expect(api.getSceneElements()).toHaveLength(1);
      expect(api.getSceneElements()[0].type).toBe(
        mode === "text" ? "text" : "ellipse",
      );
      expect(api.getSceneElements()[0].strokeColor).toBe("#ff0000");
      expect(api.updateScene).toHaveBeenCalledTimes(1);
      expect(error).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  },
);

it("discards a late recognition after the user erases its source", async () => {
  vi.useFakeTimers();
  const { api, draw, erase } = setup("text");
  let finish!: (value: string) => void;
  vi.spyOn(ocr, "recognizeHandwriting").mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const stop = observeInkAssistance(
    api,
    () => {},
    () => {},
  );
  try {
    draw();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    erase();
    await act(async () => {
      finish("迟到结果");
    });
    expect(api.getSceneElements()).toHaveLength(0);
    expect(api.updateScene).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});

it("retries the whole unfinished word when new ink cancels a pending text recognition", async () => {
  vi.useFakeTimers();
  const { api, ink, draw, append } = setup("text");
  const complete: ((text: string) => void)[] = [];
  const recognizer = vi
    .spyOn(ocr, "recognizeHandwriting")
    .mockImplementation(() => new Promise((resolve) => complete.push(resolve)));
  const stop = observeInkAssistance(api, () => {}, vi.fn());
  try {
    draw();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    append();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(recognizer).toHaveBeenCalledTimes(2);
    expect(recognizer.mock.calls[0][1].aborted).toBe(true);
    expect(vi.mocked(ai.boardContext).mock.calls[1][2]).toHaveLength(2);
    expect(api.getSceneElements()).toHaveLength(2);
    await act(async () => {
      complete[0]("旧识别");
      complete[1]("完整词语");
    });
    expect(api.getSceneElements()).toHaveLength(1);
    const result = api.getSceneElements()[0];
    expect(result.type === "text" && result.text).toBe("完整词语");
    expect(result.customData?.fcRecognizedSource).toEqual([
      ink.id,
      "second-stroke",
    ]);
  } finally {
    stop();
  }
});
