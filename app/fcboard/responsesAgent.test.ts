import * as transport from "./aiTransport";
import { registerCanvasCommands } from "./canvasCommands";
import { classroomCommands } from "./commands";
import { agentResponsesEndpoint, runResponsesAgent } from "./responsesAgent";
import { defaults } from "./settings";
import { sceneAPI } from "./test/scene";

const call = (
  id: string,
  name = "board_draw",
  args: unknown = {
    strokes: [
      [
        [400, 300],
        [430, 280],
        [460, 300],
      ],
    ],
  },
) => ({
  type: "function_call",
  name,
  call_id: id,
  arguments: JSON.stringify(args),
});
const done = {
  type: "message",
  content: [{ type: "output_text", text: "已完成真实板书。" }],
};
const response = (id: string, output: unknown[]) => ({
  status: 200,
  stream: false,
  data: JSON.stringify({ id, status: "completed", output }),
});
const options = (signal = new AbortController().signal) => ({
  endpoint: "https://ark.cn-beijing.volces.com/api/v3/responses",
  messages: [{ role: "user" as const, content: "用笔画出来并完成任务" }],
  settings: { ...defaults, apiKey: "test-key", model: "configured-model" },
  signal,
  current: () => !signal.aborted,
  allowed: (name: string) => name.startsWith("canvas."),
});
afterEach(() => vi.restoreAllMocks());

it("continues native function calls using real call_id results and never replays an already committed call", async () => {
  const api = sceneAPI();
  const stop = registerCanvasCommands(api);
  const post = vi
    .spyOn(transport, "postAI")
    .mockResolvedValueOnce(response("response-1", [call("draw-1")]))
    .mockResolvedValueOnce(
      response("response-2", [
        call("draw-1"),
        call("draw-2"),
        call("draw-3", "board_draw", {
          strokes: [
            [
              [500, 300],
              [530, 280],
              [560, 300],
            ],
          ],
        }),
      ]),
    )
    .mockResolvedValueOnce(response("response-3", [done]));
  try {
    const result = await runResponsesAgent(options());
    expect(result.summary).toContain("真实板书");
    expect(
      api.getSceneElements().filter((element) => element.type === "freedraw"),
    ).toHaveLength(2);
    const continuation = post.mock.calls[1][2];
    expect(continuation).toMatchObject({
      previous_response_id: "response-1",
      store: true,
    });
    expect(continuation.input).toEqual([
      expect.objectContaining({
        type: "function_call_output",
        call_id: "draw-1",
      }),
    ]);
    expect(
      JSON.parse((continuation.input as { output: string }[])[0].output),
    ).toMatchObject({ ok: true });
    expect(post.mock.calls[2][2]).toMatchObject({
      previous_response_id: "response-2",
    });
    expect(post.mock.calls[0][2]).toMatchObject({
      model: "configured-model",
      stream: true,
    });
    expect(
      (post.mock.calls[0][2].tools as { strict: boolean }[]).every(
        (tool) => tool.strict === false,
      ),
    ).toBe(true);
  } finally {
    stop();
  }
});

it("returns actual tool errors to the model and keeps running until the corrected operation succeeds", async () => {
  const api = sceneAPI();
  const stop = registerCanvasCommands(api);
  const post = vi
    .spyOn(transport, "postAI")
    .mockResolvedValueOnce(
      response("failed-operation", [
        call("bad", "board_command", {
          name: "canvas.ink",
          args: { strokes: [] },
        }),
      ]),
    )
    .mockImplementationOnce(async (_url, _key, body) => {
      expect(
        JSON.parse((body.input as { output: string }[])[0].output),
      ).toMatchObject({ ok: false });
      return response("corrected", [
        call("correct", "board_command", {
          name: "canvas.ink",
          args: {
            strokes: [
              [
                [10, 20],
                [30, 40],
              ],
            ],
          },
        }),
      ]);
    })
    .mockResolvedValueOnce(response("complete", [done]));
  try {
    await runResponsesAgent(options());
    expect(post).toHaveBeenCalledTimes(3);
    expect(
      api.getSceneElements().filter((element) => element.type === "freedraw"),
    ).toHaveLength(1);
  } finally {
    stop();
  }
});

