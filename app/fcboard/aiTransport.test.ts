import { Capacitor } from "@capacitor/core";

import { chat } from "./ai";
import { AIStream, postAI } from "./aiTransport";
import { defaults } from "./settings";
import { Classroom } from "./native";

vi.mock("./native", () => ({
  Classroom: {
    addListener: vi.fn(),
    postAIStream: vi.fn(),
    cancelAIStream: vi.fn().mockResolvedValue(undefined),
  },
}));
const frame = (data: unknown) => `data: ${JSON.stringify(data)}\r\n\r\n`;
const delta = (text: string) =>
  frame({ choices: [{ delta: { content: text } }] });
const stop = `${frame({
  choices: [{ delta: {}, finish_reason: "stop" }],
})}data: [DONE]\r\n\r\n`;

describe("incremental AI transport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("parses arbitrarily split SSE frames and streams text before completion", () => {
    const onDelta = vi.fn();
    const stream = new AIStream(false, onDelta);
    const first = delta("你好");
    for (const character of first) {
      stream.push(character);
    }
    expect(onDelta).toHaveBeenCalledWith("你好");
    stream.push(delta("世界") + stop);
    expect(stream.finish()).toBe("你好世界");
  });
  it("ignores thinking deltas and requires a completed Responses event", () => {
    const onDelta = vi.fn();
    const stream = new AIStream(true, onDelta);
    stream.push(
      frame({
        type: "response.reasoning_summary_text.delta",
        delta: "private",
      }),
    );
    stream.push(frame({ type: "response.output_text.delta", delta: "2" }));
    expect(onDelta.mock.calls).toEqual([["2"]]);
    stream.push(
      frame({
        type: "response.completed",
        response: {
          status: "completed",
          output: [
            { type: "message", content: [{ type: "output_text", text: "2" }] },
          ],
        },
      }),
    );
    expect(stream.finish()).toBe("2");
  });
  it("refuses truncated, length-limited and failed replies instead of applying partial commands", () => {
    const truncated = new AIStream(false, vi.fn());
    truncated.push(delta('{"action":'));
    expect(() => truncated.finish()).toThrow();
    const limited = new AIStream(false, vi.fn());
    expect(() =>
      limited.push(frame({ choices: [{ finish_reason: "length" }] })),
    ).toThrow();
    const failed = new AIStream(true, vi.fn());
    expect(() =>
      failed.push(
        frame({
          type: "response.failed",
          response: { error: { message: "upstream failure" } },
        }),
      ),
    ).toThrow("upstream failure");
  });
  it("decodes split UTF-8 from a real ReadableStream", async () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(delta("答案") + stop);
    const onChunk = vi.fn();
    const parser = new AIStream(false, onChunk);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers({ "content-type": "text/event-stream" }),
        body: new ReadableStream({
          start(controller) {
            for (const byte of bytes) {
              controller.enqueue(new Uint8Array([byte]));
            }
            controller.close();
          },
        }),
      }),
    );
    const response = await postAI(
      defaults.endpoint,
      "test",
      {},
      new AbortController().signal,
      (chunk) => parser.push(chunk),
    );
    expect(response.stream).toBe(true);
    expect(parser.finish()).toBe("答案");
    expect(onChunk).toHaveBeenCalledWith("答案");
  });
  it("uses fast only for the default text model and keeps custom models on the ordinary schema", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      status: 200,
      text: async () =>
        JSON.stringify({ choices: [{ message: { content: "answer" } }] }),
    });
    vi.stubGlobal("fetch", fetcher);
    const settings = { ...defaults, apiKey: "test-secret" };
    for (const question of ["one", "two"]) {
      await chat(
        [
          { role: "system", content: "stable rules" },
          { role: "user", content: question },
        ],
        undefined,
        settings,
      );
    }
    await chat([{ role: "system", content: "stable rules" }], undefined, {
      ...settings,
      model: "other-model",
    });
    const bodies = fetcher.mock.calls.map((call) => JSON.parse(call[1].body));
    expect(bodies[0]).toMatchObject({
      model: "doubao-seed-2-0-mini-260428",
      stream: true,
      service_tier: "fast",
    });
    expect(bodies[0].prompt_cache_key).toBeUndefined();
    expect(bodies[0].thinking).toBeUndefined();
    expect(bodies[2].service_tier).toBeUndefined();
    expect(bodies[2].prompt_cache_key).toBeUndefined();
  });
  it("reads Android chunks incrementally and removes the listener after completion", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    vi.spyOn(Capacitor, "isPluginAvailable").mockReturnValue(true);
    const remove = vi.fn().mockResolvedValue(undefined);
    let receive!: (event: { id: string; chunk: string }) => void;
    vi.mocked(Classroom.addListener).mockImplementation(
      async (_event, callback) => {
        receive = callback as unknown as typeof receive;
        return { remove };
      },
    );
    vi.mocked(Classroom.postAIStream).mockImplementation(async ({ id }) => {
      receive({ id: "another-request", chunk: delta("wrong") });
      receive({ id, chunk: delta("2") });
      receive({ id, chunk: stop });
      return { status: 200, data: "", stream: true };
    });
    const onDelta = vi.fn();
    expect(
      await chat([], undefined, { ...defaults, apiKey: "test" }, { onDelta }),
    ).toBe("2");
    expect(onDelta.mock.calls).toEqual([["2"]]);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

it("retries rejected fast requests once without changing the model or adding tuning fields", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({
      status: 400,
      text: async () =>
        JSON.stringify({ error: { message: "service_tier unsupported" } }),
    })
    .mockResolvedValueOnce({
      status: 200,
      text: async () =>
        JSON.stringify({ choices: [{ message: { content: "成功" } }] }),
    });
  vi.stubGlobal("fetch", fetcher);
  try {
    expect(
      await chat([{ role: "user", content: "测试" }], undefined, {
        ...defaults,
        apiKey: "test",
      }),
    ).toBe("成功");
    const bodies = fetcher.mock.calls.map((call) => JSON.parse(call[1].body));
    expect(bodies[0].service_tier).toBe("fast");
    expect(bodies[1]).toEqual({
      model: defaults.model,
      messages: [{ role: "user", content: "测试" }],
      stream: true,
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
it("routes attached images to the configured vision model with ordinary parameters", async () => {
  const fetcher = vi.fn().mockResolvedValue({
    status: 200,
    text: async () =>
      JSON.stringify({ choices: [{ message: { content: "图画" } }] }),
  });
  vi.stubGlobal("fetch", fetcher);
  try {
    await chat(
      [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,image" },
            },
          ],
        },
      ],
      undefined,
      { ...defaults, apiKey: "test", ocrModel: "vision-model" },
    );
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      model: "vision-model",
      messages: expect.any(Array),
      stream: true,
    });
    expect(fetcher.mock.calls[0][1].headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer test",
    });
  } finally {
    vi.unstubAllGlobals();
  }
});

