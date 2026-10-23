import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { getDefaultAppState } from "@excalidraw/excalidraw/appState";

import type {
  ExcalidrawImperativeAPI,
  AppState,
  BinaryFiles,
} from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/element/types";

import { SceneSync } from "./sceneSync";

import type { ScenePacket } from "./sceneSync";

const shape = () => {
  const element = convertToExcalidrawElements([
    { type: "rectangle", x: 20, y: 20, width: 60, height: 60 },
  ])[0];
  if (element.type !== "rectangle") {
    throw new Error("Expected a rectangle");
  }
  return { ...element, isDeleted: false as const };
};
const peer = () => {
  let elements: readonly OrderedExcalidrawElement[] = [];
  let state = {
    ...getDefaultAppState(),
    width: 1920,
    height: 1080,
  } as AppState;
  let files: BinaryFiles = {};
  const changes = new Set<() => void>();
  const notify = () => changes.forEach((fn) => fn());
  const api = {
    getAppState: () => state,
    getFiles: () => files,
    getSceneElementsIncludingDeleted: () => elements,
    addFiles: (next: BinaryFiles[string][]) => {
      files = {
        ...files,
        ...Object.fromEntries(next.map((file) => [file.id, file])),
      };
    },
    updateScene: (next: {
      elements?: readonly OrderedExcalidrawElement[];
      appState?: Partial<AppState>;
    }) => {
      elements = next.elements || elements;
      state = { ...state, ...next.appState };
      notify();
    },
    onChange: (fn: Parameters<ExcalidrawImperativeAPI["onChange"]>[0]) => {
      const listener = () => fn(elements, state, files);
      changes.add(listener);
      return () => changes.delete(listener);
    },
    onPointerUp: () => () => {},
  } as unknown as ExcalidrawImperativeAPI;
  return {
    api,
    edit: (
      next: readonly OrderedExcalidrawElement[],
      appState?: Partial<AppState>,
    ) =>
      api.updateScene({ elements: next, appState: { ...state, ...appState } }),
    elements: () => elements,
  };
};

describe("local whiteboard synchronization", () => {
  it("synchronizes factory background patterns and their removal through the existing background clock", async () => {
    const source = peer();
    const target = peer();
    const sent: ScenePacket[] = [];
    const writer = new SceneSync(
      source.api,
      async (packet) => {
        sent.push(packet);
      },
      () => {},
    );
    const reader = new SceneSync(
      target.api,
      async () => {},
      () => {},
    );
    source.edit([], {
      whiteboardBackground: { pattern: 4, width: 1920, height: 1080 },
    });
    writer.flush(true);
    await Promise.resolve();
    reader.receive(sent[0]);
    expect(target.api.getAppState().whiteboardBackground?.pattern).toBe(4);
    source.edit([], { whiteboardBackground: undefined });
    writer.flush();
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    reader.receive(sent.at(-1)!);
    expect(target.api.getAppState().whiteboardBackground).toBeUndefined();
    writer.dispose();
    reader.dispose();
  });
  afterEach(() => vi.useRealTimers());
  it("sends while a stroke is still changing, instead of waiting for writing to stop", async () => {
    vi.useFakeTimers();
    const board = peer();
    const sent: ScenePacket[] = [];
    const sync = new SceneSync(
      board.api,
      async (packet) => {
        sent.push(packet);
      },
      (error) => {
        throw error;
      },
    );
    sync.start();
    const element = shape();
    for (let step = 1; step <= 15; step++) {
      const next = { ...element, width: step * 10, version: step };
      board.edit([next], { newElement: next });
      await vi.advanceTimersByTimeAsync(10);
    }
    expect(sent.length).toBeGreaterThanOrEqual(3);
    expect(sent[0].elements[0].width).toBeLessThan(150);
    sync.dispose();
  });
  it("flushes an unsent local change before applying a remote change", async () => {
    const board = peer();
    const sent: ScenePacket[] = [];
    const sync = new SceneSync(
      board.api,
      async (packet) => {
        sent.push(packet);
      },
      (error) => {
        throw error;
      },
    );
    const local = { ...shape(), version: 5 };
    board.edit([local]);
    const remote = shape();
    sync.receive({ kind: "scene", elements: [remote], files: {} });
    await Promise.resolve();
    await Promise.resolve();
    expect(
      sent[0].elements.some((el) => el.id === local.id && el.version === 5),
    ).toBe(true);
    expect(board.elements()).toHaveLength(2);
    sync.dispose();
  });
  it("finishes a locally edited object before accepting the server's concurrent winner", async () => {
    vi.useFakeTimers();
    const board = peer();
    const sent: ScenePacket[] = [];
    const sync = new SceneSync(
      board.api,
      async (packet) => {
        sent.push(packet);
      },
      (error) => {
        throw error;
      },
    );
    sync.start();
    const local = { ...shape(), version: 3, versionNonce: 99, x: 30 };
    board.edit([local], { newElement: local });
    await vi.advanceTimersByTimeAsync(50);
    const winning = { ...local, versionNonce: 1, x: 90 };
    const packet: ScenePacket = {
      kind: "scene",
      elements: [winning],
      files: {},
    };
    sync.receive(packet);
    expect(board.elements()[0].x).toBe(30);
    board.edit(board.elements(), { newElement: null });
    await vi.advanceTimersByTimeAsync(50);
    expect(sent.at(-1)?.elements.some((el) => el.id === local.id)).toBe(true);
    sync.receive(packet);
    expect(board.elements()[0].x).toBe(90);
    sync.dispose();
  });
});
