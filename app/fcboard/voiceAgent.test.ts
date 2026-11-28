import { t } from "@fcboard/fcboard/i18n";

import * as ai from "./ai";
import * as transport from "./aiTransport";
import { classroomCommands } from "./commands";
import { defaults, saveSettings } from "./settings";
import { registerBoardAgents } from "./boardAgents";
import { runVoiceAgent } from "./voiceAgent";
import { registerCanvasCommands } from "./canvasCommands";
import { sceneAPI } from "./test/scene";

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
          type: "function_call",
          name: "voice_answer",
          call_id: "answer",
          arguments: JSON.stringify({ text: "自然回答" }),
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
        {
          type: "function_call",
          name: "voice_answer",
          call_id: "answer",
          arguments: JSON.stringify({ text: value }),
        },
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
      ).toBeUndefined();
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

it("sends the current courseware screenshot and text with the cloud utterance", async () => {
  saveSettings(
    {
      ...defaults,
      speech: "cloud",
      apiKey: "configured",
      ocrModel: "configured-vision",
    },
    false,
  );
  const visible = vi.fn().mockResolvedValue({
    name: "physics.pptx",
    page: 2,
    text: "F=ma",
    image: "data:image/jpeg;base64,current-window",
  });
  const release = classroomCommands.register(
    "canvas.snapshot",
    "@internal",
    visible,
  );
  const post = vi.spyOn(transport, "postAI").mockResolvedValue({
    status: 200,
    stream: false,
    data: JSON.stringify({
      id: "observed",
      status: "completed",
      output: [
        {
          type: "function_call",
          name: "voice_answer",
          call_id: "answer",
          arguments: JSON.stringify({ text: "力等于质量乘以加速度。" }),
        },
      ],
    }),
  });
  try {
    expect(
      await runVoiceAgent("解释这一页", [], new AbortController().signal),
    ).toBe("力等于质量乘以加速度。");
    expect(visible).toHaveBeenCalledWith(
      expect.objectContaining({
        screen: true,
        signal: expect.any(AbortSignal),
      }),
    );
    const request = post.mock.calls[0][2];
    expect(request.model).toBe("configured-vision");
    expect(JSON.stringify(request.input)).toContain(
      "data:image/jpeg;base64,current-window",
    );
    expect(JSON.stringify(request.input)).toContain("F=ma");
  } finally {
    release();
  }
});

it.each(["chat", "responses"])(
  "refreshes the visible screenshot after its own page change using %s",
  async (provider) => {
    saveSettings(
      {
        ...defaults,
        endpoint:
          provider === "responses"
            ? defaults.endpoint
            : "https://example.com/v1/chat/completions",
        apiKey: "configured",
        speech: "cloud",
      },
      false,
    );
    let page = 1;
    const capture = vi.fn(() => ({
      name: "lesson.pdf",
      page,
      text: page === 1 ? "旧页面" : "当前页面",
      image: `data:image/png;base64,page${page}`,
    }));
    const next = vi.fn((args: Record<string, unknown>) => {
      page++;
      classroomCommands.touch(args.signal as AbortSignal);
      return { page };
    });
    const release = [
      classroomCommands.register("canvas.snapshot", "@internal", capture),
      classroomCommands.register("document.next", "Next page", next),
      classroomCommands.context("document", () => ({ id: "lesson", page })),
    ];
    const command = { name: "document.next" };
    const state = (id: string, output: unknown[]) => ({
      status: 200,
      stream: false,
      data: JSON.stringify({ id, status: "completed", output }),
    });
    const chat = vi.spyOn(ai, "chat");
    const post = vi.spyOn(transport, "postAI");
    if (provider === "chat") {
      chat
        .mockResolvedValueOnce(
          JSON.stringify({ action: "commands", commands: [command] }),
        )
        .mockResolvedValueOnce(
          JSON.stringify({ action: "text", text: "第二页" }),
        );
    } else {
      post
        .mockResolvedValueOnce(
          state("turn1", [
            {
              type: "function_call",
              name: "board_command",
              call_id: "go",
              arguments: JSON.stringify(command),
            },
          ]),
        )
        .mockResolvedValueOnce(
          state("turn2", [
            {
              type: "function_call",
              name: "voice_answer",
              call_id: "answer",
              arguments: JSON.stringify({ text: "第二页" }),
            },
          ]),
        );
    }
    try {
      expect(
        await runVoiceAgent(
          "翻页并解释新页面",
          [],
          new AbortController().signal,
        ),
      ).toBe("第二页");
      const request =
        provider === "chat"
          ? chat.mock.calls[1][0].at(-1)
          : post.mock.calls[1][2].input;
      expect(JSON.stringify(request)).toContain("base64,page2");
      expect(JSON.stringify(request)).toContain("当前页面");
      expect(capture).toHaveBeenCalledTimes(2);
      expect(next).toHaveBeenCalledTimes(1);
    } finally {
      release.forEach((stop) => stop());
    }
  },
);

