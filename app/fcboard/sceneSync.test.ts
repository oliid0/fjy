import { convertToFcboardElements } from "@fcboard/fcboard";
import { getDefaultAppState } from "@fcboard/fcboard/appState";

import type {
  FcboardImperativeAPI,
  AppState,
  BinaryFiles,
} from "@fcboard/fcboard/types";
import type { OrderedFcboardElement } from "@fcboard/element/types";

import { SceneSync } from "./sceneSync";

import type { ScenePacket } from "./sceneSync";

const shape = () => {
  const element = convertToFcboardElements([
    { type: "rectangle", x: 20, y: 20, width: 60, height: 60 },
  ])[0];
  if (element.type !== "rectangle") {
    throw new Error("Expected a rectangle");
  }
  return { ...element, isDeleted: false as const };
};
const peer = () => {
  let elements: readonly OrderedFcboardElement[] = [];
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
    resetScene: vi.fn(() => {
      elements = [];
      files = {};
      state = {
        ...getDefaultAppState(),
        width: 1920,
        height: 1080,
      } as AppState;
    }),
    history: { clear: vi.fn() },
    addFiles: (next: BinaryFiles[string][]) => {
      files = {
        ...files,
        ...Object.fromEntries(next.map((file) => [file.id, file])),
      };
    },
    updateScene: (next: {
      elements?: readonly OrderedFcboardElement[];
      appState?: Partial<AppState>;
    }) => {
      elements = next.elements || elements;
      state = { ...state, ...next.appState };
      notify();
    },
    onChange: (fn: Parameters<FcboardImperativeAPI["onChange"]>[0]) => {
      const listener = () => fn(elements, state, files);
      changes.add(listener);
      return () => changes.delete(listener);
    },
    onPointerUp: () => () => {},
  } as unknown as FcboardImperativeAPI;
  return {
    api,
    edit: (
      next: readonly OrderedFcboardElement[],
      appState?: Partial<AppState>,
    ) =>
      api.updateScene({ elements: next, appState: { ...state, ...appState } }),
    elements: () => elements,
  };
};

describe("local whiteboard synchronization", () => {
  it("replaces pages without mixing elements, files, backgrounds or history, and ignores late packets from earlier visits to the same board", async () => {
    const host = peer();
    const guest = peer();
    const packets: ScenePacket[] = [];
    const writer = new SceneSync(
      host.api,
      async (packet) => {
        packets.push(packet);
      },
      () => {},
    );
    const reader = new SceneSync(
      guest.api,
      async () => {},
      () => {},
    );
    const first = shape();
    host.api.addFiles([
      {
        id: "old-file",
        dataURL: "data:image/png;base64,YQ==",
        mimeType: "image/png",
        created: 1,
      } as BinaryFiles[string],
    ]);
    host.edit([first], { viewBackgroundColor: "#000000" });
    writer.hostPage("first");
    writer.flush(true);
    await vi.waitFor(() => expect(packets).toHaveLength(1));
    reader.receive(packets[0]);
    expect(guest.api.getFiles()["old-file"]).toBeDefined();
    expect(guest.elements()).toMatchObject([
      { id: first.id, type: "rectangle", x: first.x, y: first.y },
    ]);
    host.api.resetScene();
    host.edit([], {
      viewBackgroundColor: "#ffffff",
      whiteboardBackground: undefined,
    });
    writer.hostPage("second");
    writer.flush(true);
    await vi.waitFor(() => expect(packets).toHaveLength(2));
    reader.receive(packets[1]);
    expect(guest.elements()).toEqual([]);
    expect(guest.api.getFiles()).toEqual({});
    expect(guest.api.getAppState().viewBackgroundColor).toBe("#ffffff");
    reader.receive(packets[0]);
    writer.receive(packets[0]);
    expect(guest.elements()).toEqual([]);
    expect(host.elements()).toEqual([]);
    const second = shape();
    host.edit([first, second]);
    writer.hostPage("first");
    writer.flush(true);
    await vi.waitFor(() => expect(packets).toHaveLength(3));
    reader.receive(packets[2]);
    expect(packets[2].page).toEqual({ id: "first", epoch: 2 });
    reader.receive(packets[0]);
    expect(guest.elements()).toHaveLength(2);
    expect(guest.api.history.clear).toHaveBeenCalledTimes(3);
    writer.dispose();
    reader.dispose();
  });
  it("shares a custom background as page data and does not resend it for unrelated stroke updates", async () => {
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
    const image =
      "data:image/png;base64,YQ==" as import("@fcboard/fcboard/types").DataURL;
    source.edit([], {
      whiteboardBackground: { pattern: 14, width: 1920, height: 1080, image },
    });
    writer.flush();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    reader.receive(sent[0]);
    expect(target.api.getAppState().whiteboardCustomBackground).toBe(image);
    source.edit([shape()]);
    writer.flush();
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].background).toBeUndefined();
    writer.dispose();
    reader.dispose();
  });
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
