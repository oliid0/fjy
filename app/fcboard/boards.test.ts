import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { BoardBook } from "./boards";
import { classroomCommands } from "./commands";

describe("persistent whiteboard book", () => {
  const setup = () => {
    let elements: readonly ExcalidrawElement[] = convertToExcalidrawElements([
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
        elements?: readonly ExcalidrawElement[];
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
    } as unknown as ExcalidrawImperativeAPI;
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
    const shapes = convertToExcalidrawElements([
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