it("refreshes a same-page drawing once and keeps the new image for read-only tools", async () => {
  saveSettings(
    {
      ...defaults,
      endpoint: "https://example.com/v1/chat/completions",
      speech: "cloud",
      apiKey: "configured",
    },
    false,
  );
  let state = "empty";
  const capture = vi.fn(() => ({ image: `data:image/png;base64,${state}` }));
  const release = [
    classroomCommands.context("canvas", () => ({ state })),
    classroomCommands.register("canvas.snapshot", "@internal", capture),
    classroomCommands.register("canvas.ink", "Draw ink", () => {
      state = "triangle";
      return { ids: ["shape"] };
    }),
    classroomCommands.register("canvas.inspect", "Inspect board", () => ({
      state,
    })),
  ];
  const model = vi
    .spyOn(ai, "chat")
    .mockResolvedValueOnce(
      JSON.stringify({
        action: "commands",
        commands: [{ name: "canvas.ink" }],
      }),
    )
    .mockResolvedValueOnce(
      JSON.stringify({
        action: "commands",
        commands: [{ name: "canvas.inspect" }],
      }),
    )
    .mockResolvedValueOnce(JSON.stringify({ action: "text", text: "三角形" }));
  try {
    expect(
      await runVoiceAgent("画完再看一下", [], new AbortController().signal),
    ).toBe("三角形");
    expect(capture).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(model.mock.calls[2][0])).toContain("base64,triangle");
    expect(JSON.stringify(model.mock.calls[2][0].at(-1))).not.toContain(
      "base64,",
    );
  } finally {
    release.forEach((stop) => stop());
  }
});

