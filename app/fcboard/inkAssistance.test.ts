import { act } from "@testing-library/react";
import { newFreeDrawElement } from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type {
  DataURL,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import { observeInkAssistance } from "./inkAssistance";
import { saveSettings, defaults } from "./settings";
import * as ai from "./ai";
import * as ocr from "./ocr";
import { classroomCommands } from "./commands";
import { validatedPlot } from "./mathRecognition";
import { drawPlot } from "./board";
import { handwritingText } from "./handwriting";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
});

const setup = (
  mode: "text" | "shape" | "function" | "calculation" | "magic",
) => {
  let scene: readonly ExcalidrawElement[] = [];
  let refresh = () => {};
  const api = {
    getSceneElements: () => scene,
    getAppState: () => ({
      scrollX: 0,
      scrollY: 0,
      width: 1600,
      height: 900,
      zoom: { value: 1 },
      currentItemInkAssist: mode,
      cursorButton: "up",
      activeTool: { type: "freedraw" },
    }),
    onChange: (callback: () => void) => {
      refresh = callback;
      return () => {};
    },
    addFiles: vi.fn(),
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
    image:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==" as DataURL,
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

it("uses the mode saved on the contact's ink rather than the other pen's selected profile", async () => {
  vi.useFakeTimers();
  const { api, ink, draw } = setup("text");
  ink.customData!.fcInk.assist = "calculation";
  const recognize = vi
    .spyOn(ocr, "recognizeHandwriting")
    .mockResolvedValue("1+1=");
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
    expect(recognize.mock.calls[0][3]).toBe("math");
    expect(
      handwritingText(
        api.getSceneElements().filter((element) => element.id !== ink.id),
      ),
    ).toEqual(["2"]);
  } finally {
    stop();
  }
});

it("never starts automatic conversion on the hidden board while courseware is visible", async () => {
  vi.useFakeTimers();
  const { api, draw } = setup("text");
  const recognize = vi.spyOn(ocr, "recognizeHandwriting");
  const document = classroomCommands.register(
    "document.draw",
    "@internal",
    () => {},
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
    expect(recognize).not.toHaveBeenCalled();
    expect(api.updateScene).not.toHaveBeenCalled();
  } finally {
    stop();
    document();
  }
});

it.each(["function", "calculation"] as const)(
  "runs the %s pen locally without switching tools or opening AI",
  async (mode) => {
    vi.useFakeTimers();
    const { api, ink, draw, append } = setup(mode);
    saveSettings({ ...defaults, apiKey: "", model: "" }, false);
    vi.spyOn(ocr, "recognizeHandwriting").mockResolvedValue(
      mode === "function" ? "y=x^2" : "0.1+0.2",
    );
    const cloud = vi.spyOn(ai, "chat");
    const route = vi.fn((args) =>
      drawPlot(api, validatedPlot(args), { x: 500, y: 420 }),
    );
    const unregister = classroomCommands.register("math.plot", "test", route);
    const error = vi.fn();
    const stop = observeInkAssistance(api, () => {}, error);
    try {
      draw();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      const result = api
        .getSceneElements()
        .filter((element) => element.id !== ink.id);
      expect(result.length).toBeGreaterThan(0);
      expect(api.getSceneElements()).toContain(ink);
      expect(cloud).not.toHaveBeenCalled();
      expect(ai.boardContext).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      if (mode === "function") {
        expect(route).toHaveBeenCalledWith(
          expect.objectContaining({ expression: "x^2", quiet: true }),
        );
        expect(result.every((element) => element.customData?.fcPlot)).toBe(
          true,
        );
      } else {
        expect(handwritingText(result)).toEqual(["= 0.3"]);
      }
      append();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      // Previously handled ink is not submitted again as part of the next formula.
      expect(ocr.recognizeHandwriting).toHaveBeenLastCalledWith(
        expect.any(Function),
        expect.any(AbortSignal),
        expect.any(Function),
        "math",
        expect.any(Function),
        expect.any(Array),
      );
      expect(vi.mocked(ocr.recognizeHandwriting).mock.calls[1][5]).toHaveLength(
        1,
      );
    } finally {
      stop();
      unregister();
    }
  },
);

it("quietly preserves an invalid function and discards late math after erasing", async () => {
  vi.useFakeTimers();
  const { api, ink, draw, erase } = setup("function");
  saveSettings({ ...defaults, apiKey: "", model: "" }, false);
  const recognize = vi
    .spyOn(ocr, "recognizeHandwriting")
    .mockResolvedValue("y=unknown(x)");
  const error = vi.fn();
  const stop = observeInkAssistance(api, () => {}, error);
  try {
    draw();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(api.getSceneElements()).toEqual([ink]);
    expect(api.updateScene).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    erase();
    let finish!: (value: string) => void;
    recognize.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    // A new observer represents a fresh drawing session after the invalid source was removed.
    stop();
    const fresh = observeInkAssistance(api, () => {}, error);
    draw();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    erase();
    await act(async () => {
      finish("y=x^2");
    });
    expect(api.updateScene).not.toHaveBeenCalled();
    fresh();
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
    expect(recognizer.mock.calls[1][5]).toHaveLength(2);
    expect(ai.boardContext).not.toHaveBeenCalled();
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

it("turns a drawn dog into a generated hand-drawn image at its original location", async () => {
  vi.useFakeTimers();
  const { api, ink, draw } = setup("magic");
  saveSettings(
    {
      ...defaults,
      model: "recognizer",
      apiKey: "mock-key",
      imageModel: "illustrator",
    },
    false,
  );
  vi.spyOn(ai, "chat").mockResolvedValue('{"description":"一只坐着的小狗"}');
  const fetcher = vi.fn().mockResolvedValue({
    status: 200,
    json: async () => ({
      data: [
        {
          b64_json:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
        },
      ],
    }),
  });
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 100;
      naturalHeight = 100;
      src = "";
      decode = async () => {};
    },
  );
  const stop = observeInkAssistance(api, () => {}, vi.fn());
  try {
    draw();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const request = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(request.model).toBe("illustrator");
    expect(request.prompt).toContain("一只坐着的小狗");
    expect(request.prompt).toContain("手绘");
    expect(api.getSceneElements()).toHaveLength(1);
    const generated = api.getSceneElements()[0];
    expect(generated).toMatchObject({
      type: "image",
      x: 120,
      y: 100,
      width: 60,
      height: 60,
    });
    expect(generated.id).not.toBe(ink.id);
    expect(api.addFiles).toHaveBeenCalledTimes(1);
    expect(api.updateScene).toHaveBeenCalledTimes(1);
  } finally {
    stop();
  }
});

it("keeps a magic sketch and sends no recognition request when its capture is unavailable", async () => {
  vi.useFakeTimers();
  const { api, ink, draw } = setup("magic");
  saveSettings(
    {
      ...defaults,
      apiKey: "test-only",
      model: "recognizer",
      imageModel: "illustrator",
    },
    false,
  );
  vi.mocked(ai.boardContext).mockResolvedValue({
    elements: [ink],
    text: "",
    image: undefined,
  });
  vi.spyOn(ai, "chat").mockResolvedValue('{"description":"猜测的图示"}');
  const stop = observeInkAssistance(api, () => {}, vi.fn());
  try {
    draw();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(ai.chat).not.toHaveBeenCalled();
    expect(api.getSceneElements()).toEqual([ink]);
    expect(api.addFiles).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});