it("waits for a completed streaming response before executing split function arguments", async () => {
  const write = vi.fn(() => ({ inserted: true }));
  const stop = classroomCommands.register(
    "canvas.ink",
    "Write real ink",
    write,
  );
  let first = true;
  vi.spyOn(transport, "postAI").mockImplementation(
    async (_url, _key, _body, _signal, chunk) => {
      if (!first) {
        return response("final", [done]);
      }
      first = false;
      const data = `data: ${JSON.stringify({
        type: "response.output_item.done",
        output_index: 0,
        item: call("streamed"),
      })}\r\n\r\n`;
      for (const part of [data.slice(0, 29), data.slice(29)]) {
        chunk(part);
      }
      expect(write).not.toHaveBeenCalled();
      chunk(
        `data: ${JSON.stringify({
          type: "response.completed",
          response: { id: "stream-result", status: "completed" },
        })}\n\ndata: [DONE]\n\n`,
      );
      return { status: 200, stream: true, data: "" };
    },
  );
  try {
    await runResponsesAgent(options());
    expect(write).toHaveBeenCalledTimes(1);
  } finally {
    stop();
  }
});

it("keeps a failed move unresolved when a different board_command mutation succeeds", async () => {
  const api = sceneAPI();
  const stop = registerCanvasCommands(api);
  const post = vi
    .spyOn(transport, "postAI")
    .mockResolvedValueOnce(
      response("bad-move", [
        call("move", "board_command", {
          name: "canvas.move",
          args: { ids: ["missing"], dx: 10, dy: 0 },
        }),
      ]),
    )
    .mockResolvedValueOnce(
      response("other-action", [
        call("draw", "board_command", {
          name: "canvas.ink",
          args: {
            strokes: [
              [
                [10, 20],
                [30, 40],
              ],
            ],
          },
        }),
      ]),
    )
    .mockResolvedValue(response("unverified", [done]));
  try {
    await expect(runResponsesAgent(options())).rejects.toThrow();
    expect(post).toHaveBeenCalledTimes(4);
    expect(
      api.getSceneElements().filter((element) => element.type === "freedraw"),
    ).toHaveLength(1);
  } finally {
    stop();
  }
});

it("can repeat real inspections but cannot complete a writing task with reads alone", async () => {
  const read = vi.fn(() => ({ answer: "2" }));
  const stop = classroomCommands.register(
    "math.evaluate",
    "Compute without changing the board",
    read,
  );
  const post = vi
    .spyOn(transport, "postAI")
    .mockResolvedValueOnce(
      response("read-one", [
        call("read-one", "board_command", {
          name: "math.evaluate",
          args: { expression: "1+1" },
        }),
      ]),
    )
    .mockResolvedValueOnce(
      response("read-two", [
        call("read-two", "board_command", {
          name: "math.evaluate",
          args: { expression: "1+1" },
        }),
      ]),
    )
    .mockResolvedValue(response("no-work", [done]));
  try {
    await expect(
      runResponsesAgent({ ...options(), allowed: () => true }),
    ).rejects.toThrow();
    expect(read).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenCalledTimes(4);
  } finally {
    stop();
  }
});