it.each(["chat", "responses"])(
  "uses the real page boundary instead of the model's false completion in %s",
  async (provider) => {
    saveSettings(
      {
        ...defaults,
        apiKey: "configured",
        speech: "cloud",
        endpoint:
          provider === "responses"
            ? defaults.endpoint
            : "https://example.com/v1/chat/completions",
      },
      false,
    );
    const receipt = vi.fn(() => ({
      changed: false,
      boundary: "last",
      active: "final",
    }));
    const stop = classroomCommands.register(
      "board.step",
      "Turn the board page",
      receipt,
    );
    const command = { name: "board.step", args: { direction: "next" } };
    const summary = "已经翻到下一页";
    if (provider === "chat") {
      vi.spyOn(ai, "chat")
        .mockResolvedValueOnce(
          JSON.stringify({ action: "commands", commands: [command] }),
        )
        .mockResolvedValue(JSON.stringify({ action: "text", text: summary }));
    } else {
      const reply = (id: string, output: unknown[]) => ({
        status: 200,
        stream: false,
        data: JSON.stringify({ id, status: "completed", output }),
      });
      vi.spyOn(transport, "postAI")
        .mockResolvedValueOnce(
          reply("turn", [
            {
              type: "function_call",
              name: "board_command",
              call_id: "turn",
              arguments: JSON.stringify(command),
            },
          ]),
        )
        .mockResolvedValue(
          reply("final", [
            {
              type: "function_call",
              name: "voice_answer",
              call_id: "answer",
              arguments: JSON.stringify({ text: summary }),
            },
          ]),
        );
    }
    try {
      await expect(
        runVoiceAgent("请翻到后面的白板", [], new AbortController().signal),
      ).rejects.toThrow(t("fcboard.last_page_reached"));
      expect(receipt).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  },
);

it("drops cloud tool output if a manual switch occurs while the original image is in flight", async () => {
  saveSettings({ ...defaults, apiKey: "configured", speech: "cloud" }, false);
  let done!: () => void;
  const release = classroomCommands.register(
    "canvas.snapshot",
    "@internal",
    () =>
      new Promise((resolve) => {
        done = () => resolve({ image: "data:image/png;base64,old" });
      }),
  );
  const post = vi.spyOn(transport, "postAI");
  try {
    const task = runVoiceAgent("解释这页", [], new AbortController().signal);
    const rejected = expect(task).rejects.toMatchObject({ name: "AbortError" });
    classroomCommands.invalidate();
    done();
    await rejected;
    expect(post).not.toHaveBeenCalled();
  } finally {
    release();
  }
});

it("does not accept a cloud success message without a real call and continues to draw editable ink", async () => {
  saveSettings({ ...defaults, apiKey: "configured", speech: "cloud" }, false);
  const api = sceneAPI();
  const original = api.getSceneElements();
  const release = registerCanvasCommands(api);
  const response = (id: string, output: unknown[]) => ({
    status: 200,
    stream: false,
    data: JSON.stringify({ id, status: "completed", output }),
  });
  const post = vi
    .spyOn(transport, "postAI")
    .mockResolvedValueOnce(
      response("empty-success", [
        {
          type: "message",
          content: [{ type: "output_text", text: "已经画好了" }],
        },
      ]),
    )
    .mockResolvedValueOnce(
      response("draw", [
        {
          type: "function_call",
          name: "board_draw",
          call_id: "triangle",
          arguments: JSON.stringify({
            strokes: [
              [
                [400, 300],
                [430, 250],
                [460, 300],
                [400, 300],
              ],
            ],
          }),
        },
      ]),
    )
    .mockResolvedValueOnce(
      response("done", [
        {
          type: "message",
          content: [{ type: "output_text", text: "三角形已写入白板" }],
        },
      ]),
    );
  try {
    expect(
      await runVoiceAgent("在空白处画三角形", [], new AbortController().signal),
    ).toBe("三角形已写入白板");
    expect(post.mock.calls[0][2].tool_choice).toBe("required");
    expect(api.getSceneElements()).toHaveLength(original.length + 1);
    expect(api.getSceneElements().slice(0, original.length)).toEqual(original);
    expect(api.getSceneElements().at(-1)).toMatchObject({
      type: "freedraw",
      x: 400,
      y: 300,
    });
    expect(post).toHaveBeenCalledTimes(3);
  } finally {
    release();
  }
});

it("writes a cloud voice title as editable handwriting directly without a model request", async () => {
  saveSettings({ ...defaults, apiKey: "configured", speech: "cloud" }, false);
  const api = sceneAPI();
  const originalIds = new Set(
    api.getSceneElements().map((element) => element.id),
  );
  const release = registerCanvasCommands(api);
  const post = vi.spyOn(transport, "postAI");
  const model = vi.spyOn(ai, "chat");
  try {
    expect(
      await runVoiceAgent("手写标题 Energy", [], new AbortController().signal),
    ).toBe(t("fcboard.assistant_completed"));
    expect(api.getSceneElements().length).toBeGreaterThan(0);
    expect(
      api
        .getSceneElements()
        .filter((element) => !originalIds.has(element.id))
        .every((element) => element.type === "freedraw"),
    ).toBe(true);
    expect(post).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
  } finally {
    release();
  }
});

it("opens cloud recording controls without acquiring the microphone", async () => {
  saveSettings({ ...defaults, speech: "cloud" }, false);
  const open = vi.fn();
  const start = vi.fn();
  const release = [
    classroomCommands.register("record.open", "Open", open),
    classroomCommands.register("record.start", "Start", start),
  ];
  try {
    await runVoiceAgent("开始录制", [], new AbortController().signal);
    expect(open).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  } finally {
    release.forEach((stop) => stop());
  }
});

it("routes a concrete cloud function request to the existing graph command without a planning model", async () => {
  saveSettings({ ...defaults, speech: "cloud", apiKey: "" }, false);
  const plot = vi.fn();
  const release = classroomCommands.register("math.plot", "Insert graph", plot);
  const post = vi.spyOn(transport, "postAI");
  try {
    const signal = new AbortController().signal;
    await runVoiceAgent("画 y=x 的函数图像", [], signal);
    expect(plot).toHaveBeenCalledWith({
      expression: "x",
      surface: false,
      signal,
    });
    expect(post).not.toHaveBeenCalled();
  } finally {
    release();
  }
});

it("rejects a write request answered only by voice_answer or completion text", async () => {
  saveSettings({ ...defaults, apiKey: "configured", speech: "cloud" }, false);
  const api = sceneAPI();
  const original = api.getSceneElements();
  const release = registerCanvasCommands(api);
  const response = (id: string, output: unknown[]) => ({
    status: 200,
    stream: false,
    data: JSON.stringify({ id, status: "completed", output }),
  });
  const post = vi
    .spyOn(transport, "postAI")
    .mockResolvedValueOnce(
      response("claimed", [
        {
          type: "function_call",
          name: "voice_answer",
          call_id: "fake",
          arguments: JSON.stringify({ text: "已经画好了" }),
        },
      ]),
    )
    .mockResolvedValue(
      response("claimed-again", [
        {
          type: "message",
          content: [{ type: "output_text", text: "已经画好了" }],
        },
      ]),
    );
  try {
    const preview = vi.fn();
    const signal = new AbortController().signal;
    await expect(
      runVoiceAgent("手绘电路图", [], signal, signal, preview),
    ).rejects.toThrow();
    expect(
      (post.mock.calls[0][2].tools as { name: string }[]).some(
        (tool) => tool.name === "voice_answer",
      ),
    ).toBe(false);
    expect(preview).not.toHaveBeenCalled();
    expect(api.getSceneElements()).toBe(original);
  } finally {
    release();
  }
});
