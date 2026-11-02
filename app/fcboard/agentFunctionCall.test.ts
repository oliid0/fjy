import { createServer } from "node:http";
import { transferableAbortController } from "node:util";

import { Capacitor } from "@capacitor/core";

import { requestBoardAgent, runBoardCommands } from "./agent";
import { registerCanvasCommands } from "./canvasCommands";
import { classroomCommands } from "./commands";
import { defaults } from "./settings";
import { sceneAPI } from "./test/scene";
import * as ai from "./ai";

import type { AddressInfo } from "node:net";
import type { Command } from "./commands";

const toolCompletion = (calls: { id: string; command: Command }[]) => ({
  text: "",
  toolCalls: calls.map(({ id, command }) => ({
    id,
    type: "function" as const,
    function: {
      name: "execute_whiteboard",
      arguments: JSON.stringify(command),
    },
  })),
});

it("does not execute a duplicate provider call ID twice and reports every skipped call after a failure", async () => {
  const write = vi.fn(() => ({ id: "actual-title" }));
  const fail = vi.fn(() => {
    throw new Error("actual tool unavailable");
  });
  const skipped = vi.fn();
  const stops = [
    classroomCommands.register("test.write", "write", write),
    classroomCommands.register("test.fail", "fail", fail),
    classroomCommands.register("test.skip", "skip", skipped),
  ];
  const batch = toolCompletion([
    { id: "call_write", command: { name: "test.write", args: {} } },
    { id: "call_fail", command: { name: "test.fail", args: {} } },
    { id: "call_skip", command: { name: "test.skip", args: {} } },
  ]);
  const provider = vi.spyOn(ai, "chat");
  const respond = async (
    _messages: ai.Message[],
    _signal?: AbortSignal,
    _settings?: unknown,
    options?: Parameters<typeof ai.chat>[3],
  ) => {
    options?.onCompletion?.({
      ...batch,
      assistant: {
        role: "assistant",
        content: null,
        tool_calls: batch.toolCalls,
      },
    });
    return "";
  };
  provider
    .mockImplementationOnce(respond)
    .mockImplementationOnce(async (...args) => {
      const outputs = args[0].filter((message) => message.role === "tool");
      expect(outputs.map((message) => message.tool_call_id)).toEqual([
        "call_write",
        "call_fail",
        "call_skip",
      ]);
      expect(outputs[1].content).toContain("actual tool unavailable");
      expect(outputs[2].content).toContain("尚未执行");
      return respond(...args);
    })
    .mockResolvedValueOnce('{"action":"done"}');
  try {
    const action = await requestBoardAgent([]);
    await expect(
      runBoardCommands(action, [], undefined, () => true),
    ).rejects.toThrow("actual tool unavailable");
    expect(write).toHaveBeenCalledTimes(1);
    expect(fail).toHaveBeenCalledTimes(1);
    expect(skipped).not.toHaveBeenCalled();
    // A repeated failed call remains a failed prerequisite. The rest of that
    // batch must stay unexecuted until the model actually repairs the failure.
    expect(provider).toHaveBeenCalledTimes(3);
  } finally {
    stops.forEach((stop) => stop());
  }
});

it("retries explicit function capability rejection once and remembers ordinary JSON compatibility for that model", async () => {
  const stop = classroomCommands.register(
    "test.compatible",
    "available",
    vi.fn(),
  );
  const provider = vi
    .spyOn(ai, "chat")
    .mockRejectedValueOnce(new Error("Unsupported parameter: tools"))
    .mockResolvedValue('{"action":"done"}');
  const settings = {
    ...defaults,
    model: "no-function-support",
    apiKey: "compatibility-test-only",
  };
  try {
    await expect(
      requestBoardAgent([], undefined, { settings }),
    ).resolves.toEqual({ action: "done" });
    await expect(
      requestBoardAgent([], undefined, { settings }),
    ).resolves.toEqual({ action: "done" });
    expect(provider).toHaveBeenCalledTimes(3);
    expect(provider.mock.calls[0][3]?.functionTools).toHaveLength(1);
    expect(provider.mock.calls[1][3]?.functionTools).toBeUndefined();
    expect(provider.mock.calls[2][3]?.functionTools).toBeUndefined();
  } finally {
    stop();
  }
});

