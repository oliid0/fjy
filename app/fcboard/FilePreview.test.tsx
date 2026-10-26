import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { getDefaultAppState } from "@excalidraw/excalidraw/appState";
import {
  defaultLang,
  languages,
  setLanguage,
  t,
} from "@excalidraw/excalidraw/i18n";
import { factoryBrushWidths } from "@excalidraw/element/factoryBrush";

import { Fonts } from "@excalidraw/excalidraw/fonts";

import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import { render } from "./test/render";
import { FilePreview } from "./FilePreview";
import { classroomCommands } from "./commands";
import { documentInkElement } from "./documentInk";
import {
  documentSourceSignature,
  documentStrokeBounds,
  loadInk,
} from "./documents";
import * as ocr from "./ocr";
import * as ai from "./ai";
import { languageStudy } from "./test/language";
import { LanguagePanel, readLanguageCard } from "./LanguagePanel";
import { registerCanvasCommands } from "./canvasCommands";
import { animateSolid } from "./solidAnimation";
import { updateQuestionAnswer } from "./questionAnswer";
import { readWidgets, renderWidget, widgetDefaults } from "./widgets";
import { interactiveResource } from "./test/interactiveResource";
import { LessonCanvas, validateLesson } from "./lesson";
import {
  insertionDefaults,
  renderInsertion,
  readInsertions,
} from "./insertObjects";
import {
  documentWritingParts,
  insertionWritingTargets,
} from "./insertionWriting";

vi.mock("./documents", async (original) => ({
  ...(await original<typeof import("./documents")>()),
  documentKey: vi.fn().mockResolvedValue("document-key"),
  loadInk: vi.fn().mockResolvedValue({}),
  saveInk: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(loadInk).mockResolvedValue({});
});

const setup = async (
  mode?: AppState["currentItemInkAssist"],
  preferences: Partial<AppState> = {},
) => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:document");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    right: 1000,
    bottom: 600,
    width: 1000,
    height: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  let state: AppState = {
    ...getDefaultAppState(),
    width: 1000,
    height: 600,
    offsetLeft: 0,
    offsetTop: 0,
    currentItemInkAssist: mode,
    ...preferences,
  };
  const listeners = new Set<(elements: [], state: AppState) => void>();
  const update = vi.fn(({ appState }: { appState?: Partial<AppState> }) => {
    state = { ...state, ...appState };
    listeners.forEach((notify) => notify([], state));
  });
  const api = {
    getAppState: () => state,
    getSceneElements: () => [],
    updateScene: update,
    onChange: (notify: (elements: [], state: AppState) => void) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
  } as unknown as ExcalidrawImperativeAPI;
  const file = new File(["image"], "slide.png");
  const view = render(<FilePreview api={api} file={file} onClose={() => {}} />);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: t("fcboard.toggle_annotations") }),
    ).toBeEnabled(),
  );
  const svg = screen.getByLabelText(t("fcboard.document_annotations"));
  const captures = new Set<number>();
  Object.assign(svg, {
    setPointerCapture: (id: number) => captures.add(id),
    hasPointerCapture: (id: number) => captures.has(id),
    releasePointerCapture: (id: number) => captures.delete(id),
  });
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    right: 1000,
    bottom: 600,
    width: 1000,
    height: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.toggle_annotations") }),
  );
  const pointer = (
    type: string,
    x: number,
    y: number,
    extra: Record<string, unknown> = {},
  ) =>
    fireEvent(
      svg,
      Object.assign(new Event(type, { bubbles: true }), {
        isPrimary: true,
        pointerId: 1,
        pointerType: "pen",
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        pressure: 0.6,
        width: 1,
        height: 1,
        clientX: x,
        clientY: y,
        ...extra,
      }),
    );
  const draw = () => {
    pointer("pointerdown", 100, 100);
    pointer("pointermove", 180, 140, {
      getCoalescedEvents: () => [
        { clientX: 120, clientY: 110, pressure: 0.2 },
        { clientX: 150, clientY: 120, pressure: 0.8 },
      ],
    });
    pointer("pointerup", 200, 140);
  };
  return { ...view, api, update, svg, pointer, draw };
};

it("applies assistant configuration to the next visible courseware stroke and exposes its actual settings", async () => {
  const { api, draw, unmount } = await setup(undefined, {
    currentItemPenMode: "brush",
  });
  const stop = registerCanvasCommands(api);
  try {
    await act(async () => {
      await classroomCommands.execute({
        name: "canvas.configure",
        args: {
          brushVariation: 7,
          palmEraser: false,
          palmThreshold: 44,
          eraserSize: 80,
        },
      });
    });
    draw();
    const document = classroomCommands.read("document") as {
      ink: import("./documents").InkStroke[];
    };
    expect(document.ink).toHaveLength(1);
    expect(document.ink[0].fcInk).toMatchObject({ pen: "brush", variation: 7 });
    expect(
      await classroomCommands.execute({ name: "canvas.inspect" }),
    ).toMatchObject({
      configuration: {
        pen: { brushVariation: 7 },
        eraser: { palm: false, palmThreshold: 44, size: 80 },
        background: { available: false },
      },
    });
  } finally {
    stop();
    unmount();
  }
});

