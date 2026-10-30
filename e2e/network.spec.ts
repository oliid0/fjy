import { expect, test } from "@playwright/test";

import { selectMenu } from "./menu";

import { networkProxy } from "./network-proxy";

import type { Page } from "@playwright/test";

test("two separate devices receive live drawing, undo and reconnect without copying snapshots manually", async ({
  browser,
}, info) => {
  type Element = {
    id: string;
    type: string;
    version: number;
    versionNonce: number;
    isDeleted: boolean;
    width: number;
  };
  const elements = new Map<string, Element>();
  let background: { color: string; clock: number; client: string } | undefined;
  const fixture = await networkProxy(4188, (socket) => {
    socket.send(
      JSON.stringify({
        kind: "initial",
        elements: Array.from(elements.values()),
        files: {},
        background,
      }),
    );
    socket.on("message", (data) => {
      if (data.toString() === "ping") {
        socket.send("pong");
        return;
      }
      if (data.toString() === "snapshot") {
        socket.send(
          JSON.stringify({
            kind: "initial",
            elements: Array.from(elements.values()),
            files: {},
            background,
          }),
        );
        return;
      }
      const packet = JSON.parse(data.toString());
      for (const next of packet.elements as Element[]) {
        const old = elements.get(next.id);
        if (
          !old ||
          next.version > old.version ||
          (next.version === old.version && next.versionNonce < old.versionNonce)
        ) {
          elements.set(next.id, next);
        }
      }
      if (
        packet.background &&
        (!background ||
          packet.background.clock > background.clock ||
          (packet.background.clock === background.clock &&
            packet.background.client > background.client))
      ) {
        background = packet.background;
      }
      const accepted = JSON.stringify({
        kind: "scene",
        elements: packet.elements.map((el: Element) => elements.get(el.id)),
        files: packet.files,
        ...(packet.background ? { background } : {}),
      });
      fixture.sockets.clients.forEach((peer) => peer.send(accepted));
    });
  });
  const first = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1920, height: 1080 },
  });
  const second = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1280, height: 720 },
  });
  const scene = (page: Page) =>
    page.evaluate(
      () => JSON.parse(localStorage.getItem("fcboard") || "[]") as Element[],
    );
  try {
    const a = await first.newPage();
    const b = await second.newPage();
    for (const page of [a, b]) {
      await page.goto(
        "http://127.0.0.1:4188/#lan=0123456789abcdef0123456789abcdef",
      );
      await selectMenu(page, "实时协作");
      await expect(
        page.getByRole("status").filter({ hasText: "实时同步中" }),
      ).toBeVisible();
      await page.mouse.click(80, 80);
    }
    await a.keyboard.press("r");
    await a.mouse.move(200, 160);
    await a.mouse.down();
    for (let step = 0; step < 10; step++) {
      await a.mouse.move(240 + step * 15, 280);
      await a.waitForTimeout(35);
    }
    // This assertion happens before mouse-up: a completed-shape-only sync would fail.
    await expect
      .poll(async () =>
        (
          await scene(b)
        ).some(
          (el) => el.type === "rectangle" && el.width > 0 && !el.isDeleted,
        ),
      )
      .toBe(true);
    await a.mouse.up();
    await b.keyboard.press("v");
    await b.keyboard.press("Control+a");
    await b.keyboard.press("Delete");
    await expect
      .poll(async () => (await scene(a)).filter((el) => !el.isDeleted).length)
      .toBe(0);
    await b.keyboard.press("Control+z");
    await expect
      .poll(async () => (await scene(a)).filter((el) => !el.isDeleted).length)
      .toBe(1);
    for (const socket of fixture.sockets.clients) {
      socket.terminate();
    }
    await expect.poll(() => fixture.sockets.clients.size).toBe(0);
    await expect.poll(() => fixture.sockets.clients.size).toBe(2);
    await expect
      .poll(async () => (await scene(b)).filter((el) => !el.isDeleted).length)
      .toBe(1);
    await b.screenshot({
      path: info.outputPath("second-device-live-board.png"),
    });
  } finally {
    await first.close();
    await second.close();
    await fixture.close();
  }
});
