import { convertToFcboardElements } from "@fcboard/fcboard";

import type { FcboardImperativeAPI, DataURL } from "@fcboard/fcboard/types";

import type { FcboardElement } from "@fcboard/element/types";

import { BoardBook } from "./boards";

import { classroomCommands } from "./commands";

import type { Board } from "./boards";

describe("persistent whiteboard book", () => {
  afterEach(() => localStorage.removeItem("fcboard-board-recovery"));
  const setup = () => {
    let elements: readonly FcboardElement[] = convertToFcboardElements([
      { type: "text", text: "第一板", x: 10, y: 10 },
    ]);
    let state = {
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 1 },
      viewBackgroundColor: "#fff",
      selectedElementIds: {},
    };
    const listeners = new Set<() => void>();
    const api = {
      getSceneElements: () => elements,
      getFiles: () => ({}),
      getAppState: () => state,
      resetScene: vi.fn(() => {
        elements = [];
      }),
      addFiles: vi.fn(),
      setActiveTool: vi.fn(),
      history: { clear: vi.fn() },
      updateScene: (value: {
        elements?: readonly FcboardElement[];
        appState?: typeof state;
      }) => {
        if (value.elements) {
          elements = value.elements;
        }
        if (value.appState) {
          state = { ...state, ...value.appState };
        }
        listeners.forEach((listener) => listener());
      },
      onChange: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as unknown as FcboardImperativeAPI;
    const save = vi.fn().mockResolvedValue(undefined);
    const book = new BoardBook(api, vi.fn(), async () => undefined, save);
    return { book, api, save };
  };
  it("reorders persisted pages without changing the active canvas or its undo history", async () => {
    const { book, api, save } = setup();
    await book.initialize();
    const first = book.value.active;
    await book.create("second");
    const second = book.value.active;
    const canvas = api.getSceneElements();
    const resets = vi.mocked(api.resetScene).mock.calls.length;
    await book.reorder([second, first]);
    expect(book.value.boards.map((board) => board.id)).toEqual([second, first]);
    expect(
      save.mock.lastCall?.[0].boards.map((board: Board) => board.id),
    ).toEqual([second, first]);
    expect(book.value.active).toBe(second);
    expect(api.getSceneElements()).toBe(canvas);
    expect(api.resetScene).toHaveBeenCalledTimes(resets);
    book.dispose();
  });
  it("rejects incomplete/duplicate ordering and rolls back a failed order save", async () => {
    const { book, save } = setup();
    await book.initialize();
    await book.create("second");
    const previous = book.value;
    const ids = previous.boards.map((board) => board.id);
    await expect(book.reorder([ids[0]])).rejects.toThrow();
    await expect(book.reorder([ids[0], ids[0]])).rejects.toThrow();
    expect(book.value).toBe(previous);
    save
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("quota"));
    await expect(book.reorder([...ids].reverse())).rejects.toThrow("quota");
    expect(book.value).toBe(previous);
    book.dispose();
  });
  it("keeps separate scenes and clears undo history when switching", async () => {
    const { book, api } = setup();
    await book.initialize();
    const first = book.value.active;
    await book.create("几何课");
    const second = book.value.active;
    expect(api.getSceneElements()).toHaveLength(0);
    expect(api.setActiveTool).toHaveBeenLastCalledWith({ type: "freedraw" });
    const shapes = convertToFcboardElements([
      { type: "rectangle", x: 20, y: 30, width: 80, height: 60 },
    ]);
    api.updateScene({ elements: shapes });
    await book.switch(first);
    expect(api.getSceneElements()[0].type).toBe("text");
    await book.switch(second);
    expect(api.getSceneElements()[0].id).toBe(shapes[0].id);
    expect(api.history.clear).toHaveBeenCalledTimes(3);
    await book.discard(second);
    expect(book.value.active).toBe(first);
    expect(book.value.boards).toHaveLength(1);
    book.dispose();
  });
  it("recovers an embedded resource on immediate reload before the idle save, keeping other boards", async () => {
    const { book, api, save } = setup();
    await book.initialize();
    const first = book.value.active;
    await book.create("resources");
    const active = book.value.active;
    const stored = structuredClone(book.value);
    const resource = convertToFcboardElements([
      {
        type: "rectangle",
        x: 20,
        y: 30,
        width: 300,
        height: 200,
        customData: { fcEmbed: { html: "<button>F=ma</button>" } },
      },
    ]);
    api.updateScene({ elements: resource });
    book.checkpoint();
    book.dispose();
    const reloaded = new BoardBook(api, vi.fn(), async () => stored, save);
    await reloaded.initialize();
    expect(reloaded.value.active).toBe(active);
    expect(api.getSceneElements()[0].customData?.fcEmbed).toEqual({
      html: "<button>F=ma</button>",
    });
    expect(
      reloaded.value.boards.find((page) => page.id === first)?.elements[0].type,
    ).toBe("text");
    expect(localStorage.getItem("fcboard-board-recovery")).toBeNull();
    reloaded.dispose();
  });
  it("keeps edits received during an awaited page switch on the visible source board", async () => {
    const { book, api, save } = setup();
    await book.initialize();
    const first = book.value.active;
    await book.create("second");
    const second = book.value.active;
    await book.switch(first);
    let finish!: () => void;
    save.mockResolvedValueOnce(undefined).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const switching = book.switch(second);
    await vi.waitFor(() => expect(finish).toBeDefined());
    expect(book.visibleActive).toBe(first);
    const remote = convertToFcboardElements([
      { type: "text", text: "source page only", x: 10, y: 10 },
    ]);
    api.updateScene({ elements: remote });
    finish();
    await switching;
    expect(book.visibleActive).toBe(second);
    expect(api.getSceneElements()).toEqual([]);
    expect(
      book.value.boards.find((board) => board.id === first)?.elements,
    ).toEqual(remote);
    expect(
      book.value.boards.find((board) => board.id === second)?.elements,
    ).toEqual([]);
    book.dispose();
  });
  it("does not erase the current scene when persistence fails", async () => {
    const { book, api, save } = setup();
    await book.initialize();
    const id = book.value.active;
    const previous = api.getSceneElements();
    save.mockRejectedValue(new Error("storage full"));
    await expect(book.create()).rejects.toThrow("storage full");
    expect(book.value.active).toBe(id);
    expect(api.getSceneElements()).toBe(previous);
    expect(api.resetScene).not.toHaveBeenCalled();
    book.dispose();
  });
  it("reuses the last global image on pages without their own custom image, preserving local overrides and restart persistence", async () => {
    const { book, api, save } = setup();
    await book.initialize();
    const empty = book.value.active;
    await book.create("Local photo");
    const local = book.value.active;
    const a = "data:image/png;base64,AAAA" as DataURL;
    const b = "data:image/png;base64,BBBB" as DataURL;
    api.updateScene({ appState: { whiteboardCustomBackground: a } });
    await book.create("New photo");
    const newest = book.value.active;
    api.updateScene({ appState: { whiteboardCustomBackground: b } });
    await book.switch(local);
    expect(api.getAppState().whiteboardCustomBackground).toBe(a);
    // Merely drawing on an older page must not replace the global last choice.
    api.updateScene({ appState: { scrollX: 10 as never } });
    expect(book.value.customBackground).toBe(b);
    await book.switch(empty);
    expect(api.getAppState().whiteboardCustomBackground).toBe(b);
    expect(api.getAppState().whiteboardBackground).toBeUndefined();
    api.updateScene({ appState: { scrollX: 20 as never } });
    expect(
      book.value.boards.find((board) => board.id === empty)?.view
        .whiteboardCustomBackground,
    ).toBeUndefined();
    await book.switch(newest);
    const c = "data:image/png;base64,CCCC" as DataURL;
    api.updateScene({ appState: { whiteboardCustomBackground: c } });
    await book.switch(empty);
    expect(api.getAppState().whiteboardCustomBackground).toBe(c);
    await book.discard(newest);
    await book.flush();
    const saved = save.mock.lastCall?.[0];
    book.dispose();
    const restored = new BoardBook(api, vi.fn(), async () => saved, save);
    await restored.initialize();
    expect(restored.value.customBackground).toBe(c);
    expect(api.getAppState().whiteboardCustomBackground).toBe(c);
    await restored.switch(local);
    expect(api.getAppState().whiteboardCustomBackground).toBe(a);
    restored.dispose();
  });
  it("identifies only the real originating task when creating, switching and discarding, preserving manual invalidation", async () => {
    const { book } = setup();
    await book.initialize();
    const first = book.value.active;
    const task = new AbortController();
    const invalidations = vi.fn();
    const stop = classroomCommands.onInvalidate(invalidations);
    try {
      await book.create("next", task.signal);
      const next = book.value.active;
      await book.switch(first, task.signal);
      await book.discard(first, task.signal);
      expect(book.value.active).toBe(next);
      expect(invalidations.mock.calls).toEqual([
        [task.signal],
        [task.signal],
        [task.signal],
      ]);
      await book.create("manual");
      expect(invalidations.mock.lastCall).toEqual([undefined]);
    } finally {
      stop();
      book.dispose();
    }
  });
  it("restores persistence and keeps the visible scene when cancellation arrives during the board save", async () => {
    const { book, api, save } = setup();
    await book.initialize();
    const initial = book.value;
    const elements = api.getSceneElements();
    const task = new AbortController();
    save.mockResolvedValueOnce(undefined).mockImplementationOnce(async () => {
      task.abort();
    });
    await expect(book.create("cancelled", task.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(book.value).toBe(initial);
    expect(save.mock.lastCall?.[0]).toEqual(initial);
    expect(api.getSceneElements()).toBe(elements);
    expect(api.resetScene).not.toHaveBeenCalled();
    await expect(book.discard("missing")).rejects.toThrow();
    expect(book.value).toBe(initial);
    expect(book.value.boards).toHaveLength(1);
    book.dispose();
  });
  it("deletes a selection atomically, keeps surviving ink undo intact and restores actual deleted pages", async () => {
    const { book, api, save } = setup();
    await book.initialize();
    const first = book.value.active;
    await book.create("second");
    const second = book.value.active;
    await book.create("third");
    const third = book.value.active;
    const originalFirst = book.value.boards[0];
    const resets = vi.mocked(api.resetScene).mock.calls.length;
    save.mockClear();
    await book.discardMany([first, second]);
    expect(book.value.boards.map((board) => board.id)).toEqual([third]);
    expect(save).toHaveBeenCalledTimes(2);
    expect(
      save.mock.calls.at(-1)![0].boards.map((board: Board) => board.id),
    ).toEqual([third]);
    expect(api.resetScene).toHaveBeenCalledTimes(resets);
    expect(book.canRestoreDiscarded).toBe(true);
    const ink = convertToFcboardElements([
      { type: "rectangle", x: 8, y: 9, width: 90, height: 70 },
    ]);
    api.updateScene({ elements: ink });
    await book.restoreDiscarded();
    expect(book.value.boards.map((board) => board.id)).toEqual([
      first,
      second,
      third,
    ]);
    expect(book.value.boards[0]).toEqual(originalFirst);
    expect(book.value.boards[2].elements[0].id).toBe(ink[0].id);
    expect(book.value.active).toBe(third);
    expect(api.getSceneElements()).toBe(ink);
    expect(api.resetScene).toHaveBeenCalledTimes(resets);
    expect(book.canRestoreDiscarded).toBe(false);
    book.dispose();
  });
  it("replaces deletion of every page in the same transaction and undoes without retaining an untouched temporary page", async () => {
    const { book, api, save } = setup();
    await book.initialize();
    const previous = book.value;
    save.mockClear();
    await book.discardMany(previous.boards.map((board) => board.id));
    expect(book.value.boards).toHaveLength(1);
    expect(book.value.active).not.toBe(previous.active);
    expect(api.getSceneElements()).toHaveLength(0);
    expect(
      save.mock.calls.every(([workspace]) => workspace.boards.length > 0),
    ).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    await book.restoreDiscarded();
    expect(book.value.boards).toEqual(previous.boards);
    expect(book.value.active).toBe(previous.active);
    expect(api.getSceneElements()[0].type).toBe("text");
    book.dispose();
  });
  it("preserves writing added to the replacement page when undoing a remove-all operation", async () => {
    const { book, api } = setup();
    await book.initialize();
    const first = book.value.active;
    await book.discardMany([first]);
    const replacement = book.value.active;
    const ink = convertToFcboardElements([
      { type: "ellipse", x: 1, y: 1, width: 30, height: 30 },
    ]);
    api.updateScene({ elements: ink });
    await book.restoreDiscarded();
    expect(book.value.boards.map((board) => board.id)).toEqual([
      first,
      replacement,
    ]);
    expect(book.value.boards[1].elements[0].id).toBe(ink[0].id);
    book.dispose();
  });
  it("rolls back a failed batch deletion and a cancelled durable deletion without clearing the current canvas", async () => {
    const { book, api, save } = setup();
    await book.initialize();
    const previous = book.value;
    const canvas = api.getSceneElements();
    save
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Storage full"));
    await expect(book.discardMany([previous.active])).rejects.toThrow(
      "Storage full",
    );
    expect(book.value).toBe(previous);
    expect(book.canRestoreDiscarded).toBe(false);
    expect(api.getSceneElements()).toBe(canvas);
    const request = new AbortController();
    save
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async () => request.abort());
    await expect(
      book.discardMany([previous.active], request.signal),
    ).rejects.toThrow();
    expect(book.value).toBe(previous);
    expect(save.mock.calls.at(-1)![0].active).toBe(previous.active);
    expect(api.getSceneElements()).toBe(canvas);
    expect(api.resetScene).not.toHaveBeenCalled();
    book.dispose();
  });
});