it("translates courseware ink on the visible page, opens and hides its card, and undoes the whole conversion", async () => {
  await setLanguage(languages.find((language) => language.code === "zh-CN")!);
  vi.spyOn(ocr, "recognizeHandwriting").mockResolvedValue(languageStudy.term);
  const chat = vi
    .spyOn(ai, "chat")
    .mockResolvedValue(JSON.stringify(languageStudy));
  const { api, draw, svg, unmount } = await setup("language");
  const panel = render(<LanguagePanel api={api} />);
  const read = () =>
    (
      classroomCommands.read("document") as {
        ink: import("./documents").InkStroke[];
      }
    ).ink;
  try {
    draw();
    const source = read()[0];
    await waitFor(
      () =>
        expect(read().find((stroke) => stroke.text)?.originalText).toBe(
          languageStudy.translation,
        ),
      { timeout: 2000 },
    );
    const original = read().find((stroke) => stroke.id === source.id)!;
    expect(original.points).toEqual(source.points);
    const translation = read().find((stroke) => stroke.text)!;
    expect(translation.points[0][1]).toBeGreaterThan(
      documentStrokeBounds(source).bottom,
    );
    expect(translation.fontSize).toBeLessThanOrEqual(40);
    expect(api.getSceneElements()).toHaveLength(0);
    expect(readLanguageCard(api, source.id)?.study).toEqual(languageStudy);
    fireEvent.doubleClick(svg.querySelector(`[data-language="${source.id}"]`)!);
    await screen.findByRole("dialog", { name: t("fcboard.language_study") });
    fireEvent.doubleClick(screen.getByRole("dialog"));
    expect(
      screen.queryByRole("dialog", { name: t("fcboard.language_study") }),
    ).toBeNull();
    expect(chat).toHaveBeenCalledTimes(1);
    await act(async () => {
      await classroomCommands.execute({ name: "document.undo" });
    });
    expect(read()).toEqual([source]);
    expect(readLanguageCard(api, source.id)).toBeUndefined();
    await act(async () => {
      await classroomCommands.execute({ name: "document.redo" });
    });
    expect(readLanguageCard(api, source.id)?.study).toEqual(languageStudy);
  } finally {
    panel.unmount();
    unmount();
    await setLanguage(defaultLang);
  }
});

it.each(["mindmap", "fourline"] as const)(
  "types ordinary handwriting into the visible %s with atomic undo and redo",
  async (kind) => {
    const recognize = vi
      .spyOn(ocr, "recognizeHandwriting")
      .mockResolvedValue("Hello");
    const { api, pointer, update } = await setup();
    await act(async () => {
      await renderInsertion(api, insertionDefaults(kind, { x: 60, y: 60 }));
    });
    const read = () =>
      (
        classroomCommands.read("document") as {
          ink: import("./documents").InkStroke[];
        }
      ).ink;
    const target = insertionWritingTargets(documentWritingParts(read()))[0];
    const before = read().map((stroke) => stroke.id);
    pointer("pointerdown", target.x + 12, target.y + 12);
    pointer("pointermove", target.x + 32, target.y + 24);
    pointer("pointerup", target.x + 48, target.y + 28);
    const written = read().find((stroke) => !before.includes(stroke.id))!.id;
    await waitFor(
      () => expect(read().some((stroke) => stroke.text === "Hello")).toBe(true),
      { timeout: 2000 },
    );
    expect(recognize.mock.calls[0][5]).toHaveLength(1);
    expect(recognize.mock.calls[0][6]).toBe(
      kind === "fourline" ? "en-US" : undefined,
    );
    expect(read().some((stroke) => stroke.id === written)).toBe(false);
    expect(
      readInsertions(api)[0][kind === "fourline" ? "text" : "outline"],
    ).toContain("Hello");
    expect(update).not.toHaveBeenCalled();
    await act(async () => {
      await classroomCommands.execute({ name: "document.undo" });
    });
    expect(read().some((stroke) => stroke.id === written)).toBe(true);
    expect(read().some((stroke) => stroke.text === "Hello")).toBe(false);
    await act(async () => {
      await classroomCommands.execute({ name: "document.redo" });
    });
    expect(read().some((stroke) => stroke.text === "Hello")).toBe(true);
    expect(read().some((stroke) => stroke.id === written)).toBe(false);
  },
);

