import { Capacitor } from "@capacitor/core";

import { chat } from "./ai";
import {
  AIStream,
  postAI,
  readAISearchEvidence,
  readAICompletion,
} from "./aiTransport";
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
  it("coalesces interleaved function arguments by index and preserves encrypted reasoning", () => {
    const stream = new AIStream(false, vi.fn());
    const packet = (delta: unknown) => frame({ choices: [{ delta }] });
    stream.push(
      packet({ reasoning_content: "first", encrypted_content: "encrypted-" }),
    );
    stream.push(
      packet({
        tool_calls: [
          {
            index: 1,
            id: "call_b",
            type: "function",
            function: {
              name: "execute_whiteboard",
              arguments: '{"name":"canvas.tool",',
            },
          },
          {
            index: 0,
            id: "call_a",
            type: "function",
            function: {
              name: "execute_whiteboard",
              arguments: '{"name":"canvas.text",',
            },
          },
        ],
      }),
    );
    stream.push(
      packet({
        reasoning_content: " second",
        encrypted_content: "context",
        tool_calls: [
          { index: 0, function: { arguments: '"args":{"text":"牛顿定律"}}' } },
          { index: 1, function: { arguments: '"args":{"tool":"eraser"}}' } },
        ],
      }),
    );
    stream.push(
      `${frame({
        choices: [{ delta: {}, finish_reason: "tool_calls" }],
      })}data: [DONE]\n\n`,
    );
    const completion = stream.finishCompletion();
    expect(completion.text).toBe("");
    expect(completion.toolCalls.map((call) => call.id)).toEqual([
      "call_a",
      "call_b",
    ]);
    expect(JSON.parse(completion.toolCalls[0].function.arguments)).toEqual({
      name: "canvas.text",
      args: { text: "牛顿定律" },
    });
    expect(completion.assistant).toMatchObject({
      reasoning_content: "first second",
      encrypted_content: "encrypted-context",
    });
  });
  it("refuses malformed, duplicate, truncated and non-object function calls before execution", () => {
    const call = {
      id: "call_one",
      type: "function",
      function: {
        name: "execute_whiteboard",
        arguments: '{"name":"canvas.text"}',
      },
    };
    const completion = (calls: unknown[]) =>
      readAICompletion(
        JSON.stringify({
          choices: [{ message: { content: null, tool_calls: calls } }],
        }),
        false,
      );
    expect(completion([call]).toolCalls).toHaveLength(1);
    expect(() => completion([call, call])).toThrow();
    expect(() =>
      completion([
        { ...call, function: { ...call.function, arguments: "[]" } },
      ]),
    ).toThrow();
    expect(() =>
      completion([
        { ...call, function: { ...call.function, arguments: '{"name":' } },
      ]),
    ).toThrow();
    const interrupted = new AIStream(false, vi.fn());
    interrupted.push(
      frame({ choices: [{ delta: { tool_calls: [{ ...call, index: 0 }] } }] }),
    );
    expect(() => interrupted.finishCompletion()).toThrow();
  });
  it("reads actual search counts and citations from both provider response formats", () => {
    const source = { title: "课程标准", url: "https://example.com/curriculum" };
    expect(
      readAISearchEvidence(
        JSON.stringify({
          usage: { tool_usage: { web_search: 1 } },
          choices: [
            {
              message: {
                annotations: [{ type: "url_citation", url_citation: source }],
              },
            },
          ],
        }),
      ),
    ).toEqual({ count: 1, sources: [source] });
    expect(
      readAISearchEvidence(
        JSON.stringify({
          output: [
            { type: "web_search_call", status: "completed" },
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  annotations: [{ type: "url_citation", ...source }],
                },
              ],
            },
          ],
        }),
      ),
    ).toEqual({ count: 1, sources: [source] });
    expect(
      readAISearchEvidence(
        JSON.stringify({
          choices: [
            { message: { content: JSON.stringify({ sources: [source] }) } },
          ],
        }),
      ),
    ).toEqual({ count: 0, sources: [] });
  });
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
  it("reuses opaque cache routes for stable rules, isolated by endpoint, model and key", async () => {
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
      thinking: { type: "disabled" },
    });
    expect(bodies[0].prompt_cache_key).toBe(bodies[1].prompt_cache_key);
    for (const key of [
      "service_tier",
      "thinking",
      "reasoning",
      "prompt_cache_key",
      "temperature",
    ]) {
      expect(bodies[2]).not.toHaveProperty(key);
    }
    expect(bodies[0].prompt_cache_key).not.toContain("test-secret");
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