it("returns a function acknowledgement as conversational feedback instead of another board insertion", async () => {
  const write = vi.fn(() => ({ written: true }));
  const stop = classroomCommands.register("test.write", "write", write);
  const batch = toolCompletion([
    { id: "call_ack", command: { name: "test.write", args: {} } },
  ]);
  vi.spyOn(ai, "chat")
    .mockImplementationOnce(async (_messages, _signal, _settings, options) => {
      options?.onCompletion?.({
        ...batch,
        assistant: {
          role: "assistant",
          content: null,
          tool_calls: batch.toolCalls,
        },
      });
      return "";
    })
    .mockResolvedValueOnce("标题已写好，可以继续。");
  try {
    const action = await requestBoardAgent([]);
    expect(await runBoardCommands(action, [], undefined, () => true)).toEqual({
      action: "reply",
      text: "标题已写好，可以继续。",
    });
    expect(write).toHaveBeenCalledTimes(1);
  } finally {
    stop();
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([false, true])(
  "executes real canvas tools and returns each actual call result over HTTP (Responses=%s)",
  async (responses) => {
    vi.stubGlobal("AbortController", transferableAbortController().constructor);
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
    const api = sceneAPI();
    const original = api.getSceneElements()[0].id;
    const unregister = registerCanvasCommands(api);
    const requests: Record<string, any>[] = [];
    const seen = vi.spyOn(classroomCommands, "execute");
    const calls = (commands: Command[]) =>
      commands.map((command, index) => ({
        id: `call_${requests.length}_${index}`,
        type: "function",
        function: {
          name: "execute_whiteboard",
          arguments: JSON.stringify(command),
        },
      }));
    let firstOutput: unknown[];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      requests.push(body);
      const tools =
        requests.length === 1
          ? calls([
              { name: "canvas.tool", args: { tool: "freedraw" } },
              {
                name: "canvas.text",
                args: { text: "电流与电阻", presentation: "text" },
              },
            ])
          : requests.length === 2
          ? calls([
              { name: "canvas.select", args: { ids: [original] } },
              { name: "canvas.tool", args: { tool: "eraser" } },
              { name: "canvas.erase", args: { ids: [original] } },
            ])
          : [];
      const output = tools.length
        ? [
            {
              type: "reasoning",
              id: `rs_${requests.length}`,
              summary: [],
              encrypted_content: "retain-this-encrypted-context",
            },
            ...tools.map((call) => ({
              type: "function_call",
              id: `fc_${call.id}`,
              call_id: call.id,
              name: call.function.name,
              arguments: call.function.arguments,
              status: "completed",
            })),
          ]
        : [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: '{"action":"done"}' }],
            },
          ];
      if (requests.length === 1) {
        firstOutput = output;
      }
      const message = {
        role: "assistant",
        content: tools.length ? "" : '{"action":"done"}',
        ...(tools.length
          ? {
              reasoning_content: "inspect and execute",
              encrypted_content: "retain-this-encrypted-context",
              tool_calls: tools,
            }
          : {}),
      };
      const frames = responses
        ? [
            {
              type: "response.completed",
              response: { status: "completed", output },
            },
          ]
        : [
            {
              choices: [
                {
                  delta: {
                    ...message,
                    tool_calls: tools.map((call, index) => ({
                      ...call,
                      index,
                    })),
                  },
                },
              ],
            },
            {
              choices: [
                {
                  delta: {},
                  finish_reason: tools.length ? "tool_calls" : "stop",
                },
              ],
            },
          ];
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end(
        frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") +
          (responses ? "" : "data: [DONE]\n\n"),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const settings = {
        ...defaults,
        apiKey: "function-contract-only",
        model: "chosen-tool-model",
        endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}/${
          responses ? "responses" : "chat/completions"
        }`,
      };
      const messages = [
        { role: "user" as const, content: "写标题，再选中并擦除原来的题目" },
      ];
      const action = await requestBoardAgent(messages, undefined, { settings });
      expect(api.getSceneElements()).toHaveLength(1);
      expect(
        await runBoardCommands(action, messages, undefined, () => true, {
          settings,
          verify: true,
        }),
      ).toEqual({ action: "done" });
      expect(api.getSceneElements()).toHaveLength(1);
      expect(api.getSceneElements()[0]).toMatchObject({
        type: "text",
        text: "电流与电阻",
      });
      expect(api.getSceneElements()[0].id).not.toBe(original);
      expect(api.getAppState().activeTool.type).toBe("eraser");
      expect(seen.mock.calls.map(([command]) => command.name)).toEqual([
        "canvas.tool",
        "canvas.text",
        "canvas.select",
        "canvas.tool",
        "canvas.erase",
      ]);
      expect(requests).toHaveLength(3);
      for (const request of requests) {
        expect(request).not.toHaveProperty("service_tier");
        const tool = responses ? request.tools[0] : request.tools[0].function;
        expect(tool.name).toBe("execute_whiteboard");
        expect(tool.parameters.properties.name.enum).toContain("canvas.erase");
        expect(tool.parameters.properties.name.enum).not.toContain("ui.invoke");
      }
      const replies = responses
        ? requests[2].input.filter(
            (item: { type: string }) => item.type === "function_call_output",
          )
        : requests[2].messages.filter(
            (item: { role: string }) => item.role === "tool",
          );
      expect(
        replies.map(
          (item: Record<string, string>) => item.call_id || item.tool_call_id,
        ),
      ).toEqual(["call_1_0", "call_1_1", "call_2_0", "call_2_1", "call_2_2"]);
      expect(
        JSON.parse(responses ? replies[4].output : replies[4].content),
      ).toEqual({
        name: "canvas.erase",
        ok: true,
        result: { ids: [original] },
      });
      if (responses) {
        expect(requests[1].input.slice(1, firstOutput!.length + 1)).toEqual(
          firstOutput!,
        );
      } else {
        expect(requests[1].messages[1]).toMatchObject({
          reasoning_content: "inspect and execute",
          encrypted_content: "retain-this-encrypted-context",
          tool_calls: expect.any(Array),
        });
      }
    } finally {
      unregister();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);