it("honors a cancelled real control without claiming success or opening it again", async () => {
  const open = vi.fn(() => ({ cancelled: true }));
  const stop = classroomCommands.register(
    "board.open",
    "Choose a board file",
    open,
  );
  const post = vi
    .spyOn(transport, "postAI")
    .mockResolvedValueOnce(
      response("picker", [
        call("open", "board_command", { name: "board.open" }),
      ]),
    )
    .mockResolvedValue(response("wrong-completion", [done]));
  try {
    await expect(
      runResponsesAgent({ ...options(), allowed: () => true }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(open).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
  } finally {
    stop();
  }
});

it("does not commit a truncated stream or report textual plans as completed work", async () => {
  const write = vi.fn();
  const stop = classroomCommands.register("canvas.ink", "Write", write);
  const post = vi
    .spyOn(transport, "postAI")
    .mockImplementationOnce(async (_url, _key, _body, _signal, chunk) => {
      chunk(
        `data: ${JSON.stringify({
          type: "response.output_item.done",
          output_index: 0,
          item: call("incomplete"),
        })}\n\n`,
      );
      return { status: 200, stream: true, data: "" };
    });
  try {
    await expect(runResponsesAgent(options())).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
    post.mockResolvedValue(response("empty", [done]));
    await expect(runResponsesAgent(options())).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});

it("sends a new observed courseware image to the next turn and rejects internal commands through the public tool", async () => {
  const snapshot = classroomCommands.register(
    "canvas.snapshot",
    "@internal",
    () => ({
      name: "力学.pptx",
      page: 2,
      image: "data:image/png;base64,current-page",
      text: "F=ma",
    }),
  );
  const write = classroomCommands.register("canvas.ink", "Write", () => ({
    inserted: true,
  }));
  const post = vi
    .spyOn(transport, "postAI")
    .mockResolvedValueOnce(
      response("observe", [call("look", "observe_visible_board", {})]),
    )
    .mockResolvedValueOnce(response("write", [call("draw")]))
    .mockResolvedValueOnce(response("finish", [done]));
  try {
    await runResponsesAgent(options());
    expect(post.mock.calls[1][2].input).toEqual([
      expect.objectContaining({
        type: "function_call_output",
        call_id: "look",
      }),
      {
        role: "user",
        content: [
          expect.anything(),
          {
            type: "input_image",
            image_url: "data:image/png;base64,current-page",
          },
        ],
      },
    ]);
    const tool = (
      post.mock.calls[0][2].tools as {
        name: string;
        parameters: { properties: { name?: { enum: string[] } } };
      }[]
    ).find((item) => item.name === "board_command");
    expect(tool?.parameters.properties.name?.enum).not.toContain(
      "canvas.snapshot",
    );
  } finally {
    snapshot();
    write();
  }
});

it("upgrades documented endpoints while preserving an unknown Chat-only provider", () => {
  expect(agentResponsesEndpoint(defaults.endpoint)).toBe(
    "https://ark.cn-beijing.volces.com/api/v3/responses",
  );
  expect(
    agentResponsesEndpoint("https://api.openai.com/v1/chat/completions"),
  ).toBe("https://api.openai.com/v1/responses");
  expect(
    agentResponsesEndpoint("https://example.com/v1/chat/completions"),
  ).toBeUndefined();
  expect(agentResponsesEndpoint("https://example.com/v1/responses/")).toBe(
    "https://example.com/v1/responses",
  );
});

it("refreshes newly registered component tools after opening their interface", async () => {
  let release = () => {};
  let edited = false;
  const stop = classroomCommands.register("canvas.open", "Open editor", () => {
    release = classroomCommands.register(
      "canvas.edit",
      "Edit current content; args.value is required",
      (args) => {
        edited = args.value === "real value";
        return { edited };
      },
    );
    return { opened: true };
  });
  const post = vi
    .spyOn(transport, "postAI")
    .mockResolvedValueOnce(
      response("open", [
        call("open", "board_command", { name: "canvas.open" }),
      ]),
    )
    .mockResolvedValueOnce(
      response("edit", [
        call("edit", "board_command", {
          name: "canvas.edit",
          args: { value: "real value" },
        }),
      ]),
    )
    .mockResolvedValueOnce(response("complete", [done]));
  try {
    await runResponsesAgent(options());
    expect(edited).toBe(true);
    const tool = (
      post.mock.calls[1][2].tools as {
        name: string;
        parameters: { properties: { name?: { enum: string[] } } };
      }[]
    ).find((item) => item.name === "board_command");
    expect(tool?.parameters.properties.name?.enum).toContain("canvas.edit");
    expect(JSON.stringify(post.mock.calls[1][2].input)).toContain(
      "args.value is required",
    );
  } finally {
    release();
    stop();
  }
});

it("keeps committed work and discards late calls after the task is cancelled", async () => {
  const api = sceneAPI();
  const stop = registerCanvasCommands(api);
  const controller = new AbortController();
  let finish!: (value: ReturnType<typeof response>) => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.spyOn(transport, "postAI")
    .mockResolvedValueOnce(response("written", [call("first")]))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
          entered();
        }),
    );
  try {
    const task = runResponsesAgent(options(controller.signal));
    await waiting;
    controller.abort();
    finish(response("late", [call("second")]));
    await expect(task).rejects.toMatchObject({ name: "AbortError" });
    expect(
      api.getSceneElements().filter((element) => element.type === "freedraw"),
    ).toHaveLength(1);
  } finally {
    stop();
  }
});
