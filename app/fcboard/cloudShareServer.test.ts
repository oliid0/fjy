import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WebSocket } from "ws";

import { createShareServer } from "../../services/board-share/server.mjs";

import type { AddressInfo } from "node:net";

const admin = "test-service-key-not-a-real-secret";
const room = "0123456789abcdef0123456789abcdef";
const key = "abcdef0123456789abcdef0123456789";
const scene = (elements: object[] = []) => ({
  kind: "scene",
  elements,
  files: {},
});
const element = (version = 1, versionNonce = 20, isDeleted = false) => ({
  id: "ink",
  version,
  versionNonce,
  isDeleted,
  type: "freedraw",
  points: [
    [0, 0],
    [20, 30],
  ],
  x: 100,
  y: 100,
});
let directory: string;
let service: ReturnType<typeof createShareServer>;
let endpoint: string;

class Peer {
  socket: WebSocket;
  messages: Record<string, any>[] = [];
  private listeners = new Set<() => void>();
  constructor(path: string) {
    this.socket = new WebSocket(endpoint.replace("http:", "ws:") + path);
    this.socket.on("message", (data) => {
      if (String(data) === "pong") {
        return;
      }
      this.messages.push(JSON.parse(String(data)));
      for (const listener of this.listeners) {
        listener();
      }
    });
  }
  send(value: object | string) {
    this.socket.send(typeof value === "string" ? value : JSON.stringify(value));
  }
  next(kind: string): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(check);
        reject(new Error(`Missing ${kind} packet`));
      }, 2000);
      const check = () => {
        const index = this.messages.findIndex((packet) =>
          kind === "error" ? !!packet.error : packet.kind === kind,
        );
        if (index < 0) {
          return;
        }
        clearTimeout(timer);
        this.listeners.delete(check);
        resolve(this.messages.splice(index, 1)[0]);
      };
      this.listeners.add(check);
      check();
    });
  }
}
const request = (
  path: string,
  method = "POST",
  value: unknown = undefined,
  token = admin,
) =>
  fetch(endpoint + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
const create = async () => {
  const response = await request("rooms", "POST", {
    room,
    key,
    scene: scene([element()]),
  });
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ room, protocol: 1 });
};
const host = async () => {
  const peer = new Peer(`host/${room}`);
  await new Promise<void>((resolve, reject) => {
    peer.socket.once("open", resolve);
    peer.socket.once("error", reject);
  });
  peer.send({ kind: "host", key });
  await peer.next("initial");
  return peer;
};

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "fcboard-share-"));
  await writeFile(
    join(directory, "index.html"),
    "<!doctype html><title>Whiteboard</title>",
  );
  await writeFile(join(directory, "app.js"), "export const board = true;");
  service = createShareServer({
    publicDir: directory,
    createToken: admin,
  });
  await new Promise<void>((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  endpoint = `http://127.0.0.1:${
    (service.server.address() as AddressInfo).port
  }/`;
});
afterEach(async () => {
  await service.close();
  await rm(directory, { recursive: true, force: true });
});

it("serves the actual packaged viewer at the scanner origin root and rejects unauthenticated creation and filesystem escapes", async () => {
  expect(await (await fetch(`${endpoint}health`)).json()).toMatchObject({
    service: "fcboard-live-share",
    protocol: 1,
    ready: true,
  });
  expect(await (await fetch(endpoint)).text()).toContain("Whiteboard");
  const script = await fetch(`${endpoint}app.js`);
  expect(script.headers.get("Content-Type")).toContain("javascript");
  expect(await script.text()).toBe("export const board = true;");
  expect(
    (await request("rooms", "POST", { room, key, scene: scene() }, "wrong"))
      .status,
  ).toBe(401);
  const outside = join(directory, "..", `${room}.txt`);
  await writeFile(outside, "private file");
  await symlink(outside, join(directory, "outside.txt"));
  try {
    expect((await fetch(`${endpoint}outside.txt`)).status).toBe(404);
  } finally {
    await rm(outside);
  }
  expect(
    (
      await fetch(`${endpoint}rooms`, {
        method: "POST",
        headers: { Origin: "https://untrusted.test" },
      })
    ).status,
  ).toBe(403);
  expect((await request("rooms", "POST", null)).status).toBe(400);
});

