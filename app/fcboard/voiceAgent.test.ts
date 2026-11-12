import * as ai from "./ai";
import * as transport from "./aiTransport";
import { classroomCommands } from "./commands";
import { defaults, saveSettings } from "./settings";
import { registerBoardAgents } from "./boardAgents";
import { runVoiceAgent } from "./voiceAgent";

beforeEach(() =>
  saveSettings(
    {
      ...defaults,
      apiKey: "configured",
      endpoint: "https://example.com/v1/chat/completions",
    },
    false,
  ),
);
afterEach(() => vi.restoreAllMocks());

it.each(["讲解一下概念", "Can you clarify this?", "换一种方式说说"])(
  "lets the model answer %s without any board task",
  async (text) => {
    vi.spyOn(ai, "chat").mockResolvedValue(
      JSON.stringify({ action: "text", text: "直接解释" }),
    );
    const task = vi.fn();
    const release = classroomCommands.register("agent.start", "Start", task);
    try {
      expect(await runVoiceAgent(text, [], new AbortController().signal)).toBe(
        "直接解释",
      );
      expect(task).not.toHaveBeenCalled();
    } finally {
      release();
    }
  },
);

it("discovers a new real public command without adding a keyword route or role whitelist", async () => {
  const change = vi.fn().mockReturnValue({ mode: "orbit" });
  const release = classroomCommands.register(
    "experiment.change",
    "Set args.mode on the actual experiment",
    change,
  );
  const model = vi
    .spyOn(ai, "chat")
    .mockResolvedValueOnce(
      JSON.stringify({
        action: "commands",
        commands: [{ name: "experiment.change", args: { mode: "orbit" } }],
      }),
    )
    .mockResolvedValueOnce(JSON.stringify({ action: "done" }));
  try {
    expect(
      await runVoiceAgent(
        "换到这个实验的下一种状态",
        [],
        new AbortController().signal,
      ),
    ).toBeUndefined();
    expect(model.mock.calls[0][0][0].content).toContain("experiment.change");
    expect(change).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "orbit" }),
    );
  } finally {
    release();
  }
});

it("accepts a natural Ark Responses answer without forcing a fake board mutation", async () => {
  saveSettings(
    {
      ...defaults,
      apiKey: "configured",
      endpoint: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    },
    false,
  );
  vi.spyOn(transport, "postAI").mockResolvedValue({
    status: 200,
    stream: false,
    data: JSON.stringify({
      id: "natural",
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "自然回答" }],
        },
      ],
    }),
  });
  expect(
    await runVoiceAgent("为什么会这样", [], new AbortController().signal),
  ).toBe("自然回答");
});

