import * as ai from "./ai";
import * as transport from "./aiTransport";
import { classroomCommands } from "./commands";
import { defaults, saveSettings } from "./settings";
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