it("synchronizes real host and guest sockets with the native version/nonce rule, deletion, images and background", async () => {
  await create();
  const owner = await host();
  const guest = new Peer(`board/${room}`);
  expect((await guest.next("initial")).elements).toEqual([element()]);
  owner.send(scene([element(2, 30)]));
  expect((await guest.next("scene")).elements).toEqual([element(2, 30)]);
  await owner.next("scene");
  guest.send(scene([element(2, 10, true)]));
  expect((await owner.next("scene")).elements[0]).toMatchObject({
    version: 2,
    versionNonce: 10,
    isDeleted: true,
  });
  await guest.next("scene");
  owner.send({
    ...scene([element(1, 1)]),
    files: {
      image: {
        id: "image",
        dataURL: "data:image/png;base64,aGVsbG8=",
        mimeType: "image/png",
      },
    },
    background: {
      color: "#000000",
      clock: 3,
      client: "teacher",
      pattern: null,
    },
  });
  const received = await guest.next("scene");
  expect(received.elements[0]).toMatchObject({
    version: 2,
    versionNonce: 10,
    isDeleted: true,
  });
  expect(received.files.image.dataURL).toBe("data:image/png;base64,aGVsbG8=");
  expect(received.background.color).toBe("#000000");
  const reconnect = new Peer(`board/${room}`);
  const snapshot = await reconnect.next("initial");
  expect(snapshot.elements).toEqual(received.elements);
  expect(snapshot.files).toEqual(received.files);
  expect(snapshot.background).toEqual(received.background);
});

it("retains original courseware across pages and reconnects, scopes annotation edits, and rejects guest file replacement", async () => {
  await create();
  const owner = await host();
  const guest = new Peer(`board/${room}`);
  await guest.next("initial");
  const first = { id: "document:original:0", epoch: 1 };
  const document = {
    id: "original",
    name: "lesson.pptx",
    mimeType: "application/octet-stream",
    page: 0,
    dataURL: "data:application/octet-stream;base64,YQ==",
    view: { zoom: 1.5, scroll: 240, animation: 2, animate: true },
  };
  owner.send({ ...scene([element()]), page: first, document });
  expect((await guest.next("initial")).document).toEqual(document);
  await owner.next("initial");
  guest.send({
    ...scene([element(2)]),
    page: first,
    document: {
      ...document,
      name: "forged.pptx",
      dataURL: "data:application/octet-stream;base64,Yg==",
    },
  });
  expect((await owner.next("scene")).document).toEqual({
    ...document,
    dataURL: undefined,
  });
  await guest.next("scene");
  const second = { id: "document:original:1", epoch: 2 };
  owner.send({
    ...scene(),
    page: second,
    document: { ...document, page: 1, dataURL: undefined },
  });
  const next = await guest.next("initial");
  expect(next.elements).toEqual([]);
  expect(next.document).toEqual({ ...document, page: 1 });
  await owner.next("initial");
  guest.send({ ...scene([element(99)]), page: first });
  expect((await guest.next("initial")).elements).toEqual([]);
  const reconnect = new Peer(`board/${room}`);
  expect((await reconnect.next("initial")).document).toEqual({
    ...document,
    page: 1,
  });
  owner.send({ ...scene(), page: { id: "board", epoch: 3 } });
  expect((await guest.next("initial")).document).toBeUndefined();
});

