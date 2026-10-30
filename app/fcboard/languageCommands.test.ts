import { convertToFcboardElements } from "@fcboard/fcboard";
import { getDefaultAppState } from "@fcboard/fcboard/appState";
import { newFreeDrawElement } from "@fcboard/element";
import { pointFrom } from "@fcboard/math";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import type { FcboardElement } from "@fcboard/element/types";

import { classroomCommands } from "./commands";
import { registerCanvasCommands } from "./canvasCommands";
import { registerLanguageCommands } from "./languageCommands";
import { languageStudy } from "./test/language";
import * as language from "./languageStudy";
import * as ocr from "./ocr";
import { inkLineHeight } from "./handwriting";

import type { InkStroke } from "./documents";

const setup = () => {
  let scene: readonly FcboardElement[] = convertToFcboardElements([
    {
      type: "text",
      text: languageStudy.term,
      x: 150,
      y: 100,
      fontSize: 32,
      strokeColor: "#b52a25",
    },
  ]);
  const source = scene[0];
  const listeners = new Set<() => void>();
  const state = {
    ...getDefaultAppState(),
    width: 1600,
    height: 900,
    selectedElementIds: { [source.id]: true },
  };
  const api = {
    id: "translation-board",
    getAppState: () => state,
    getSceneElements: () => scene,
    onChange: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    updateScene: vi.fn((update) => {
      if (update.elements) {
        scene = update.elements;
      }
      if (update.appState) {
        Object.assign(state, update.appState);
      }
      listeners.forEach((listener) => listener());
    }),
  } as unknown as FcboardImperativeAPI;
  const explain = vi
    .spyOn(language, "explainLanguage")
    .mockResolvedValue(languageStudy);
  const recognize = vi
    .spyOn(ocr, "recognizeHandwriting")
    .mockResolvedValue(languageStudy.term);
  const stops = [registerCanvasCommands(api), registerLanguageCommands(api)];
  return {
    api,
    source,
    state,
    explain,
    recognize,
    stop: () => stops.reverse().forEach((stop) => stop()),
  };
};
afterEach(() => vi.restoreAllMocks());

it("translates exact editable selection without OCR, preserves source and returns the new visible object ids", async () => {
  const { api, source, explain, recognize, stop } = setup();
  try {
    const result = (await classroomCommands.execute({
      name: "language.translate",
      args: { targetLanguage: "zh-CN", presentation: "text" },
    })) as { ids: string[]; translation: string };
    expect(explain).toHaveBeenCalledWith(
      languageStudy.term,
      expect.any(AbortSignal),
      "zh-CN",
    );
    expect(recognize).not.toHaveBeenCalled();
    expect(result.translation).toBe(languageStudy.translation);
    expect(result.ids).toHaveLength(1);
    expect(
      api.getSceneElements().find((element) => element.id === source.id),
    ).toEqual(source);
    const inserted = api
      .getSceneElements()
      .find((element) => result.ids.includes(element.id))!;
    expect(inserted).toMatchObject({
      type: "text",
      originalText: languageStudy.translation,
      strokeColor: source.strokeColor,
      fontSize: 32,
    });
    expect(inserted.y).toBeGreaterThan(source.y + source.height);
  } finally {
    stop();
  }
});

it("reads mixed handwriting and editable text once and offers read-only translation without adding elements", async () => {
  const { api, source, explain, recognize, stop } = setup();
  const ink = newFreeDrawElement({
    type: "freedraw",
    x: 260,
    y: 200,
    points: [pointFrom(0, 0), pointFrom(80, 40)],
    simulatePressure: true,
  });
  try {
    api.updateScene({ elements: [source, ink] });
    await classroomCommands.execute({
      name: "language.translate",
      args: { sourceIds: [source.id, ink.id], insert: false },
    });
    expect(recognize.mock.calls[0][5]).toEqual([
      [
        [260, 200],
        [340, 240],
      ],
    ]);
    expect(explain.mock.calls[0][0]).toBe(
      `${languageStudy.term}\n${languageStudy.term}`,
    );
    expect(api.getSceneElements()).toHaveLength(2);
  } finally {
    stop();
  }
});

