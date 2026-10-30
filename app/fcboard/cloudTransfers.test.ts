import { mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transferableAbortController } from "node:util";

import { convertToFcboardElements } from "@fcboard/fcboard";

import { createShareServer } from "../../services/board-share/server.mjs";

import { CloudPageShare, uploadCloudBzd, readCloudBzd } from "./cloudTransfers";
import { serializeBzd, parseBzd } from "./bzd";

import type { AddressInfo } from "node:net";
import type { Board } from "./boards";

const key = "test-service-key-for-cloud-transfers";
const image = "data:image/png;base64,iVBORw0KGgo=";
let directory: string;
let service: ReturnType<typeof createShareServer>;
let endpoint: string;
const start = async (totalBytes?: number) => {
  service = createShareServer({
    publicDir: directory,
    dataDir: join(directory, "private"),
    createToken: key,
    totalBytes,
  });
  await new Promise<void>((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  endpoint = `http://127.0.0.1:${
    (service.server.address() as AddressInfo).port
  }/`;
};
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "fcboard-cloud-transfers-"));
  await writeFile(
    join(directory, "index.html"),
    "<!doctype html><title>Whiteboard</title>",
  );
  await start();
  vi.stubGlobal(
    "AbortController",
    class {
      constructor() {
        return transferableAbortController();
      }
    },
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await service.close();
  await rm(directory, { recursive: true, force: true });
});

it("serves selected PNGs through a stable QR, enforces password on every image, and revokes old cookies when protection changes", async () => {
  const share = await CloudPageShare.start({ endpoint, key }, [image, image]);
  const url = share.url;
  const gallery = await fetch(url);
  expect(await gallery.text()).toContain("page-1.png");
  expect(await (await fetch(`${url}page-0.png`)).arrayBuffer()).toEqual(
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]).buffer,
  );
  const download = await fetch(`${url}page-1.png?download=1`);
  expect(download.headers.get("Content-Disposition")).toContain(
    "Fcboard-2.png",
  );
  expect((await fetch(`${url}page-20.png`)).status).toBe(404);
  await share.setPassword("0123");
  expect((await fetch(`${url}page-0.png`)).status).toBe(403);
  expect(await (await fetch(url)).text()).toContain('name="password"');
  const wrong = await fetch(url, {
    method: "POST",
    body: "password=1234",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  expect(await wrong.text()).toContain('role="alert"');
  const entered = await fetch(url, {
    method: "POST",
    body: "password=0123",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const cookie = entered.headers.get("Set-Cookie")!.split(";")[0];
  expect(entered.headers.get("Set-Cookie")).toContain("HttpOnly");
  expect(
    (await fetch(`${url}page-0.png`, { headers: { Cookie: cookie } })).status,
  ).toBe(200);
  await share.setPassword("4567");
  expect(
    (await fetch(`${url}page-0.png`, { headers: { Cookie: cookie } })).status,
  ).toBe(403);
  await expect(share.setPassword("12345")).rejects.toThrow("four digits");
  await share.setPassword("");
  expect((await fetch(`${url}page-0.png`)).status).toBe(200);
  expect(share.url).toBe(url);
  expect(url).not.toContain(key);
  await share.end();
  expect((await fetch(url)).status).toBe(410);
  await share.end();
});

it("expires static shares after ten minutes while BZD survives service restart and roundtrips actual editable pages by the original four-character code", async () => {
  const share = await CloudPageShare.start({ endpoint, key }, [image]);
  const boards: Board[] = ["第一板", "第二板"].map((name, index) => ({
    id: `board-${index}`,
    name,
    elements: convertToFcboardElements([
      { type: "text", text: name, x: 10, y: 20 },
    ]),
    files: {},
    view: {
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 1 as never },
      viewBackgroundColor: index ? "#000000" : "#ffffff",
      whiteboardBackground: {
        pattern: index ? 3 : 0,
        width: 1000,
        height: 600,
      },
    },
    updated: Date.now(),
  }));
  const xml = serializeBzd(boards);
  const uploaded = await uploadCloudBzd({ endpoint, key }, xml);
  expect(uploaded.code).toMatch(/^[A-Za-z0-9]{4}$/);
  expect(uploaded.expires).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
  expect(await readCloudBzd(endpoint, uploaded.code)).toBe(xml);
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 11 * 60 * 1000);
  expect((await fetch(share.url)).status).toBe(410);
  await share.end();
  await service.close();
  await start();
  const pages = await parseBzd(await readCloudBzd(endpoint, uploaded.code));
  expect(pages).toHaveLength(2);
  expect(pages.map((page) => page.name)).toEqual(
    boards.map((page) => page.name),
  );
  expect(pages[1].elements[0]).toMatchObject({ type: "text", text: "第二板" });
  expect(pages[1].view.whiteboardBackground?.pattern).toBe(3);
  expect(pages[1].view.viewBackgroundColor).toBe("#000000");
  vi.mocked(Date.now).mockReturnValue(now + 25 * 60 * 60 * 1000);
  await expect(readCloudBzd(endpoint, uploaded.code)).rejects.toThrow(
    "expired extraction code",
  );
  expect(await readdir(join(directory, "private"))).toEqual([]);
});

it("rejects bad data, unauthorized create/delete, and aggregate budget overflow without changing an existing share", async () => {
  await service.close();
  await start(20000);
  await expect(
    CloudPageShare.start({ endpoint, key: "wrong-key-long-enough" }, [image]),
  ).rejects.toThrow("service key");
  await expect(CloudPageShare.start({ endpoint, key }, [])).rejects.toThrow(
    "1–20",
  );
  await expect(
    uploadCloudBzd({ endpoint, key }, "<!DOCTYPE bzd><bzd></bzd>"),
  ).rejects.toThrow("Invalid BZD");
  const share = await CloudPageShare.start({ endpoint, key }, [image]);
  const id = share.url.split("/").at(-2);
  const unauthorized = await fetch(`${endpoint}shares/${id}`, {
    method: "DELETE",
    headers: { Authorization: "Bearer wrong" },
  });
  expect(unauthorized.status).toBe(401);
  await expect(
    CloudPageShare.start({ endpoint, key }, [
      `data:image/png;base64,${"YQ==".repeat(9000)}`,
    ]),
  ).rejects.toThrow();
  await expect(
    uploadCloudBzd({ endpoint, key }, `<bzd>${"x".repeat(21000)}</bzd>`),
  ).rejects.toThrow("budget");
  expect((await fetch(share.url)).status).toBe(200);
  await expect(readCloudBzd(endpoint, "!!!!")).rejects.toThrow(
    "four-character",
  );
  await expect(readCloudBzd(endpoint, "ZZZZ")).rejects.toThrow(
    "extraction code",
  );
  await share.end();
});

it("removes a real upload if cancellation arrives after server acceptance but before the response reaches the app", async () => {
  const controller = new AbortController();
  const realFetch = globalThis.fetch;
  let url = "";
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const response = await realFetch(input, init);
    if (String(input).endsWith("shares") && init?.method === "POST") {
      const accepted = await response.clone().json();
      url = `${endpoint}share/${accepted.id}/`;
      controller.abort();
    }
    return response;
  });
  await expect(
    CloudPageShare.start({ endpoint, key }, [image], controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(async () => expect((await realFetch(url)).status).toBe(410));
});