it("does not commit late handwriting into a removed courseware writing surface", async () => {
  let finish!: (text: string) => void;
  const recognize = vi.spyOn(ocr, "recognizeHandwriting").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { api, pointer } = await setup();
  await act(async () => {
    await renderInsertion(api, insertionDefaults("fourline", { x: 60, y: 60 }));
  });
  const read = () =>
    (
      classroomCommands.read("document") as {
        ink: import("./documents").InkStroke[];
      }
    ).ink;
  const target = insertionWritingTargets(documentWritingParts(read()))[0];
  const parts = read().map((stroke) => stroke.id);
  pointer("pointerdown", target.x + 12, target.y + 12);
  pointer("pointerup", target.x + 48, target.y + 28);
  await waitFor(() => expect(recognize).toHaveBeenCalledTimes(1), {
    timeout: 2000,
  });
  await act(async () => {
    await classroomCommands.execute({
      name: "document.erase",
      args: { ids: parts },
    });
  });
  await act(async () => finish("Late text"));
  expect(read()).toHaveLength(1);
  expect(read()[0].text).toBeUndefined();
});

it("embeds an interactive lesson on the visible document with one undo and redo", async () => {
  const { api } = await setup();
  let ids: string[] = [];
  await act(async () => {
    ({ ids } = (await classroomCommands.execute({
      name: "document.resource",
      args: { resource: interactiveResource },
    })) as { ids: string[] });
  });
  const frame = screen.getByTitle(interactiveResource.title);
  expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  expect(frame.closest("foreignObject")).toBeTruthy();
  const current = () =>
    (
      classroomCommands.read("document") as {
        ink: import("./documents").InkStroke[];
      }
    ).ink;
  const bounds = documentStrokeBounds(current()[0]);
  expect(bounds.right).toBeGreaterThan(bounds.left + 100);
  expect(current()[0].id).toBe(ids[0]);
  expect(api.getSceneElements()).toEqual([]);
  await act(async () => {
    await classroomCommands.execute({ name: "document.undo" });
  });
  expect(screen.queryByTitle(interactiveResource.title)).toBeNull();
  await act(async () => {
    await classroomCommands.execute({ name: "document.redo" });
  });
  expect(screen.getByTitle(interactiveResource.title)).toBeInTheDocument();
  await act(async () => {
    await classroomCommands.execute({
      name: "document.move",
      args: { ids, dx: 10, dy: 20 },
    });
  });
  expect(documentStrokeBounds(current()[0]).left).toBe(bounds.left + 10);
  await act(async () => {
    await classroomCommands.execute({ name: "document.erase", args: { ids } });
  });
  expect(screen.queryByTitle(interactiveResource.title)).toBeNull();
});

it("folds and restores a courseware answer without changing the hidden whiteboard", async () => {
  const { api, draw } = await setup();
  draw();
  const anchor = (
    classroomCommands.read("document") as { ink: { id: string }[] }
  ).ink[0].id;
  await act(async () => {
    await classroomCommands.execute({
      name: "document.strokes",
      args: {
        strokes: [
          [
            [400, 300],
            [420, 320],
          ],
        ],
      },
    });
  });
  const answer = (
    classroomCommands.read("document") as { ink: { id: string }[] }
  ).ink[1];
  await act(async () => {
    await updateQuestionAnswer(api, anchor, [answer.id]);
  });
  await act(async () => {
    await updateQuestionAnswer(api, anchor);
  });
  expect(
    (classroomCommands.read("document") as { ink: { id: string }[] }).ink.map(
      (stroke) => stroke.id,
    ),
  ).toEqual([anchor]);
  await act(async () => {
    await updateQuestionAnswer(api, anchor);
  });
  expect(
    (classroomCommands.read("document") as { ink: unknown[] }).ink[1],
  ).toEqual(answer);
  expect(api.updateScene).not.toHaveBeenCalled();
});

it("commits a question's trajectories to the visible courseware as one undo step", async () => {
  const { api, draw } = await setup();
  draw();
  const before = (
    classroomCommands.read("document") as { ink: { id: string }[] }
  ).ink;
  await act(async () => {
    await classroomCommands.execute({
      name: "document.strokes",
      args: {
        strokes: [
          [
            [400, 300],
            [420, 320],
          ],
          [
            [430, 300],
            [430, 330],
          ],
        ],
      },
    });
  });
  const after = classroomCommands.read("document") as {
    ink: { id: string }[];
    selection: string[];
  };
  expect(after.ink).toHaveLength(before.length + 2);
  expect(after.selection).toEqual(
    after.ink.slice(-2).map((stroke) => stroke.id),
  );
  await act(async () => {
    await classroomCommands.execute({ name: "document.undo" });
  });
  expect(
    (classroomCommands.read("document") as { ink: unknown[] }).ink,
  ).toEqual(before);
  await act(async () => {
    await classroomCommands.execute({ name: "document.redo" });
  });
  expect(
    (classroomCommands.read("document") as { ink: unknown[] }).ink,
  ).toEqual(after.ink);
  expect(api.updateScene).not.toHaveBeenCalled();
});

