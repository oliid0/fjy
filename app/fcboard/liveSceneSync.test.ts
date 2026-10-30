import { convertToFcboardElements } from "@fcboard/fcboard";
import { getDefaultAppState } from "@fcboard/fcboard/appState";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { classroomCommands } from "./commands";
import { documentSharing } from "./documentSharing";
import { LiveSceneSync } from "./liveSceneSync";

import type { SharedDocumentSource } from "./documentSharing";
import type { ScenePacket } from "./sceneSync";

const board = () =>
  ({
    getAppState: () => getDefaultAppState(),
    getFiles: () => ({}),
    getSceneElementsIncludingDeleted: () =>
      convertToFcboardElements([
        { type: "text", id: "board", text: "原白板", x: 0, y: 0 },
      ]),
    onChange: () => () => {},
    onPointerUp: () => () => {},
    addFiles: vi.fn(),
    updateScene: vi.fn(),
    resetScene: vi.fn(),
    history: { clear: vi.fn() },
  } as unknown as FcboardImperativeAPI);
const source = (
  file = new File(["original-office-bytes"], "教学.pptx", {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  }),
): SharedDocumentSource => {
  const value: SharedDocumentSource = {
    id: "source-document",
    file,
    page: 0,
    ready: true,
    ink: [
      {
        id: "annotation",
        points: [[40, 70]],
        width: 2,
        color: "#ee2222",
        text: "牛顿定律",
        fontSize: 24,
      },
    ],
    view: { zoom: 1, scroll: 0, animation: 0, animate: true },
    present: vi.fn(),
    apply: vi.fn((ink) => {
      value.ink = ink;
      documentSharing.changed();
    }),
    navigate: vi.fn(async (page) => {
      value.page = page;
      documentSharing.changed();
    }),
    close: vi.fn(async () => {}),
  };
  return value;
};

it("keeps the original file and lossless annotations in the same room, sends the file once, and returns to the untouched board", async () => {
  const document = source();
  const detach = documentSharing.attach(() => document);
  const packets: ScenePacket[] = [];
  const errors = vi.fn();
  const api = board();
  const sync = new LiveSceneSync(
    api,
    async (packet) => {
      packets.push(packet);
    },
    errors,
  );
  try {
    sync.hostPage("original-board");
    await sync.initialize();
    const initial = sync.snapshot();
    expect(initial.document).toMatchObject({
      name: "教学.pptx",
      page: 0,
      dataURL: expect.stringContaining("base64,"),
    });
    expect(initial.elements[0].customData?.fcSharedDocumentInk).toEqual(
      document.ink[0],
    );
    sync.start();
    sync.flush(true);
    await vi.waitFor(() => expect(packets).toHaveLength(1));
    document.ink = [{ ...document.ink[0], text: "电流与电阻" }];
    documentSharing.changed();
    await vi.waitFor(() => expect(packets).toHaveLength(2));
    expect(packets[1].document?.dataURL).toBeUndefined();
    expect(packets[1].elements[0].customData?.fcSharedDocumentInk.text).toBe(
      "电流与电阻",
    );
    document.page = 1;
    document.ink = [];
    documentSharing.changed();
    await vi.waitFor(() => expect(packets).toHaveLength(3));
    expect(packets[2].page!.epoch).toBeGreaterThan(packets[1].page!.epoch);
    expect(packets[2].elements).toEqual([]);
    expect(packets[2].document).toMatchObject({ page: 1 });
    document.view = { ...document.view, scroll: 400, zoom: 1.5, animation: 2 };
    documentSharing.changed();
    await vi.waitFor(() => expect(packets).toHaveLength(4));
    expect(packets[3].document?.view).toEqual(document.view);
    detach();
    await vi.waitFor(() => expect(packets).toHaveLength(5));
    expect(packets[4].document).toBeUndefined();
    expect(packets[4].elements[0]).toMatchObject({
      type: "text",
      text: "原白板",
    });
    expect(api.updateScene).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  } finally {
    sync.dispose();
    detach();
  }
});

it("opens the received original file, follows its page, returns editable peer ink and ignores an older page after navigation", async () => {
  const original = source();
  let detach = documentSharing.attach(() => original);
  const writer = new LiveSceneSync(
    board(),
    async () => {},
    () => {},
  );
  writer.hostPage("host-board");
  await writer.initialize();
  const initial = JSON.parse(JSON.stringify(writer.snapshot())) as ScenePacket;
  original.page = 1;
  original.ink = [];
  await writer.initialize();
  const second = JSON.parse(JSON.stringify(writer.snapshot())) as ScenePacket;
  writer.dispose();
  detach();

  let opened: SharedDocumentSource | undefined;
  const open = vi.fn(async ({ file }: Record<string, unknown>) => {
    opened = source(file as File);
    opened.id = "guest-local-id";
    opened.close = vi.fn(async () => detach());
    detach = documentSharing.attach(() => opened!);
  });
  const unregister = classroomCommands.register(
    "document.share.open",
    "@internal",
    open,
  );
  const sent: ScenePacket[] = [];
  const errors = vi.fn();
  const reader = new LiveSceneSync(
    board(),
    async (packet) => {
      sent.push(packet);
    },
    errors,
  );
  reader.start();
  try {
    await reader.receive(initial);
    expect(open).toHaveBeenCalledTimes(1);
    expect(opened!.file.name).toBe("教学.pptx");
    expect(opened!.ink[0].text).toBe("牛顿定律");
    expect(opened!.apply).toHaveBeenCalledWith(expect.any(Array), true);
    expect(documentSharing.following).toBe(true);
    opened!.ink = [
      ...opened!.ink,
      {
        id: "guest-writing",
        color: "#000000",
        width: 3,
        points: [
          [10, 20],
          [20, 30],
        ],
      },
    ];
    documentSharing.changed();
    await vi.waitFor(() =>
      expect(
        sent.some((packet) =>
          packet.elements.some((element) => element.id === "guest-writing"),
        ),
      ).toBe(true),
    );
    expect(sent.at(-1)?.page).toEqual(initial.page);
    await reader.receive(second);
    expect(open).toHaveBeenCalledTimes(1);
    expect(opened!.navigate).toHaveBeenCalledWith(1);
    expect(opened!.ink).toEqual([]);
    await reader.receive(initial);
    expect(opened!.page).toBe(1);
    expect(opened!.ink).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
  } finally {
    reader.dispose();
    detach();
    unregister();
  }
});

it("does not publish a loading destination or revive ink removed by a peer", async () => {
  const document = source();
  const detach = documentSharing.attach(() => document);
  const packets: ScenePacket[] = [];
  const errors = vi.fn();
  const sync = new LiveSceneSync(
    board(),
    async (packet) => {
      packets.push(packet);
    },
    errors,
  );
  try {
    sync.hostPage("board");
    await sync.initialize();
    sync.start();
    sync.flush(true);
    await vi.waitFor(() => expect(packets).toHaveLength(1));
    const removed = { ...packets[0].elements[0], version: 10, isDeleted: true };
    await sync.receive({
      ...packets[0],
      elements: [removed],
      document: undefined,
    });
    expect(document.ink).toEqual([]);
    sync.flush(true);
    await vi.waitFor(() => expect(packets).toHaveLength(2));
    expect(packets[1].elements[0]).toMatchObject({
      id: removed.id,
      isDeleted: true,
      version: 10,
    });
    document.ready = false;
    document.page = 1;
    documentSharing.changed();
    sync.flush(true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(packets).toHaveLength(2);
    expect(errors).not.toHaveBeenCalled();
  } finally {
    sync.dispose();
    detach();
  }
});
