import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { networkProxy } from "./network-proxy";

test("actual Scrcpy stream decodes through bundled WASM and sends device-level input", async ({
  page,
}, info) => {
  const stream = await readFile(
    "node_modules/.fcboard-research/scrcpy-stream.bin",
  );
  const width = stream.readUInt32BE(4);
  const height = stream.readUInt32BE(8);
  const input: Buffer[] = [];
  const fixture = await networkProxy(
    4189,
    (socket) => {
      socket.send(Buffer.concat([Buffer.from([0]), stream]));
      socket.on("message", (data, binary) => {
        if (binary) {
          input.push(Buffer.from(data as Buffer));
        } else if (data.toString() === "ping") {
          socket.send("pong");
        }
      });
    },
    (request, response) => {
      if (!request.url?.startsWith("/remote-api/")) {
        return false;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify(
          request.url.endsWith("auth")
            ? { token: "browser-test-session" }
            : { connected: true },
        ),
      );
      return true;
    },
  );
  try {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("http://127.0.0.1:4189/remote.html");
    await page.getByLabel("大屏配对码").fill("123456");
    await page.getByRole("button", { name: "配对", exact: true }).click();
    await page.getByLabel("连接端口", { exact: true }).fill("5555");
    await page.getByRole("button", { name: "连接大屏" }).click();
    await expect(page.getByRole("status")).toHaveText("已连接", {
      timeout: 30000,
    });
    const canvas = page.getByLabel("触摸控制大屏");
    const dimensions = await canvas.evaluate((el) => ({
      width: (el as HTMLCanvasElement).width,
      height: (el as HTMLCanvasElement).height,
    }));
    expect(dimensions).toEqual({ width, height });
    await canvas.click();
    await page.getByRole("button", { name: "主屏幕", exact: true }).click();
    await expect
      .poll(() => input.filter((bytes) => bytes[0] === 2).length)
      .toBeGreaterThanOrEqual(2);
    expect(
      input.some(
        (bytes) =>
          bytes[0] === 0 && bytes[1] === 0 && bytes.readUInt32BE(2) === 3,
      ),
    ).toBe(true);
    await page.locator("#type").click();
    await page.getByPlaceholder("输入到大屏，支持中文").fill("y=x+1");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect
      .poll(() =>
        input.some((bytes) => bytes.indexOf(Buffer.from("y=x+1")) >= 0),
      )
      .toBe(true);
    await page.screenshot({
      path: info.outputPath("wasm-scrcpy-device-control.png"),
    });
    await page.getByRole("button", { name: "断开", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("已断开");
  } finally {
    await fixture.close();
  }
});