it("persists mixed dictated question writing only on courseware and undoes the whole question", async () => {
  const { api } = await setup();
  const current = () =>
    (
      classroomCommands.read("document") as {
        ink: import("./documents").InkStroke[];
      }
    ).ink;
  let ids: string[] = [];
  await act(async () => {
    const result = (await classroomCommands.execute({
      name: "document.strokes",
      args: {
        strokes: [
          [
            [200, 200],
            [230, 230],
          ],
        ],
        text: "牛顿第二定律",
        bounds: { left: 180, top: 180, right: 780, bottom: 380 },
        select: false,
      },
    })) as { ids: string[] };
    ids = result.ids;
  });
  expect(current()).toHaveLength(2);
  const text = current().find((stroke) => stroke.text)!;
  expect(text).toMatchObject({
    originalText: "牛顿第二定律",
    fontFamily: 5,
    questionInput: true,
  });
  const bounds = documentStrokeBounds(text);
  expect(bounds.left).toBeGreaterThanOrEqual(180);
  expect(bounds.top).toBeGreaterThanOrEqual(230);
  expect(bounds.right).toBeLessThanOrEqual(780);
  expect(bounds.bottom).toBeLessThanOrEqual(380);
  await act(async () => {
    await classroomCommands.execute({ name: "document.undo" });
  });
  expect(current()).toHaveLength(0);
  await act(async () => {
    await classroomCommands.execute({ name: "document.redo" });
  });
  expect(current().map((stroke) => stroke.id)).toEqual(ids);
  expect(api.updateScene).not.toHaveBeenCalled();
});

it("discards dictated question writing when its courseware closes during font loading", async () => {
  const { api, unmount } = await setup();
  let finish!: () => void;
  const fonts = vi.spyOn(Fonts, "loadElementsFonts").mockImplementation(
    () =>
      new Promise<FontFace[]>((resolve) => {
        finish = () => resolve([]);
      }),
  );
  const pending = classroomCommands.execute({
    name: "document.strokes",
    args: {
      strokes: [],
      text: "牛顿定律",
      bounds: { left: 180, top: 180, right: 780, bottom: 380 },
    },
  });
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  await waitFor(() => expect(fonts).toHaveBeenCalled());
  unmount();
  finish();
  await rejected;
  expect(api.updateScene).not.toHaveBeenCalled();
});

it("unfolds a complete courseware solid with one undo step and keeps unrelated writing", async () => {
  const { api, draw } = await setup();
  draw();
  const unrelated = (
    classroomCommands.read("document") as { ink: { id: string }[] }
  ).ink[0].id;
  await act(async () => {
    renderWidget(api, {
      id: "solid",
      kind: "cube",
      params: widgetDefaults(),
      position: { x: 300, y: 100 },
    });
  });
  const original = readWidgets(api)[0];
  await act(async () => {
    await animateSolid(
      api,
      original,
      {
        ...original,
        params: {
          ...original.params,
          solid: { ...original.params.solid, unfold: 1 },
        },
      },
      new AbortController().signal,
      0,
    );
  });
  expect(readWidgets(api)[0].params.solid.unfold).toBe(1);
  await act(async () => {
    await classroomCommands.execute({ name: "document.undo" });
  });
  expect(readWidgets(api)[0].params.solid.unfold).toBe(0);
  expect(
    (classroomCommands.read("document") as { ink: { id: string }[] }).ink.some(
      (stroke) => stroke.id === unrelated,
    ),
  ).toBe(true);
  await act(async () => {
    await classroomCommands.execute({ name: "document.redo" });
  });
  expect(readWidgets(api)[0].params.solid.unfold).toBe(1);
});

it("cancels a courseware solid animation without a history entry or stale frames", async () => {
  const { api } = await setup();
  await act(async () => {
    renderWidget(api, {
      id: "solid",
      kind: "cylinder",
      params: widgetDefaults(),
      position: { x: 300, y: 100 },
    });
  });
  const original = readWidgets(api)[0];
  const controller = new AbortController();
  vi.useFakeTimers();
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = animateSolid(
      api,
      original,
      {
        ...original,
        params: {
          ...original.params,
          solid: { ...original.params.solid, unfold: 1 },
        },
      },
      controller.signal,
      160,
    ).catch((error) => error);
    await vi.advanceTimersByTimeAsync(80);
  });
  expect(readWidgets(api)[0].params.solid.unfold).toBeGreaterThan(0);
  await act(async () => {
    controller.abort();
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(((await pending) as DOMException).name).toBe("AbortError");
  expect(readWidgets(api)[0].params.solid.unfold).toBe(0);
  await act(async () => {
    await classroomCommands.execute({ name: "document.undo" });
  });
  expect(readWidgets(api)).toHaveLength(0);
});

it("retains coalesced pressure samples, renders quadratics and restores a cancelled barrel erasure", async () => {
  const { draw, svg, pointer, update } = await setup();
  draw();
  const before = classroomCommands.read("document") as {
    ink: import("./documents").InkStroke[];
  };
  expect(before.ink[0].points).toEqual([
    [100, 100],
    [120, 110],
    [150, 120],
    [180, 140],
    [200, 140],
  ]);
  expect(before.ink[0].pressures).toEqual([0.6, 0.2, 0.8, 0.6, 0.6]);
  expect(svg.querySelector("path")?.getAttribute("d")).toContain("Q");
  pointer("pointerdown", 150, 120, { button: 2, buttons: 2 });
  pointer("pointercancel", 150, 120);
  expect((classroomCommands.read("document") as typeof before).ink).toEqual(
    before.ink,
  );
  expect(update).not.toHaveBeenCalled();
});