it.each([false, true])(
  "retries a failed partial fast stream without duplicating previews (reset hook: %s)",
  async (resettable) => {
    const wire = (body: string) => ({
      status: 200,
      headers: new Headers({ "content-type": "text/event-stream" }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(body));
          controller.close();
        },
      }),
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        wire(
          delta("partial") +
            frame({ error: { message: "fast stream failed" } }),
        ),
      )
      .mockResolvedValueOnce(wire(delta("complete") + stop));
    vi.stubGlobal("fetch", fetcher);
    let preview = "";
    const onReset = vi.fn(() => {
      preview = "";
    });
    try {
      const result = await chat(
        [{ role: "user", content: "hello" }],
        undefined,
        { ...defaults, apiKey: "test" },
        {
          onDelta: (text) => {
            preview += text;
          },
          ...(resettable ? { onReset } : {}),
        },
      );
      expect(result).toBe("complete");
      expect(preview).toBe("complete");
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(
        JSON.parse(fetcher.mock.calls[1][1].body).service_tier,
      ).toBeUndefined();
      expect(onReset).toHaveBeenCalledTimes(resettable ? 1 : 0);
    } finally {
      vi.unstubAllGlobals();
    }
  },
);

it("cancels a stalled fast attempt and reserves the remaining deadline for ordinary inference", async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      (_url, options) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener(
            "abort",
            () => reject(options.signal.reason),
            { once: true },
          ),
        ),
    )
    .mockResolvedValueOnce({
      status: 200,
      text: async () =>
        JSON.stringify({ choices: [{ message: { content: "recovered" } }] }),
    });
  vi.stubGlobal("fetch", fetcher);
  try {
    const result = chat(
      [{ role: "user", content: "hello" }],
      undefined,
      { ...defaults, apiKey: "test" },
      { timeoutMs: 2000 },
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toBe("recovered");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    expect(
      JSON.parse(fetcher.mock.calls[1][1].body).service_tier,
    ).toBeUndefined();
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("retains a healthy fast stream past the initial timeout while chunks keep arriving", async () => {
  vi.useFakeTimers();
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  const fetcher = vi
    .fn()
    .mockImplementationOnce((_url, options) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          writer = controller;
          options.signal.addEventListener(
            "abort",
            () => controller.error(options.signal.reason),
            { once: true },
          );
        },
      });
      return Promise.resolve({
        status: 200,
        headers: new Headers({ "content-type": "text/event-stream" }),
        body,
      });
    })
    .mockResolvedValue({
      status: 200,
      text: async () =>
        JSON.stringify({ choices: [{ message: { content: "fallback" } }] }),
    });
  vi.stubGlobal("fetch", fetcher);
  try {
    const answer = chat(
      [{ role: "user", content: "Generate a long answer" }],
      undefined,
      { ...defaults, apiKey: "test" },
      { timeoutMs: 4000 },
    );
    await vi.advanceTimersByTimeAsync(0);
    writer.enqueue(new TextEncoder().encode(delta("first")));
    await vi.advanceTimersByTimeAsync(1500);
    writer.enqueue(new TextEncoder().encode(delta("second")));
    await vi.advanceTimersByTimeAsync(1500);
    writer.enqueue(new TextEncoder().encode(stop));
    writer.close();
    expect(await answer).toBe("firstsecond");
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
