import { convertToFcboardElements } from "@fcboard/fcboard";

import type { FcboardImperativeAPI, DataURL } from "@fcboard/fcboard/types";

import type { FcboardElement } from "@fcboard/element/types";

import { BoardBook } from "./boards";

import { classroomCommands } from "./commands";

describe("persistent whiteboard book", () => {
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
  it("keeps separate scenes and clears undo history when switching", async () => {
    const { book, api } = setup();
    await book.initialize();
    const first = book.value.active;
    await book.create("几何课");
    const second = book.value.active;
    expect(api.getSceneElements()).toHaveLength(0);
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
});
