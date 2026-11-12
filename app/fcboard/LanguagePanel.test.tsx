import { act, fireEvent, screen } from "@testing-library/react";
import { getDefaultAppState } from "@fcboard/fcboard/appState";
import { defaultLang, languages, setLanguage, t } from "@fcboard/fcboard/i18n";
import {
  duplicateElements,
  getCommonBounds,
  newElementWith,
  newFreeDrawElement,
} from "@fcboard/element";
import { pointFrom } from "@fcboard/math";

import { convertToFcboardElements } from "@fcboard/fcboard";

import type { FcboardElement } from "@fcboard/element/types";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import type { LocalPoint } from "@fcboard/math";

import { render } from "./test/render";
import { languageStudy } from "./test/language";
import { LanguagePanel, readLanguageCard } from "./LanguagePanel";

import { registerLanguageCommands } from "./languageCommands";
import { observeInkAssistance } from "./inkAssistance";
import { classroomCommands } from "./commands";
import * as ai from "./ai";
import * as ocr from "./ocr";
import { defaults, saveSettings } from "./settings";

const setup = () => {
  let scene: readonly FcboardElement[] = [];
  const listeners = new Set<() => void>();
  const state = {
    ...getDefaultAppState(),
    width: 1600,
    height: 900,
    activeTool: { type: "freedraw" },
    currentItemInkAssist: "language",
  };
  const api = {
    id: "language-board",
    getAppState: () => state,
    getSceneElements: () => scene,
    onChange: (notify: () => void) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    updateScene: vi.fn((update) => {
      if (update.elements) {
        scene = update.elements;
      }
      listeners.forEach((notify) => notify());
    }),
  } as unknown as FcboardImperativeAPI;
  const source = newFreeDrawElement({
    type: "freedraw",
    x: 200,
    y: 150,
    points: [pointFrom(0, 0), pointFrom(80, 40), pointFrom(130, 0)],
    strokeColor: "#b52a25",
    simulatePressure: true,
    customData: { fcInk: { version: 2, pen: "hard", assist: "language" } },
  });
  const recognize = vi
    .spyOn(ocr, "recognizeHandwriting")
    .mockResolvedValue(languageStudy.term);
  vi.spyOn(ai, "boardContext").mockImplementation(
    async (_api, _whole, elements) => ({
      elements: elements || [],
      text: "",
      image:
        "data:image/png;base64,source" as import("@fcboard/fcboard/types").DataURL,
    }),
  );
  const chat = vi
    .spyOn(ai, "chat")
    .mockResolvedValue(JSON.stringify(languageStudy));
  const error = vi.fn();
  const stopTranslate = registerLanguageCommands(api);
  const stopObserve = observeInkAssistance(api, vi.fn(), error);
  const release = () => {
    stopObserve();
    stopTranslate();
  };
  return { api, source, recognize, chat, error, release };
};

beforeEach(async () => {
  saveSettings(
    { ...defaults, apiKey: "test-only", translationProvider: "cloud" },
    false,
  );
  await setLanguage(languages.find((language) => language.code === "zh-CN")!);
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  await setLanguage(defaultLang);
});