it("keeps one room/QR when enabling, changing and disabling the original four-digit password and never sends content before joining", async () => {
  await create();
  const owner = await host();
  expect(
    (await request(`rooms/${room}/password`, "PUT", { password: "0123" }, key))
      .status,
  ).toBe(200);
  const guest = new Peer(`board/${room}`);
  expect(await guest.next("auth")).toMatchObject({
    required: true,
    incorrect: false,
  });
  expect(guest.messages.some((packet) => packet.kind === "initial")).toBe(
    false,
  );
  guest.send(scene([element(99)]));
  expect(await guest.next("auth")).toMatchObject({ incorrect: true });
  owner.send("snapshot");
  expect((await owner.next("initial")).elements).toEqual([element()]);
  guest.send({ kind: "join", password: "9999" });
  expect(await guest.next("auth")).toMatchObject({ incorrect: true });
  guest.send({ kind: "join", password: "0123" });
  expect((await guest.next("initial")).elements).toEqual([element()]);
  expect(
    (await request(`rooms/${room}/password`, "PUT", { password: "4567" }, key))
      .status,
  ).toBe(200);
  const waiting = new Peer(`board/${room}`);
  await waiting.next("auth");
  waiting.send({ kind: "join", password: "0123" });
  await waiting.next("auth");
  expect(
    (await request(`rooms/${room}/password`, "PUT", { password: "" }, key))
      .status,
  ).toBe(200);
  expect((await waiting.next("initial")).elements).toEqual([element()]);
  expect(
    (await request(`rooms/${room}/password`, "PUT", { password: "12345" }, key))
      .status,
  ).toBe(400);
});

it("rejects unauthorized ownership, rolls back invalid batches and closes every participant when the host ends", async () => {
  await create();
  const owner = await host();
  expect(
    (
      await request(
        `rooms/${room}/password`,
        "PUT",
        { password: "0123" },
        "wrong",
      )
    ).status,
  ).toBe(401);
  const guest = new Peer(`board/${room}`);
  await guest.next("initial");
  guest.send({ ...scene([element(100), { id: "bad" }]) });
  await guest.next("error");
  owner.send("snapshot");
  expect((await owner.next("initial")).elements).toEqual([element()]);
  const closed = new Promise<number>((resolve) =>
    guest.socket.once("close", resolve),
  );
  expect(
    (await request(`rooms/${room}`, "DELETE", undefined, key)).status,
  ).toBe(200);
  expect(await closed).toBe(1000);
  expect(
    (await request(`rooms/${room}/password`, "PUT", { password: "0123" }, key))
      .status,
  ).toBe(404);
  const wrongOwner = await request("rooms", "POST", {
    room,
    key: "not-a-room-key",
    scene: scene(),
  });
  expect(wrongOwner.status).toBe(400);
});

it("keeps the same room as the host changes pages and rejects stale or guest-forged page transitions atomically", async () => {
  const first = { id: "first", epoch: 0 };
  expect(
    (
      await request("rooms", "POST", {
        room,
        key,
        scene: { ...scene([element()]), page: first },
      })
    ).status,
  ).toBe(201);
  const owner = await host();
  const guest = new Peer(`board/${room}`);
  expect((await guest.next("initial")).page).toEqual(first);
  owner.send({ ...scene(), page: { id: "second", epoch: 1 } });
  const next = await guest.next("initial");
  await owner.next("initial");
  expect(next.elements).toEqual([]);
  expect(next.files).toEqual({});
  expect(next.page).toEqual({ id: "second", epoch: 1 });
  guest.send({ ...scene([element(99)]), page: first });
  expect((await guest.next("initial")).elements).toEqual([]);
  await owner.next("initial");
  guest.send({ ...scene([element(99)]), page: { id: "forged", epoch: 100 } });
  expect((await owner.next("initial")).page).toEqual(next.page);
  await guest.next("initial");
  owner.send({ ...scene([{ id: "bad" }]), page: { id: "third", epoch: 2 } });
  await owner.next("error");
  owner.send("snapshot");
  expect((await owner.next("initial")).page).toEqual(next.page);
  owner.send({ ...scene([element(2)]), page: { id: "first", epoch: 2 } });
  const returned = await guest.next("initial");
  expect(returned.page).toEqual({ id: "first", epoch: 2 });
  expect(returned.elements).toEqual([element(2)]);
});