it.each([
  ["chat", "resources.generate"],
  ["responses", "resources.generate"],
  ["chat", "research.search"],
  ["responses", "research.search"],
])(
  "keeps %s conversation available while %s runs or fails",
  async (provider, commandName) => {
    saveSettings(
      {
        ...defaults,
        apiKey: "configured",
        endpoint:
          provider === "responses"
            ? "https://ark.cn-beijing.volces.com/api/v3/chat/completions"
            : "https://example.com/v1/chat/completions",
      },
      false,
    );
    const agents = registerBoardAgents();
    let reject!: (error: Error) => void;
    const release = classroomCommands.register(
      commandName,
      "Execute the requested model/provider work",
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    );
    const command = {
      name: commandName,
      args: { prompt: "按当前目标生成实验" },
    };
    if (provider === "chat") {
      vi.spyOn(ai, "chat")
        .mockResolvedValueOnce(
          JSON.stringify({ action: "commands", commands: [command] }),
        )
        .mockResolvedValueOnce(
          JSON.stringify({ action: "text", text: "先解释当前概念" }),
        )
        .mockResolvedValueOnce(
          JSON.stringify({ action: "text", text: "继续回答" }),
        );
    } else {
      const response = (id: string, output: unknown[]) => ({
        status: 200,
        stream: false,
        data: JSON.stringify({ id, status: "completed", output }),
      });
      const text = (value: string) => [
        { type: "message", content: [{ type: "output_text", text: value }] },
      ];
      vi.spyOn(transport, "postAI")
        .mockResolvedValueOnce(
          response("planned", [
            {
              type: "function_call",
              name: "board_command",
              call_id: "generate",
              arguments: JSON.stringify(command),
            },
          ]),
        )
        .mockResolvedValueOnce(response("speaking", text("先解释当前概念")))
        .mockResolvedValueOnce(response("continue", text("继续回答")));
    }
    try {
      expect(
        await runVoiceAgent("请结合板书演示", [], new AbortController().signal),
      ).toBe("先解释当前概念");
      expect(
        (classroomCommands.read("agents") as { state: string }[])[0].state,
      ).toBe("running");
      expect(reject).toBeDefined();
      reject(new Error("generation unavailable"));
      await vi.waitFor(() =>
        expect(
          (classroomCommands.read("agents") as { state: string }[])[0].state,
        ).toBe("failed"),
      );
      expect(
        await runVoiceAgent("继续解释", [], new AbortController().signal),
      ).toBe("继续回答");
      expect(classroomCommands.has("lesson.ask")).toBe(false);
    } finally {
      release();
      agents();
    }
  },
);

it.each(["chat", "responses"])(
  "preserves independent %s work when a spoken reply is interrupted, cancelling it only with its session owner",
  async (provider) => {
    saveSettings(
      {
        ...defaults,
        apiKey: "configured",
        endpoint:
          provider === "responses"
            ? defaults.endpoint
            : "https://example.com/v1/chat/completions",
      },
      false,
    );
    const agents = registerBoardAgents();
    const turn = new AbortController();
    const session = new AbortController();
    let taskSignal!: AbortSignal;
    const release = classroomCommands.register(
      "experiment.generate",
      "Generate a real experiment",
      (args) => {
        taskSignal = args.signal as AbortSignal;
        return new Promise<void>(() => {});
      },
    );
    const command = { name: "experiment.generate", args: {} };
    let reply!: () => void;
    if (provider === "chat") {
      vi.spyOn(ai, "chat")
        .mockResolvedValueOnce(
          JSON.stringify({ action: "commands", commands: [command] }),
        )
        .mockImplementationOnce(
          () =>
            new Promise<string>((resolve) => {
              reply = () =>
                resolve(JSON.stringify({ action: "text", text: "继续对话" }));
            }),
        );
    } else {
      vi.spyOn(transport, "postAI")
        .mockResolvedValueOnce({
          status: 200,
          stream: false,
          data: JSON.stringify({
            id: "start",
            status: "completed",
            output: [
              {
                type: "function_call",
                name: "board_command",
                call_id: "generate",
                arguments: JSON.stringify(command),
              },
            ],
          }),
        })
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              reply = () =>
                resolve({
                  status: 200,
                  stream: false,
                  data: JSON.stringify({
                    id: "reply",
                    status: "completed",
                    output: [],
                  }),
                });
            }),
        );
    }
    try {
      const pending = runVoiceAgent(
        "结合白板演示",
        [],
        turn.signal,
        session.signal,
      );
      const result = pending.catch((failure) => failure);
      await vi.waitFor(() => expect(reply).toBeDefined());
      turn.abort();
      reply();
      expect(await result).toMatchObject({ name: "AbortError" });
      expect(taskSignal.aborted).toBe(false);
      expect(
        (classroomCommands.read("agents") as { state: string }[])[0].state,
      ).toBe("running");
      session.abort();
      await vi.waitFor(() =>
        expect(
          (classroomCommands.read("agents") as { state: string }[])[0].state,
        ).toBe("cancelled"),
      );
      expect(taskSignal.aborted).toBe(true);
    } finally {
      reply?.();
      session.abort();
      release();
      agents();
    }
  },
);