it("keeps original ink, translates below it at matching size, opens cached card, and hides on card double click", async () => {
  vi.useFakeTimers();
  const { api, source, recognize, chat, error, release } = setup();
  const view = render(<LanguagePanel api={api} />);
  try {
    await act(async () => {
      api.updateScene({ elements: [source] });
      await vi.advanceTimersByTimeAsync(1210);
    });
    expect(error).not.toHaveBeenCalled();
    const original = api
      .getSceneElements()
      .find((element) => element.id === source.id)!;
    expect(original.type === "freedraw" && original.points).toEqual(
      source.points,
    );
    const translation = api
      .getSceneElements()
      .find((element) => element.customData?.fcLanguage?.source === false)!;
    expect(translation.type === "text" && translation.originalText).toBe(
      languageStudy.translation,
    );
    expect(translation.strokeColor).toBe(source.strokeColor);
    const [left, , right, bottom] = getCommonBounds([source]);
    expect(translation.y).toBeGreaterThan(bottom);
    expect(translation.x).toBeGreaterThanOrEqual(left);
    expect(translation.x).toBeLessThan(right + 100);
    expect(
      translation.type === "text" && translation.fontSize,
    ).toBeLessThanOrEqual(40);
    expect(translation.groupIds.at(-1)).toBe(original.groupIds.at(-1));
    expect(recognize).not.toHaveBeenCalled();
    expect(JSON.stringify(chat.mock.calls[0][0])).toContain(
      "data:image/png;base64,source",
    );
    expect(chat.mock.calls[0][0].at(-1)?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: JSON.stringify({
            targetLanguage: "zh-CN",
            sameLanguageTarget: "en",
          }),
        }),
      ]),
    );
    await act(async () => {
      await classroomCommands.execute({
        name: "language.card",
        args: { id: source.id },
      });
    });
    const dialog = screen.getByRole("dialog", {
      name: t("fcboard.language_study"),
    });
    expect(dialog).toHaveTextContent(languageStudy.translation);
    fireEvent.click(
      screen.getByRole("tab", {
        name: t("fcboard.word_and_sentence_structure"),
      }),
    );
    expect(dialog).toHaveTextContent(languageStudy.grammar);
    fireEvent.doubleClick(dialog);
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => {
      await classroomCommands.execute({
        name: "language.card",
        args: { id: source.id },
      });
    });
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(chat).toHaveBeenCalledTimes(2);
    expect(recognize).not.toHaveBeenCalled();
    await act(async () => {
      api.updateScene({
        elements: api.getSceneElements().map((element) =>
          element.id === source.id && element.type === "freedraw"
            ? newElementWith(element, {
                points: [
                  pointFrom<LocalPoint>(0, 0),
                  pointFrom<LocalPoint>(50, 40),
                ],
              })
            : element,
        ),
      });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(readLanguageCard(api, source.id)).toBeUndefined();
  } finally {
    release();
    view.unmount();
  }
});

it("copies a bilingual object with an independent card and never exposes hidden-board data while a document is open", async () => {
  vi.useFakeTimers();
  const { api, source, release } = setup();
  try {
    await act(async () => {
      api.updateScene({ elements: [source] });
      await vi.advanceTimersByTimeAsync(1210);
    });
    const originalGroup =
      api.getSceneElements()[0].customData?.fcLanguage.group;
    const { duplicatedElements: copies } = duplicateElements({
      type: "everything",
      elements: api.getSceneElements(),
    });
    const copy = copies.find(
      (element) => element.customData?.fcLanguage?.source,
    )!;
    api.updateScene({ elements: copies });
    expect(copy.customData?.fcLanguage.group).not.toBe(originalGroup);
    expect(readLanguageCard(api, copy.id)?.study).toMatchObject({
      term: languageStudy.term,
      translation: languageStudy.translation,
      backend: "translation",
    });
    expect(readLanguageCard(api, source.id)).toBeUndefined();
    const stop = classroomCommands.context("document", () => ({
      name: "slides.pdf",
      page: 1,
      ink: [],
    }));
    try {
      expect(readLanguageCard(api, copy.id)).toBeUndefined();
    } finally {
      stop();
    }
  } finally {
    release();
  }
});

it("discards a translation when its source is erased while the model is still responding", async () => {
  vi.useFakeTimers();
  const { api, source, chat, release } = setup();
  let resolve!: (value: string) => void;
  chat.mockImplementation(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  );
  try {
    await act(async () => {
      api.updateScene({ elements: [source] });
      await vi.advanceTimersByTimeAsync(1210);
    });
    expect(chat).toHaveBeenCalledTimes(1);
    api.updateScene({ elements: [] });
    await act(async () => {
      resolve(JSON.stringify(languageStudy));
      await Promise.resolve();
    });
    expect(api.getSceneElements()).toHaveLength(0);
  } finally {
    release();
  }
});