it.each(["calculation", "function", "text"] as const)(
  "executes the %s pen on the visible courseware and preserves the hidden canvas",
  async (mode) => {
    const recognize = vi
      .spyOn(ocr, "recognizeHandwriting")
      .mockResolvedValue(
        mode === "calculation"
          ? "0.1+0.2="
          : mode === "function"
          ? "y=x^2"
          : "课堂笔记",
      );
    const { draw, update } = await setup(mode);
    vi.useFakeTimers();
    draw();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    const { ink } = classroomCommands.read("document") as {
      ink: import("./documents").InkStroke[];
    };
    expect(recognize).toHaveBeenCalledTimes(1);
    expect(recognize.mock.calls[0][5]).toEqual([
      [
        [100, 100],
        [120, 110],
        [150, 120],
        [180, 140],
        [200, 140],
      ],
    ]);
    if (mode === "function") {
      expect(ink.some((stroke) => stroke.plot?.plot.expression === "x^2")).toBe(
        true,
      );
    } else {
      expect(ink.find((stroke) => stroke.text)?.text).toBe(
        mode === "text" ? "课堂笔记" : "0.3",
      );
      expect(ink.filter((stroke) => stroke.fcInk)).toHaveLength(
        mode === "text" ? 0 : 1,
      );
    }
    expect(update).not.toHaveBeenCalled();
  },
);

it("discards recognition after its source is erased", async () => {
  let finish!: (text: string) => void;
  vi.spyOn(ocr, "recognizeHandwriting").mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { draw, update } = await setup("text");
  vi.useFakeTimers();
  draw();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(700);
  });
  const source = (
    classroomCommands.read("document") as {
      ink: import("./documents").InkStroke[];
    }
  ).ink;
  expect(documentSourceSignature(source)).toContain(source[0].id);
  await act(async () => {
    await classroomCommands.execute({
      name: "document.erase",
      args: { ids: source.map((stroke) => stroke.id) },
    });
    finish("迟到结果");
  });
  expect(
    (classroomCommands.read("document") as { ink: unknown[] }).ink,
  ).toHaveLength(0);
  expect(update).not.toHaveBeenCalled();
});

it("rejects a replacement if its source is deleted while loading the font", async () => {
  const { draw, update } = await setup();
  draw();
  const { ink } = classroomCommands.read("document") as {
    ink: import("./documents").InkStroke[];
  };
  let ready!: () => void;
  vi.spyOn(Fonts, "loadElementsFonts").mockReturnValue(
    new Promise((resolve) => {
      ready = () => resolve([]);
    }),
  );
  const pending = classroomCommands.execute({
    name: "document.text",
    args: {
      text: "课堂笔记",
      sourceIds: ink.map((stroke) => stroke.id),
      sourceSignature: documentSourceSignature(ink),
      presentation: "text",
      placement: "replace",
    },
  });
  await act(async () => {
    await classroomCommands.execute({ name: "document.clearInk" });
    ready();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
  expect(
    (classroomCommands.read("document") as { ink: unknown[] }).ink,
  ).toHaveLength(0);
  expect(update).not.toHaveBeenCalled();
});

const currentInk = () =>
  (
    classroomCommands.read("document") as {
      ink: import("./documents").InkStroke[];
    }
  ).ink;

it.each(["F=ma", "牛顿第二定律"])(
  "writes %s into visible courseware with one undo for the whole result",
  async (text) => {
    const { api, draw, update } = await setup();
    draw();
    const source = [...currentInk()];
    const hidden = vi.spyOn(api, "getSceneElements").mockImplementation(() => {
      throw new Error("Hidden board must not be read");
    });
    const renderer = new LessonCanvas(api, {
      sourceIds: source.map((stroke) => stroke.id),
    });
    await act(async () => {
      await renderer.command(
        validateLesson({
          steps: [
            {
              commands: [
                { type: "write_text", id: "explanation", text, duration: 0 },
              ],
            },
          ],
        }).steps[0].commands[0],
      );
    });
    const written = currentInk().filter(
      (stroke) => stroke.lesson === renderer.id,
    );
    expect(written.length).toBeGreaterThan(0);
    if (text === "F=ma") {
      expect(
        written.every(
          (stroke) => stroke.fcInk?.pen === "hard" && stroke.points.length > 1,
        ),
      ).toBe(true);
    } else {
      expect(written[0].fontFamily).toBe(5);
    }
    const area = classroomCommands.read("document.layout") as {
      viewport: { left: number; top: number; right: number; bottom: number };
    };
    for (const stroke of written) {
      const bounds = documentStrokeBounds(stroke);
      expect(bounds.left).toBeGreaterThanOrEqual(area.viewport.left - 1e-6);
      expect(bounds.right).toBeLessThanOrEqual(area.viewport.right + 1e-6);
      expect(bounds.bottom).toBeLessThanOrEqual(area.viewport.bottom + 1e-6);
    }
    await act(async () => {
      await classroomCommands.execute({ name: "document.undo" });
    });
    expect(currentInk()).toEqual(source);
    await act(async () => {
      await classroomCommands.execute({ name: "document.redo" });
    });
    expect(
      currentInk().filter((stroke) => stroke.lesson === renderer.id),
    ).toEqual(written);
    expect(hidden).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  },
);

it("preserves unrelated handwriting added while a lesson word is paused when undoing that word", async () => {
  const { api, draw, pointer } = await setup();
  draw();
  const source = [...currentInk()];
  const renderer = new LessonCanvas(api, {
    sourceIds: source.map((stroke) => stroke.id),
  });
  vi.useFakeTimers();
  const pending = renderer.command(
    validateLesson({
      steps: [
        {
          commands: [
            { type: "write_text", id: "word", text: "F=ma", duration: 1 },
          ],
        },
      ],
    }).steps[0].commands[0],
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(160);
  });
  renderer.pause();
  pointer("pointerdown", 700, 100);
  pointer("pointermove", 740, 130);
  pointer("pointerup", 760, 140);
  const manual = currentInk().filter((stroke) => !stroke.lesson);
  expect(manual.length).toBeGreaterThan(source.length);
  renderer.resume();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1200);
    await pending;
  });
  await act(async () => {
    await classroomCommands.execute({ name: "document.undo" });
  });
  expect(currentInk()).toEqual(manual);
});

