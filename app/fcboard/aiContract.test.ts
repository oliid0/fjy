import { createServer } from "node:http";
import { transferableAbortController } from "node:util";

import { Capacitor } from "@capacitor/core";

import { chat, visualMessage } from "./ai";
import { defaults } from "./settings";

import type { AddressInfo } from "node:net";

// Real HTTP bytes through the production client. Response bodies follow the
// supplied Ark PDF's Chat/Responses protocols; no paid supplier is simulated as verified.
it.each([false, true])(
  "routes selected text/vision models without fast fields and decodes actual streamed HTTP (Responses=%s)",
  async (responses) => {
    // Node's actual fetch rejects jsdom's different-realm AbortSignal.
    vi.stubGlobal("AbortController", transferableAbortController().constructor);
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
    const requests: Record<string, unknown>[] = [];
    const failures: string[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      requests.push(body);
      if (body.service_tier === "fast") {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            error: { message: "service_tier fast is not supported" },
          }),
        );
        return;
      }
      if (
        request.headers.authorization !== "Bearer contract-test-only" ||
        request.headers["content-type"] !== "application/json"
      ) {
        failures.push("standard headers missing");
      }
      if (
        Object.keys(request.headers).some((header) =>
          /fast|thinking|reasoning|prompt.cache/i.test(header),
        )
      ) {
        failures.push("unexpected special header");
      }
      if (
        body.model !== defaults.model &&
        [
          "service_tier",
          "thinking",
          "reasoning",
          "prompt_cache_key",
          "temperature",
        ].some((field) => field in body)
      ) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({ error: { message: "Unsupported model override" } }),
        );
        return;
      }
      const final = responses
        ? {
            status: "completed",
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: "请求成功" }],
              },
            ],
          }
        : undefined;
      const frames = responses
        ? [
            { type: "response.output_text.delta", delta: "请求成功" },
            { type: "response.completed", response: final },
          ]
        : [
            { choices: [{ delta: { content: "请求成功" } }] },
            { choices: [{ delta: {}, finish_reason: "stop" }] },
          ];
      const bytes = Buffer.from(
        frames
          .map((frame) => `data: ${JSON.stringify(frame)}\r\n\r\n`)
          .join("") + (responses ? "" : "data: [DONE]\r\n\r\n"),
      );
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
      });
      // Split inside a Chinese UTF-8 sequence, then the SSE JSON/frame boundary.
      const first = bytes.indexOf(Buffer.from("请求")) + 1;
      response.write(bytes.subarray(0, first));
      setTimeout(() => {
        response.write(bytes.subarray(first, first + 7));
        response.end(bytes.subarray(first + 7));
      }, 5);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const endpoint = `http://127.0.0.1:${
        (server.address() as AddressInfo).port
      }/${responses ? "responses" : "chat/completions"}`;
      const settings = {
        ...defaults,
        endpoint,
        apiKey: "contract-test-only",
        model: "selected-text-model",
        ocrModel: "selected-vision-model",
      };
      const delta = vi.fn();
      expect(
        await chat([{ role: "user", content: "写标题" }], undefined, settings, {
          onDelta: delta,
        }),
      ).toBe("请求成功");
      expect(delta).toHaveBeenCalledWith("请求成功");
      expect(
        await chat(
          [visualMessage("识别此图形", "data:image/png;base64,AA==")],
          undefined,
          settings,
        ),
      ).toBe("请求成功");
      expect(requests.map((request) => request.model)).toEqual([
        "selected-text-model",
        "selected-vision-model",
      ]);
      if (responses) {
        expect(requests[1]).toMatchObject({
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: "识别此图形" },
                {
                  type: "input_image",
                  image_url: "data:image/png;base64,AA==",
                },
              ],
            },
          ],
        });
      } else {
        expect(requests[1]).toMatchObject({
          messages: [visualMessage("识别此图形", "data:image/png;base64,AA==")],
        });
      }
      expect(failures).toEqual([]);
      const nativeFetch = fetch;
      vi.stubGlobal(
        "fetch",
        (
          _input: Parameters<typeof fetch>[0],
          init: Parameters<typeof fetch>[1],
        ) => nativeFetch(endpoint, init),
      );
      const fallback = {
        ...settings,
        endpoint: responses
          ? defaults.endpoint.replace("/chat/completions", "/responses")
          : defaults.endpoint,
        model: defaults.model,
      };
      expect(
        await chat(
          [{ role: "user", content: "普通回退" }],
          undefined,
          fallback,
        ),
      ).toBe("请求成功");
      expect(
        await chat(
          [{ role: "user", content: "继续执行" }],
          undefined,
          fallback,
        ),
      ).toBe("请求成功");
      expect(requests).toHaveLength(5);
      expect(requests[2].service_tier).toBe("fast");
      for (const request of requests.slice(3)) {
        for (const field of [
          "service_tier",
          "thinking",
          "reasoning",
          "prompt_cache_key",
        ]) {
          expect(request).not.toHaveProperty(field);
        }
      }
      expect(failures).toEqual([]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  },
);
