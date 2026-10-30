import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { transferableAbortController } from "node:util";

import { WebSocket } from "ws";

import { createShareServer } from "../../services/board-share/server.mjs";

import { CloudShare, publicCloudShareEndpoint } from "./cloudShare";

import type { AddressInfo } from "node:net";

const key = "test-service-key-for-real-network-tests";
const scene = { kind: "scene" as const, elements: [], files: {} };
const events = () => ({
  packet: vi.fn(),
  status: vi.fn(),
  peers: vi.fn(),
  error: vi.fn(),
  ended: vi.fn(),
});
let directory: string;
let service: ReturnType<typeof createShareServer>;
let endpoint: string;
let connections: WebSocket[];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "fcboard-cloud-client-"));
  await writeFile(
    join(directory, "index.html"),
    "<!doctype html><title>Whiteboard</title>",
  );
  service = createShareServer({
    publicDir: directory,
    createToken: key,
  });
  await new Promise<void>((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  endpoint = `http://127.0.0.1:${
    (service.server.address() as AddressInfo).port
  }/`;
  connections = [];
  vi.stubGlobal(
    "AbortController",
    class {
      constructor() {
        return transferableAbortController();
      }
    },
  );
  class Transport extends WebSocket {
    constructor(url: string) {
      super(url);
      connections.push(this);
    }
  }
  vi.stubGlobal("WebSocket", Transport);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await service.close();
  await rm(directory, { recursive: true, force: true });
});

it("waits for actual host authentication and a real scene before returning the stable public QR, and changes its password without recreating it", async () => {
  const callbacks = events();
  const share = await CloudShare.start({ endpoint, key }, scene, callbacks);
  expect(callbacks.packet).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "initial", elements: [] }),
    share,
  );
  expect(callbacks.status).toHaveBeenCalledWith("syncing_live");
  expect(share.url).toMatch(/\/#lan=[a-f0-9]{32}$/);
  expect(share.url).not.toContain(key);
  const url = share.url;
  await share.setPassword("0123");
  await share.setPassword("4567");
  await share.setPassword("");
  expect(share.url).toBe(url);
  expect(connections).toHaveLength(1);
  const updated = {
    ...scene,
    background: { color: "#123456", client: "teacher", clock: 1 },
  };
  await share.send(updated);
  await vi.waitFor(() =>
    expect(callbacks.packet).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "scene",
        background: updated.background,
      }),
      share,
    ),
  );
  await share.end();
  await expect(share.send(scene)).rejects.toThrow();
  expect(callbacks.ended).not.toHaveBeenCalled();
});

it("reconnects to the same real room after a broken transport and resynchronizes before continuing", async () => {
  const callbacks = events();
  const share = await CloudShare.start({ endpoint, key }, scene, callbacks);
  await share.setPassword("0123");
  connections[0].terminate();
  await vi.waitFor(() => expect(connections).toHaveLength(2), {
    timeout: 3000,
  });
  await vi.waitFor(() =>
    expect(
      callbacks.packet.mock.calls.filter(
        ([packet]) => packet.kind === "initial",
      ),
    ).toHaveLength(2),
  );
  expect(callbacks.status).toHaveBeenCalledWith(
    "connection_interrupted_reconnecting",
  );
  expect(callbacks.ended).not.toHaveBeenCalled();
  await share.setPassword("4567");
  await share.end();
});

it("reports a real service rejection and never opens a transport or returns a QR for an unaccepted room", async () => {
  await expect(
    CloudShare.start(
      { endpoint, key: "wrong-service-key-at-least-16" },
      scene,
      events(),
    ),
  ).rejects.toThrow("Invalid share-service key");
  expect(connections).toHaveLength(0);
  expect(publicCloudShareEndpoint("https://user:private@share.test/")).toBe("");
  expect(publicCloudShareEndpoint("https://share.test/?key=private")).toBe("");
});

it("cancels while waiting for host authentication, closes the socket and removes the created room without late success", async () => {
  vi.spyOn(WebSocket.prototype, "send").mockImplementation(() => {});
  const controller = new AbortController();
  const callbacks = events();
  const result = CloudShare.start(
    { endpoint, key },
    scene,
    callbacks,
    controller.signal,
  ).catch((error) => error);
  await vi.waitFor(() =>
    expect(connections[0]?.readyState).toBe(WebSocket.OPEN),
  );
  controller.abort();
  expect((await result).name).toBe("AbortError");
  await vi.waitFor(() =>
    expect(connections[0].readyState).toBe(WebSocket.CLOSED),
  );
  const room = new URL(connections[0].url).pathname.split("/").at(-1);
  await vi.waitFor(async () => {
    const response = await fetch(`${endpoint}rooms/${room}/password`, {
      method: "PUT",
      headers: {
        Authorization: "Bearer not-the-owner",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: "0123" }),
    });
    expect(response.status).toBe(404);
  });
  expect(callbacks.packet).not.toHaveBeenCalled();
  expect(callbacks.status).not.toHaveBeenCalledWith("syncing_live");
});