it("does not send generated lesson strokes inside a writing surface back through handwriting recognition", async () => {
  const { api } = await setup();
  const recognize = vi
    .spyOn(ocr, "recognizeHandwriting")
    .mockResolvedValue("Should not run");
  await act(async () => {
    await renderInsertion(api, insertionDefaults("fourline", { x: 60, y: 60 }));
  });
  const target = insertionWritingTargets(documentWritingParts(currentInk()))[0];
  const shape = documentInkElement({
    id: "generated-lesson",
    color: "#000000",
    width: 2,
    points: [
      [target.x + 12, target.y + 12],
      [target.x + 32, target.y + 24],
    ],
    fcInk: { version: 2, pen: "hard", unit: 1 },
  });
  vi.useFakeTimers();
  await act(async () => {
    await classroomCommands.execute({
      name: "document.draw",
      args: { shape, lesson: "teacher", progress: 1 },
    });
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(800);
  });
  expect(recognize).not.toHaveBeenCalled();
  expect(currentInk().some((stroke) => stroke.id === shape.id)).toBe(true);
});

it.each(["document.select", "document.move", "document.erase"])(
  "rejects stale mixed targets on visible courseware for %s",
  async (name) => {
    const { draw, update } = await setup();
    draw();
    const original = [...currentInk()];
    const snapshot = JSON.stringify(original);
    await act(async () => {
      await expect(
        classroomCommands.execute({
          name,
          args: { ids: [original[0].id, "missing"], dx: 10, dy: 20 },
        }),
      ).rejects.toThrow("missing");
      await expect(
        classroomCommands.execute({
          name,
          args: { ids: original[0].id, dx: 10, dy: 20 },
        }),
      ).rejects.toThrow();
    });
    expect(JSON.stringify(currentInk())).toBe(snapshot);
    expect(update).not.toHaveBeenCalled();
  },
);

it("reports object ids and actual movement before erasing only those annotations", async () => {
  const { draw, update } = await setup();
  draw();
  const original = currentInk()[0];
  await act(async () => {
    await expect(
      classroomCommands.execute({
        name: "document.select",
        args: { ids: [original.id] },
      }),
    ).resolves.toEqual({ ids: [original.id] });
    await expect(
      classroomCommands.execute({
        name: "document.move",
        args: { ids: [original.id], dx: 10, dy: 20 },
      }),
    ).resolves.toEqual({ ids: [original.id], dx: 10, dy: 20 });
  });
  expect(currentInk()[0].points).toEqual(
    original.points.map(([x, y]) => [x + 10, y + 20]),
  );
  await act(async () => {
    await expect(
      classroomCommands.execute({
        name: "document.erase",
        args: { ids: [original.id] },
      }),
    ).resolves.toEqual({ ids: [original.id] });
  });
  expect(currentInk()).toEqual([]);
  expect(update).not.toHaveBeenCalled();
});