it("inserts a translated answer at 90 percent of the measured handwritten size", async () => {
  const { api, recognize, stop } = setup();
  const ink = newFreeDrawElement({
    type: "freedraw",
    x: 150,
    y: 100,
    points: [pointFrom(0, 0), pointFrom(80, 40), pointFrom(130, 0)],
    simulatePressure: true,
    strokeColor: "#b52a25",
  });
  try {
    api.updateScene({ elements: [ink] });
    const result = (await classroomCommands.execute({
      name: "language.translate",
      args: { sourceIds: [ink.id], presentation: "text" },
    })) as { ids: string[] };
    expect(recognize).toHaveBeenCalledTimes(1);
    const output = api
      .getSceneElements()
      .find((element) => result.ids.includes(element.id))!;
    expect(output.type === "text" && output.fontSize).toBeCloseTo(
      inkLineHeight([ink], 1) * 0.9,
    );
    expect(output.strokeColor).toBe(ink.strokeColor);
  } finally {
    stop();
  }
});

it.each(["edit", "page", "abort"])(
  "rejects a late translation after %s and leaves the visible canvas untouched",
  async (change) => {
    const { api, source, explain, stop } = setup();
    let finish!: (value: typeof languageStudy) => void;
    explain.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new AbortController();
    let documentStop: (() => void) | undefined;
    try {
      const operation = classroomCommands.execute({
        name: "language.translate",
        args: { signal: controller.signal },
      });
      if (change === "edit") {
        api.updateScene({ elements: [] });
      } else if (change === "page") {
        documentStop = classroomCommands.context("document", () => ({
          id: "new-file",
          page: 1,
          ink: [],
        }));
      } else {
        controller.abort();
      }
      finish(languageStudy);
      await expect(operation).rejects.toMatchObject({ name: "AbortError" });
      expect(
        api.getSceneElements().some((element) => element.id !== source.id),
      ).toBe(false);
    } finally {
      documentStop?.();
      stop();
    }
  },
);

it("translates the visible document selection and writes through its real command path instead of the covered whiteboard", async () => {
  const { api, explain, recognize, stop } = setup();
  let ink: InkStroke[] = [
    {
      id: "visible-note",
      text: languageStudy.term,
      points: [[100, 100]],
      color: "#000000",
      width: 2,
    },
  ];
  const stops = [
    classroomCommands.context("document", () => ({
      id: "lesson",
      page: 2,
      selection: ["visible-note"],
      ink,
    })),
    classroomCommands.register("document.draw", "@internal", () => {}),
    classroomCommands.register("document.text", "@internal", (args) => {
      expect(args).toMatchObject({
        sourceIds: ["visible-note"],
        placement: "below",
        text: languageStudy.translation,
      });
      ink = [
        ...ink,
        {
          id: "visible-translation",
          text: String(args.text),
          points: [[100, 140]],
          color: "#000000",
          width: 2,
        },
      ];
      classroomCommands.changed("document");
    }),
  ];
  try {
    vi.spyOn(api, "getSceneElements").mockImplementation(() => {
      throw new Error("The covered whiteboard must not be read");
    });
    const result = (await classroomCommands.execute({
      name: "language.translate",
      args: { targetLanguage: "zh-CN" },
    })) as { ids: string[] };
    expect(explain.mock.calls[0][0]).toBe(languageStudy.term);
    expect(recognize).not.toHaveBeenCalled();
    expect(result.ids).toEqual(["visible-translation"]);
    expect(api.updateScene).not.toHaveBeenCalled();
  } finally {
    stops.reverse().forEach((stop) => stop());
    stop();
  }
});

it("validates all explicit sources and input before making a translation request", async () => {
  const { source, explain, stop } = setup();
  try {
    await expect(
      classroomCommands.execute({
        name: "language.translate",
        args: { sourceIds: [source.id, "deleted"] },
      }),
    ).rejects.toThrow();
    await expect(
      classroomCommands.execute({
        name: "language.translate",
        args: { targetLanguage: "<script>" },
      }),
    ).rejects.toThrow();
    expect(explain).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});