it("hides a loading card on double click and ignores a late translation", async () => {
  vi.useFakeTimers();
  const { api, source, chat, release } = setup();
  const view = render(<LanguagePanel api={api} />);
  let resolve!: (value: string) => void;
  try {
    await act(async () => {
      api.updateScene({ elements: [source] });
      await vi.advanceTimersByTimeAsync(1210);
    });
    api.updateScene({
      elements: api.getSceneElements().map((element) =>
        element.id === source.id
          ? newElementWith(element, {
              customData: {
                ...element.customData,
                fcLanguage: {
                  ...element.customData?.fcLanguage,
                  targetLanguage: "en",
                },
              },
            })
          : element,
      ),
    });
    chat.mockImplementation(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    let task!: Promise<unknown>;
    await act(async () => {
      task = classroomCommands
        .execute({ name: "language.card", args: { id: source.id } })
        .catch((failure) => failure);
    });
    expect(screen.getByRole("progressbar")).toBeVisible();
    fireEvent.doubleClick(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => {
      resolve(JSON.stringify(languageStudy));
      expect(await task).toMatchObject({ name: "AbortError" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.getSceneElements()).toHaveLength(2);
  } finally {
    release();
    view.unmount();
  }
});

it("opens a language card through the selection tool without drawing a language-pen circle, and pronounces the actual term", async () => {
  vi.useFakeTimers();
  const host = setup();
  const stopTranslate = registerLanguageCommands(host.api);
  const speak = vi.fn();
  const stopVoice = classroomCommands.register(
    "voice.speak",
    "Read the selected term",
    speak,
  );
  const [word] = convertToFcboardElements([
    {
      type: "text",
      text: languageStudy.term,
      x: 220,
      y: 150,
      fontSize: 28,
      customData: { fcInk: { version: 2, pen: "hard", assist: "language" } },
    },
  ]);
  host.chat.mockResolvedValue(
    JSON.stringify({ ...languageStudy, synonyms: ["a similar expression"] }),
  );
  const view = render(<LanguagePanel api={host.api} />);
  try {
    Object.assign(host.api.getAppState(), {
      activeTool: { type: "lasso" },
      selectedElementIds: { [word.id]: true },
    });
    act(() => host.api.updateScene({ elements: [word] }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(
      screen.getByRole("dialog", { name: t("fcboard.language_study") }),
    ).toBeVisible();
    expect(screen.getByText(/a similar expression/)).toBeVisible();
    expect(host.recognize).not.toHaveBeenCalled();
    expect(host.api.getSceneElements()).toEqual([word]);
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.pronunciation") }),
    );
    await act(async () => {});
    expect(speak).toHaveBeenCalledWith({ text: languageStudy.term });
  } finally {
    view.unmount();
    host.release();
    stopTranslate();
    stopVoice();
  }
});

it("keeps ordinary and mixed object selections as movable objects while language pen mode is active", async () => {
  vi.useFakeTimers();
  const host = setup();
  const [object] = convertToFcboardElements([
    { type: "rectangle", x: 100, y: 100, width: 120, height: 80 },
  ]);
  const view = render(<LanguagePanel api={host.api} />);
  try {
    for (const selected of [[object], [host.source, object]]) {
      Object.assign(host.api.getAppState(), {
        activeTool: { type: "lasso" },
        selectedElementIds: Object.fromEntries(
          selected.map((element) => [element.id, true]),
        ),
      });
      act(() => host.api.updateScene({ elements: selected }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(130);
      });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(host.chat).not.toHaveBeenCalled();
      expect(host.api.getAppState().selectedElementIds).toEqual(
        Object.fromEntries(selected.map((element) => [element.id, true])),
      );
    }
  } finally {
    view.unmount();
    host.release();
  }
});