it("centers voice writing on the visible courseware without inheriting a previous selection", async () => {
  const { draw, update } = await setup();
  draw();
  const original = [...currentInk()];
  await act(async () => {
    await classroomCommands.execute({
      name: "document.select",
      args: { ids: [original[0].id] },
    });
    await classroomCommands.execute({
      name: "document.text",
      args: { text: "1+1=2", presentation: "handwritten", placement: "center" },
    });
  });
  const answer = currentInk().find((stroke) => stroke.text === "1+1=2")!;
  const { viewport } = classroomCommands.read("document.layout") as {
    viewport: { left: number; top: number; right: number; bottom: number };
  };
  const box = documentStrokeBounds(answer);
  expect((box.left + box.right) / 2).toBeCloseTo(
    (viewport.left + viewport.right) / 2,
  );
  expect((box.top + box.bottom) / 2).toBeCloseTo(
    (viewport.top + viewport.bottom) / 2,
  );
  expect(
    currentInk().filter((stroke) =>
      original.some((source) => source.id === stroke.id),
    ),
  ).toEqual(original);
  expect(update).not.toHaveBeenCalled();
});

it("drops centered writing when voice is stopped during font loading", async () => {
  await setup();
  let ready!: () => void;
  vi.spyOn(Fonts, "loadElementsFonts").mockReturnValue(
    new Promise((resolve) => {
      ready = () => resolve([]);
    }),
  );
  const cancel = new AbortController();
  const pending = classroomCommands.execute({
    name: "document.text",
    args: {
      text: "1+1=2",
      presentation: "handwritten",
      placement: "center",
      signal: cancel.signal,
    },
  });
  await act(async () => {
    cancel.abort();
    ready();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
  expect(currentInk()).toEqual([]);
});

it("keeps release coalesced samples and completes fountain geometry on the visible layer", async () => {
  const { pointer, svg } = await setup(undefined, {
    currentItemPenMode: "brush",
  });
  pointer("pointerdown", 100, 100);
  pointer("pointermove", 150, 130);
  pointer("pointerup", 200, 140, {
    pressure: 0,
    getCoalescedEvents: () => [{ clientX: 175, clientY: 135, pressure: 0.4 }],
  });
  const [stroke] = currentInk();
  expect(stroke.points).toEqual([
    [100, 100],
    [150, 130],
    [175, 135],
    [200, 140],
  ]);
  expect(stroke.pressures).toEqual([0.6, 0.6, 0.4, 0]);
  expect(stroke.fcInk?.finished).toBe(true);
  expect(factoryBrushWidths(documentInkElement(stroke)).at(-1)).toBe(0);
  expect(svg.querySelector("path")?.getAttribute("d")).not.toMatch(
    /NaN|Infinity|a0,0/,
  );
});

it.each(["pointercancel", "lostpointercapture", "blur"])(
  "rolls back a growing palm on %s and rejects late pointer events",
  async (cancel) => {
    const { draw, pointer, svg } = await setup();
    draw();
    const before = currentInk();
    pointer("pointerdown", 150, 120, {
      pointerType: "touch",
      width: 8,
      height: 8,
    });
    pointer("pointermove", 170, 130, {
      pointerType: "touch",
      width: 70,
      height: 80,
    });
    expect(currentInk()).not.toEqual(before);
    expect(svg.querySelector("image[aria-hidden='true']")).toBeInTheDocument();
    if (cancel === "blur") {
      fireEvent.blur(window);
    } else {
      pointer(cancel, 170, 130);
    }
    expect(currentInk()).toEqual(before);
    expect(svg.hasPointerCapture(1)).toBe(false);
    expect(
      svg.querySelector("image[aria-hidden='true']"),
    ).not.toBeInTheDocument();
    pointer("pointermove", 250, 180);
    pointer("pointerup", 250, 180);
    expect(currentInk()).toEqual(before);
    await act(async () => {
      await classroomCommands.execute({ name: "document.undo" });
    });
    expect(currentInk()).toHaveLength(0);
  },
);

it("commits growing-palm erasure as one undo step and uses the shared eraser size", async () => {
  const { draw, pointer, svg } = await setup(undefined, { eraserSize: 120 });
  draw();
  const before = currentInk();
  pointer("pointerdown", 150, 120, {
    pointerType: "touch",
    width: 8,
    height: 8,
  });
  pointer("pointermove", 160, 125, {
    pointerType: "touch",
    width: 50,
    height: 60,
  });
  expect(svg.querySelector("image[aria-hidden='true']")).toHaveAttribute(
    "width",
    "120",
  );
  pointer("pointerup", 170, 130, {
    pointerType: "touch",
    width: 50,
    height: 60,
  });
  const erased = currentInk();
  expect(erased).not.toEqual(before);
  expect(
    erased.every(
      (stroke) =>
        stroke.id !== before[0].id ||
        stroke.points.length !== before[0].points.length,
    ),
  ).toBe(true);
  await act(async () => {
    await classroomCommands.execute({ name: "document.undo" });
  });
  expect(currentInk()).toEqual(before);
  await act(async () => {
    await classroomCommands.execute({ name: "document.redo" });
  });
  expect(currentInk()).toEqual(erased);
});

it("keeps writing when palm erasure is disabled and promotes an in-stroke barrel button", async () => {
  const { pointer, svg } = await setup(undefined, { palmEraser: false });
  pointer("pointerdown", 100, 100, {
    pointerType: "touch",
    width: 80,
    height: 80,
  });
  pointer("pointermove", 200, 100, {
    pointerType: "touch",
    width: 80,
    height: 80,
  });
  pointer("pointerup", 200, 100, {
    pointerType: "touch",
    width: 80,
    height: 80,
  });
  const before = currentInk();
  expect(before).toHaveLength(1);
  pointer("pointerdown", 150, 100);
  pointer("pointermove", 150, 100, { button: 2, buttons: 2 });
  expect(svg.querySelector("image[aria-hidden='true']")).toBeInTheDocument();
  expect(currentInk()).not.toEqual(before);
  pointer("pointercancel", 150, 100);
  expect(currentInk()).toEqual(before);
});

it("duplicates selected courseware ink as one undoable action with independent IDs", async () => {
  const { draw, update } = await setup();
  draw();
  const before = currentInk();
  await act(async () => {
    await classroomCommands.execute({
      name: "document.select",
      args: { ids: before.map((stroke) => stroke.id) },
    });
    await classroomCommands.execute({ name: "document.duplicate" });
  });
  const after = currentInk();
  expect(after).toHaveLength(2);
  expect(after[0]).toBe(before[0]);
  expect(after[1].id).not.toBe(before[0].id);
  expect(after[1].pressures).toEqual(before[0].pressures);
  expect(after[1].fcInk).toEqual(before[0].fcInk);
  expect(after[1].points[0][0]).toBeGreaterThan(before[0].points[0][0]);
  await act(async () => {
    await classroomCommands.execute({ name: "document.undo" });
  });
  expect(currentInk()).toEqual(before);
  await act(async () => {
    await classroomCommands.execute({ name: "document.redo" });
  });
  expect(currentInk()).toEqual(after);
  expect(update).not.toHaveBeenCalled();
});

it("shares one adjustable region in courseware and cancels a border drag without splitting ink", async () => {
  vi.mocked(loadInk).mockResolvedValue({
    0: [
      {
        id: "first",
        points: [
          [100, 100],
          [140, 140],
        ],
        color: "#000",
        width: 2,
      },
      {
        id: "second",
        points: [
          [300, 100],
          [340, 140],
        ],
        color: "#000",
        width: 2,
      },
    ],
  });
  const { pointer, svg } = await setup();
  await act(() =>
    classroomCommands.execute({
      name: "document.tool",
      args: { tool: "selection" },
    }),
  );
  const context = () =>
    classroomCommands.read("document") as {
      ink: { id: string; points: [number, number][] }[];
      selection: string[];
      region: [number, number][];
      selectionInProgress: boolean;
    };
  pointer("pointerdown", 80, 80);
  pointer("pointermove", 160, 160);
  expect(context().selection).toEqual([]);
  pointer("pointerup", 160, 160);
  expect(context().selection).toEqual(["first"]);
  expect(context().region).toEqual([
    [68, 68],
    [172, 68],
    [172, 172],
    [68, 172],
  ]);
  expect(svg.querySelectorAll("[data-document-region]")).toHaveLength(1);
  pointer("pointerdown", 172, 172);
  expect(context().selectionInProgress).toBe(true);
  pointer("pointermove", 350, 180);
  expect(context().selection).toEqual(["first"]);
  pointer("pointerup", 370, 190);
  expect(context().selection).toEqual(["first", "second"]);
  expect(context().region[2]).toEqual([370, 190]);
  pointer("pointerdown", 220, 68);
  pointer("pointermove", 260, 98);
  expect(context().ink[0].points[0]).toEqual([140, 130]);
  pointer("pointercancel", 260, 98);
  expect(context().ink[0].points[0]).toEqual([100, 100]);
  expect(context().region[0]).toEqual([68, 68]);
  expect(context().ink.map((stroke) => stroke.id)).toEqual(["first", "second"]);
  pointer("pointerdown", 220, 68);
  pointer("pointerup", 260, 98);
  expect(context().region[0]).toEqual([108, 98]);
  expect(context().ink[0].points[0]).toEqual([140, 130]);
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.undo_annotation") }),
  );
  expect(context().ink[0].points[0]).toEqual([100, 100]);
  expect(context().ink).toHaveLength(2);
  expect(context().region).toEqual([]);
  expect(context().selection).toEqual([]);
});

it("starts a new courseware region from its interior and retains it on a tap-sized gesture", async () => {
  const { pointer } = await setup();
  await act(() =>
    classroomCommands.execute({
      name: "document.tool",
      args: { tool: "selection" },
    }),
  );
  const context = () =>
    classroomCommands.read("document") as { region: [number, number][] };
  pointer("pointerdown", 80, 80);
  pointer("pointerup", 240, 240);
  expect(context().region[0]).toEqual([68, 68]);
  pointer("pointerdown", 140, 140);
  pointer("pointerup", 300, 300);
  expect(context().region[0]).toEqual([128, 128]);
  pointer("pointerdown", 600, 400);
  pointer("pointerup", 601, 401);
  expect(context().region[0]).toEqual([128, 128]);
});
