import { waitFor } from "@testing-library/react";

import * as ai from "./ai";
import * as transport from "./aiTransport";
import { registerBoardAgents } from "./boardAgents";
import { registerCanvasCommands } from "./canvasCommands";
import { classroomCommands, executeBoardCommand } from "./commands";
import { sceneAPI } from "./test/scene";

import { defaults, saveSettings } from "./settings";

import type { BoardTask } from "./boardAgents";

const draw = JSON.stringify({
  action: "commands",
  commands: [
    {
      name: "canvas.ink",
      args: {
        strokes: [
          [
            [400, 300],
            [420, 280],
            [450, 310],
            [480, 280],
            [500, 300],
            [480, 350],
            [420, 350],
            [400, 300],
          ],
        ],
        select: false,
      },
    },
  ],
});
const start = (prompt: string, args = {}) =>
  classroomCommands.execute({
    name: "agent.start",
    args: { prompt, role: "draw", ...args },
  }) as Promise<BoardTask>;
const inspect = (id: string) =>
  classroomCommands.execute({
    name: "agent.inspect",
    args: { id },
  }) as Promise<BoardTask>;
const setup = () => {
  const api = sceneAPI();
  const canvas = registerCanvasCommands(api);
  const agents = registerBoardAgents();
  return {
    api,
    stop: () => {
      agents();
      canvas();
    },
  };
};
beforeEach(() => {
  saveSettings(
    {
      ...defaults,
      apiKey: "configured",
      endpoint: "https://example.com/v1/chat/completions",
    },
    false,
  );
  vi.spyOn(ai, "boardContext").mockImplementation(async (api) => ({
    elements: api.getSceneElements(),
    text: "学生的题目",
    image: undefined,
  }));
});
afterEach(() => vi.restoreAllMocks());

it("starts independent model requests concurrently and commits actual editable freehand ink before reporting completion", async () => {
  const host = setup();
  const finishes: ((value: string) => void)[] = [];
  const model = vi
    .spyOn(ai, "chat")
    .mockImplementation(async (messages) =>
      messages.length > 2
        ? '{"action":"done"}'
        : new Promise((resolve) => finishes.push(resolve)),
    );
  try {
    const first = await start("用笔画苹果");
    const second = await start("用笔画演示图");
    expect(first.state).toBe("running");
    expect(second.state).toBe("running");
    await waitFor(() => expect(model).toHaveBeenCalledTimes(2));
    expect(host.api.getSceneElements()).toHaveLength(1);
    finishes[1](draw);
    await waitFor(async () =>
      expect((await inspect(second.id)).state).toBe("completed"),
    );
    expect((await inspect(first.id)).state).toBe("running");
    const ink = host.api
      .getSceneElements()
      .filter((element) => element.type === "freedraw");
    expect(ink).toHaveLength(1);
    expect(ink[0]).toMatchObject({
      x: 400,
      y: 300,
      points: [
        [0, 0],
        [20, -20],
        [50, 10],
        [80, -20],
        [100, 0],
        [80, 50],
        [20, 50],
        [0, 0],
      ],
    });
    finishes[0](draw);
    await waitFor(async () =>
      expect((await inspect(first.id)).state).toBe("completed"),
    );
    expect(
      host.api
        .getSceneElements()
        .filter((element) => element.type === "freedraw"),
    ).toHaveLength(2);
  } finally {
    host.stop();
  }
});

it.each(["cancel", "navigate"])(
  "discards late model ink after %s without replaying completed work",
  async (action) => {
    const host = setup();
    let finish!: (value: string) => void;
    vi.spyOn(ai, "chat").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    try {
      const task = await start("画图");
      await waitFor(() => expect(typeof finish).toBe("function"));
      if (action === "cancel") {
        await classroomCommands.execute({
          name: "agent.cancel",
          args: { id: task.id },
        });
      } else {
        classroomCommands.invalidate();
      }
      finish(draw);
      await waitFor(async () =>
        expect((await inspect(task.id)).state).toBe("cancelled"),
      );
      expect(host.api.getSceneElements()).toHaveLength(1);
    } finally {
      host.stop();
    }
  },
);

it("reports a provider failure as a failed task and rejects a textual success without any tool execution", async () => {
  const host = setup();
  const model = vi
    .spyOn(ai, "chat")
    .mockRejectedValueOnce(new Error("provider unavailable"))
    .mockResolvedValue('{"action":"done"}');
  try {
    const first = await start("画图");
    await waitFor(async () =>
      expect((await inspect(first.id)).state).toBe("failed"),
    );
    expect((await inspect(first.id)).error).toContain("provider unavailable");
    const second = await start("再画图");
    await waitFor(async () =>
      expect((await inspect(second.id)).state).toBe("failed"),
    );
    expect(model).toHaveBeenCalledTimes(2);
    expect(host.api.getSceneElements()).toHaveLength(1);
  } finally {
    host.stop();
  }
});

it("returns immediately and keeps actual parent ownership across background navigation", async () => {
  const host = setup();
  let finish!: () => void;
  let signal!: AbortSignal;
  const parent = new AbortController();
  const lesson = classroomCommands.register("board.open", "Open", (args) => {
    signal = args.signal as AbortSignal;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  try {
    const task = await start("讲解", {
      signal: parent.signal,
      command: { name: "board.open", args: { name: "related" } },
    });
    expect(task.state).toBe("running");
    expect(classroomCommands.isOwnedBy(signal, parent.signal)).toBe(true);
    classroomCommands.invalidate(signal);
    expect(signal.aborted).toBe(false);
    finish();
    await waitFor(async () =>
      expect((await inspect(task.id)).state).toBe("completed"),
    );
    expect(classroomCommands.isOwnedBy(signal, parent.signal)).toBe(true);
    parent.abort();
    expect(signal.aborted).toBe(true);
  } finally {
    lesson();
    host.stop();
  }
});

it("bounds concurrent requests without queueing excess work", async () => {
  const host = setup();
  const model = vi
    .spyOn(ai, "chat")
    .mockImplementation(() => new Promise(() => {}));
  try {
    const tasks = await Promise.all(
      Array.from({ length: 6 }, (_, i) => start(`画${i}`)),
    );
    expect(tasks.every((task) => task.state === "running")).toBe(true);
    await waitFor(() => expect(model).toHaveBeenCalledTimes(6));
    await expect(start("第七个")).rejects.toThrow();
    expect(model).toHaveBeenCalledTimes(6);
  } finally {
    host.stop();
  }
});

it("uses the default provider Responses endpoint and keeps executing native tools until a final result", async () => {
  saveSettings(
    { ...defaults, apiKey: "configured", textModel: "strong-model" },
    false,
  );
  const host = setup();
  const chat = vi.spyOn(ai, "chat");
  const post = vi
    .spyOn(transport, "postAI")
    .mockResolvedValueOnce({
      status: 200,
      stream: false,
      data: JSON.stringify({
        id: "task-step",
        status: "completed",
        output: [
          {
            type: "function_call",
            name: "board_draw",
            call_id: "ink",
            arguments: JSON.stringify(JSON.parse(draw).commands[0].args),
          },
        ],
      }),
    })
    .mockResolvedValueOnce({
      status: 200,
      stream: false,
      data: JSON.stringify({
        id: "task-finished",
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "已画出苹果轮廓。" }],
          },
        ],
      }),
    });
  try {
    const task = await start("用笔画苹果");
    await waitFor(async () =>
      expect((await inspect(task.id)).state).toBe("completed"),
    );
    expect(chat).not.toHaveBeenCalled();
    expect(post.mock.calls[0][0]).toBe(
      "https://ark.cn-beijing.volces.com/api/v3/responses",
    );
    expect(post.mock.calls[0][2]).toMatchObject({ model: "strong-model" });
    expect(post.mock.calls[1][2]).toMatchObject({
      previous_response_id: "task-step",
    });
    expect(
      host.api
        .getSceneElements()
        .filter((element) => element.type === "freedraw"),
    ).toHaveLength(1);
  } finally {
    host.stop();
  }
});

it("uses the configured stronger model and real provider search for research while preserving the result", async () => {
  const host = setup();
  saveSettings(
    { ...defaults, apiKey: "configured", textModel: "strong-reasoning-model" },
    false,
  );
  const model = vi
    .spyOn(ai, "chat")
    .mockResolvedValue("Verified answer with a source link.");
  try {
    const task = await start("核实资料", {
      role: "research",
      command: { name: "research.search", args: { prompt: "核实资料" } },
    });
    await waitFor(async () =>
      expect((await inspect(task.id)).state).toBe("completed"),
    );
    expect(model).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(AbortSignal),
      expect.objectContaining({ model: "strong-reasoning-model" }),
      expect.objectContaining({ webSearch: true }),
    );
    expect((await inspect(task.id)).result).toEqual({
      answer: "Verified answer with a source link.",
    });
  } finally {
    host.stop();
  }
});

const waitSubscriptions = () => {
  const subscribe = classroomCommands.watch.bind(classroomCommands);
  const releases: ReturnType<typeof vi.fn>[] = [];
  vi.spyOn(classroomCommands, "watch").mockImplementation((name, listener) => {
    const release = vi.fn(subscribe(name, listener));
    releases.push(release);
    return release;
  });
  return releases;
};

it("lets a model-selected role write real board text, narrate the same text and launch an independent resource", async () => {
  const host = setup();
  const spoken: string[] = [];
  const text = "物体的运动状态取决于合外力。";
  let complete!: () => void;
  const resource = classroomCommands.register(
    "resources.generate",
    "Generate a real experiment",
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const watch = classroomCommands.watch("agents", () => {
    for (const task of (classroomCommands.read("agents") as BoardTask[]) ||
      []) {
      if (task.speech && !spoken.includes(task.speech.text)) {
        spoken.push(task.speech.text);
      }
    }
  });
  const model = vi
    .spyOn(ai, "chat")
    .mockResolvedValueOnce(
      JSON.stringify({
        action: "commands",
        commands: [
          {
            name: "agent.start",
            args: {
              prompt: "生成可操作实验",
              role: "实验协调",
              command: {
                name: "resources.generate",
                args: { prompt: "可操作实验" },
              },
            },
          },
          {
            name: "canvas.text",
            args: { text, sourceIds: [], presentation: "text" },
          },
          { name: "agent.say", args: { text } },
        ],
      }),
    )
    .mockResolvedValueOnce(JSON.stringify({ action: "done" }));
  try {
    const task = await start("按当前问题选择合适的方式演示", {
      role: "学科协调",
    });
    await waitFor(async () =>
      expect((await inspect(task.id)).state).toBe("completed"),
    );
    expect(model).toHaveBeenCalledTimes(2);
    expect(
      host.api
        .getSceneElements()
        .some((element) => element.type === "text" && element.text === text),
    ).toBe(true);
    expect(spoken).toEqual([text]);
    const child = (classroomCommands.read("agents") as BoardTask[]).find(
      (value) => value.id !== task.id,
    )!;
    expect(child.state).toBe("running");
    complete();
    await waitFor(async () =>
      expect((await inspect(child.id)).state).toBe("completed"),
    );
  } finally {
    resource();
    watch();
    host.stop();
  }
});

it.each(["commands", "done"])(
  "applies a new user correction before accepting stale proposed %s",
  async (proposal) => {
    const host = setup();
    let answer!: (text: string) => void;
    vi.spyOn(ai, "chat")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          action: "commands",
          commands: [
            {
              name: "canvas.text",
              args: {
                text: "修订后的内容",
                sourceIds: [],
                presentation: "text",
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(JSON.stringify({ action: "done" }));
    try {
      const task = await start("先写原始内容", { role: "自由分工" });
      await waitFor(() => expect(answer).toBeDefined());
      await classroomCommands.execute({
        name: "agent.update",
        args: { id: task.id, prompt: "改写修订后的内容" },
      });
      answer(
        JSON.stringify({
          action: proposal,
          commands: [{ name: "canvas.text", args: { text: "过时内容" } }],
        }),
      );
      await waitFor(async () =>
        expect((await inspect(task.id)).state).toBe("completed"),
      );
      const texts = host.api
        .getSceneElements()
        .filter((element) => element.type === "text")
        .map((element) => element.text);
      expect(texts).toContain("修订后的内容");
      expect(texts).not.toContain("过时内容");
    } finally {
      host.stop();
    }
  },
);

it("waits for background resource preparation and returns its complete real result, releasing subscriptions", async () => {
  const host = setup();
  let finish!: (value: unknown) => void;
  let request!: AbortSignal;
  const prepared = {
    id: "prepared-resource",
    title: "牛顿定律",
    html: "<html>inertia</html>",
  };
  const prepare = classroomCommands.register(
    "resources.prepare",
    "Prepare",
    (args) => {
      request = args.signal as AbortSignal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  );
  const subscriptions = waitSubscriptions();
  try {
    const task = await start("准备下一步动画", {
      role: "resource",
      command: { name: "resources.prepare", args: { prompt: "牛顿定律动画" } },
    });
    expect(request).toBeInstanceOf(AbortSignal);
    expect(task).toMatchObject({
      state: "running",
      command: "resources.prepare",
    });
    const waiting = executeBoardCommand({
      name: "agent.wait",
      args: { id: task.id },
    });
    let settled = false;
    void waiting.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish(prepared);
    await expect(waiting).resolves.toMatchObject({
      id: task.id,
      state: "completed",
      finishedAt: expect.any(Number),
      result: prepared,
    });
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]).toHaveBeenCalledTimes(1);
    await expect(
      executeBoardCommand({ name: "agent.wait", args: { id: task.id } }),
    ).resolves.toMatchObject({ result: prepared });
    expect(subscriptions).toHaveLength(2);
    expect(subscriptions[1]).toHaveBeenCalledTimes(1);
  } finally {
    prepare();
    host.stop();
  }
});

it.each(["failed", "cancelled"])(
  "rejects waiting when the original task is %s and removes its listener",
  async (state) => {
    const host = setup();
    let fail!: (reason: Error) => void;
    const prepare = classroomCommands.register(
      "resources.prepare",
      "Prepare",
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    const subscriptions = waitSubscriptions();
    try {
      const task = await start("准备资源", {
        command: { name: "resources.prepare", args: { prompt: "资源" } },
      });
      const waiting = executeBoardCommand({
        name: "agent.wait",
        args: { id: task.id },
      });
      const rejection =
        state === "failed"
          ? expect(waiting).rejects.toThrow("provider resource failure")
          : expect(waiting).rejects.toMatchObject({ name: "AbortError" });
      if (state === "failed") {
        fail(new Error("provider resource failure"));
      } else {
        await classroomCommands.execute({
          name: "agent.cancel",
          args: { id: task.id },
        });
      }
      await rejection;
      expect((await inspect(task.id)).state).toBe(state);
      expect(subscriptions).toHaveLength(1);
      expect(subscriptions[0]).toHaveBeenCalledTimes(1);
      classroomCommands.changed("agents");
      expect(subscriptions[0]).toHaveBeenCalledTimes(1);
    } finally {
      prepare();
      host.stop();
    }
  },
);

it("aborts only a wait without cancelling resource preparation, then allows a new wait to receive its result", async () => {
  const host = setup();
  let finish!: (value: unknown) => void;
  let taskSignal!: AbortSignal;
  const prepare = classroomCommands.register(
    "resources.prepare",
    "Prepare",
    (args) => {
      taskSignal = args.signal as AbortSignal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  );
  const subscriptions = waitSubscriptions();
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  try {
    const task = await start("准备资源", {
      command: { name: "resources.prepare", args: { prompt: "资源" } },
    });
    const waiting = executeBoardCommand(
      { name: "agent.wait", args: { id: task.id } },
      controller.signal,
    );
    const rejection = expect(waiting).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await rejection;
    expect(taskSignal.aborted).toBe(false);
    expect((await inspect(task.id)).state).toBe("running");
    expect(subscriptions[0]).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    const next = executeBoardCommand({
      name: "agent.wait",
      args: { id: task.id },
    });
    finish({ id: "resource-ready" });
    await expect(next).resolves.toMatchObject({
      state: "completed",
      result: { id: "resource-ready" },
    });
    expect(subscriptions).toHaveLength(2);
    expect(
      subscriptions.every((release) => release.mock.calls.length === 1),
    ).toBe(true);
  } finally {
    prepare();
    host.stop();
  }
});

it("rejects waiters on agent unmount and rejects unknown ids without subscribing", async () => {
  const host = setup();
  const prepare = classroomCommands.register(
    "resources.prepare",
    "Prepare",
    () => new Promise(() => {}),
  );
  const subscriptions = waitSubscriptions();
  try {
    await expect(
      executeBoardCommand({ name: "agent.wait", args: { id: "unknown" } }),
    ).rejects.toThrow();
    expect(subscriptions).toHaveLength(0);
    const task = await start("准备资源", {
      command: { name: "resources.prepare", args: { prompt: "资源" } },
    });
    const waiting = executeBoardCommand({
      name: "agent.wait",
      args: { id: task.id },
    });
    const rejection = expect(waiting).rejects.toMatchObject({
      name: "AbortError",
    });
    host.stop();
    await rejection;
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]).toHaveBeenCalledTimes(1);
  } finally {
    prepare();
    host.stop();
  }
});

it("does not restrict a research-labelled task to search or automatically narrate its results", async () => {
  const host = setup();
  const model = vi
    .spyOn(ai, "chat")
    .mockResolvedValueOnce(draw)
    .mockResolvedValue('{"action":"done"}');
  try {
    const task = await start("根据现有信息画出关系", { role: "research" });
    await waitFor(async () =>
      expect((await inspect(task.id)).state).toBe("completed"),
    );
    expect(
      host.api
        .getSceneElements()
        .some((element) => element.type === "freedraw"),
    ).toBe(true);
    expect(model.mock.calls[0][3]).not.toHaveProperty("webSearch");
    expect((await inspect(task.id)).speech).toBeUndefined();
  } finally {
    host.stop();
  }
});

it.each(["chat", "responses"])(
  "applies corrections received during a %s tool batch before its remaining stale edits",
  async (provider) => {
    if (provider === "responses") {
      saveSettings({ ...defaults, apiKey: "configured" }, false);
    }
    const host = setup();
    let finish!: () => void;
    const prepare = classroomCommands.register(
      "experiment.prepare",
      "Prepare the real experiment",
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const original = [
      { name: "experiment.prepare", args: {} },
      {
        name: "canvas.text",
        args: { text: "过时内容", sourceIds: [], presentation: "text" },
      },
    ];
    const revised = [
      {
        name: "canvas.text",
        args: { text: "更正内容", sourceIds: [], presentation: "text" },
      },
    ];
    const response = (id: string, commands?: typeof original) => ({
      status: 200,
      stream: false,
      data: JSON.stringify({
        id,
        status: "completed",
        output: commands
          ? commands.map((command, i) => ({
              type: "function_call",
              name: "board_command",
              call_id: `${id}-${i}`,
              arguments: JSON.stringify(command),
            }))
          : [
              {
                type: "message",
                content: [{ type: "output_text", text: "完成" }],
              },
            ],
      }),
    });
    const model =
      provider === "responses"
        ? vi
            .spyOn(transport, "postAI")
            .mockResolvedValueOnce(response("original", original))
            .mockResolvedValueOnce(response("revised", revised))
            .mockResolvedValueOnce(response("done"))
        : vi
            .spyOn(ai, "chat")
            .mockResolvedValueOnce(
              JSON.stringify({ action: "commands", commands: original }),
            )
            .mockResolvedValueOnce(
              JSON.stringify({ action: "commands", commands: revised }),
            )
            .mockResolvedValueOnce(JSON.stringify({ action: "done" }));
    try {
      const task = await start("完成实验并写出结论");
      await waitFor(() => expect(finish).toBeDefined());
      await classroomCommands.execute({
        name: "agent.update",
        args: { id: task.id, prompt: "结论改为更正内容，保留已经完成的准备" },
      });
      finish();
      await waitFor(async () =>
        expect((await inspect(task.id)).state).toBe("completed"),
      );
      const texts = host.api
        .getSceneElements()
        .filter((element) => element.type === "text")
        .map((element) => element.text);
      expect(texts).toContain("更正内容");
      expect(texts).not.toContain("过时内容");
      const continuation = model.mock.calls[1];
      expect(JSON.stringify(continuation)).toContain("结论改为更正内容");
      if (provider === "responses") {
        expect(JSON.stringify(continuation)).toContain("original-0");
        expect(JSON.stringify(continuation)).toContain("original-1");
        expect(JSON.stringify(continuation)).toContain("skipped");
      }
    } finally {
      prepare();
      host.stop();
    }
  },
);

it.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  "preserves selected-source screenshot privacy when selectionImages=%s and explicit sourceIds=%s",
  async (selectionImages, explicit) => {
    saveSettings(
      {
        ...defaults,
        endpoint: "https://example.com/v1/chat/completions",
        apiKey: "configured",
        selectionImages,
      },
      false,
    );
    const host = setup();
    const source = host.api.getSceneElements()[0];
    const initialState = host.api.getAppState();
    vi.spyOn(host.api, "getAppState").mockImplementation(() => ({
      ...initialState,
      selectedElementIds: { [source.id]: true },
    }));
    const capture = vi
      .mocked(ai.boardContext)
      .mockImplementation(async (_api, _whole, _source, _viewport, image) => ({
        elements: [source],
        text: "圈选内容",
        image: image ? "data:image/png;base64,selected" : undefined,
      }));
    const model = vi
      .spyOn(ai, "chat")
      .mockResolvedValueOnce(draw)
      .mockResolvedValue('{"action":"done"}');
    try {
      const task = await start(
        "解释圈选并在旁边演示",
        explicit ? { sourceIds: [source.id] } : {},
      );
      await waitFor(async () =>
        expect((await inspect(task.id)).state).toBe("completed"),
      );
      expect(capture).toHaveBeenCalledWith(
        host.api,
        false,
        [source],
        expect.anything(),
        selectionImages,
      );
      expect(
        JSON.stringify(model.mock.calls[0][0]).includes(
          "data:image/png;base64,selected",
        ),
      ).toBe(selectionImages);
    } finally {
      host.stop();
    }
  },
);

it.each([
  ["chat", "complete"],
  ["chat", "fail"],
  ["responses", "complete"],
  ["responses", "fail"],
])(
  "replans a %s command task after queued corrections and its %s result, retaining actual dependency outputs",
  async (provider, outcome) => {
    if (provider === "responses") {
      saveSettings({ ...defaults, apiKey: "configured" }, false);
    }
    const host = setup();
    let finish!: () => void;
    const prepare = vi.fn(
      () =>
        new Promise((resolve, reject) => {
          finish = () =>
            outcome === "fail"
              ? reject(new Error("original generation unavailable"))
              : resolve({ objectId: "actual-object" });
        }),
    );
    const apply = vi
      .fn()
      .mockReturnValue({ objectId: "actual-object", updated: true });
    const operation =
      outcome === "fail" ? "experiment.replace" : "experiment.change";
    const args =
      outcome === "fail"
        ? { mode: "new goal" }
        : { id: "actual-object", mode: "new goal" };
    const releases = [
      classroomCommands.register(
        "experiment.prepare",
        "Prepare the real experiment",
        prepare,
      ),
      classroomCommands.register(
        operation,
        "Apply the updated goal to actual experiment data",
        apply,
      ),
    ];
    const response = (id: string, output: unknown[]) => ({
      status: 200,
      stream: false,
      data: JSON.stringify({ id, status: "completed", output }),
    });
    const model =
      provider === "responses"
        ? vi
            .spyOn(transport, "postAI")
            .mockResolvedValueOnce(
              response("replan", [
                {
                  type: "function_call",
                  name: "board_command",
                  call_id: "updated",
                  arguments: JSON.stringify({ name: operation, args }),
                },
              ]),
            )
            .mockResolvedValueOnce(
              response("done", [
                {
                  type: "message",
                  content: [{ type: "output_text", text: "完成" }],
                },
              ]),
            )
        : vi
            .spyOn(ai, "chat")
            .mockResolvedValueOnce(
              JSON.stringify({
                action: "commands",
                commands: [{ name: operation, args }],
              }),
            )
            .mockResolvedValue('{"action":"done"}');
    try {
      const task = await start("准备并使用原实验", {
        command: { name: "experiment.prepare", args: {} },
      });
      await waitFor(() => expect(finish).toBeDefined());
      await classroomCommands.execute({
        name: "agent.update",
        args: {
          id: task.id,
          prompt: "更新目标为new goal，先读取实际准备结果，保留已完成操作",
        },
      });
      finish();
      await waitFor(async () =>
        expect((await inspect(task.id)).state).toBe("completed"),
      );
      expect(model).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(model.mock.calls[0])).toContain(
        "更新目标为new goal",
      );
      expect(JSON.stringify(model.mock.calls[0])).toContain(
        outcome === "fail"
          ? "original generation unavailable"
          : "actual-object",
      );
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(apply).toHaveBeenCalledWith(expect.objectContaining(args));
      expect((await inspect(task.id)).result).toMatchObject({
        results: [
          expect.objectContaining({
            name: "experiment.prepare",
            ok: outcome === "complete",
          }),
          expect.objectContaining({
            name: operation,
            ok: true,
            result: { objectId: "actual-object", updated: true },
          }),
        ],
      });
      expect((await inspect(task.id)).speech).toBeUndefined();
    } finally {
      releases.forEach((release) => release());
      host.stop();
    }
  },
);

it("finishes seven dependent tool observations within the independent task budget", async () => {
  const host = setup();
  let calls = 0;
  vi.spyOn(ai, "chat").mockImplementation(async (messages) => {
    if (calls > 0) {
      const last = String(messages.at(-1)?.content);
      expect(last).toContain(`步骤${calls}`);
      expect(
        host.api
          .getSceneElements()
          .filter(
            (item) =>
              !item.isDeleted &&
              item.type === "text" &&
              item.text.startsWith("步骤"),
          ),
      ).toHaveLength(calls);
    }
    return ++calls <= 7
      ? JSON.stringify({
          action: "commands",
          commands: [
            {
              name: "canvas.text",
              args: {
                text: `步骤${calls}`,
                sourceIds: [],
                presentation: "text",
              },
            },
          ],
        })
      : '{"action":"done"}';
  });
  try {
    const task = await start("完成七个相互依赖的观察与板书步骤");
    const completed = (await classroomCommands.execute({
      name: "agent.wait",
      args: { id: task.id },
    })) as BoardTask;
    expect(completed.state).toBe("completed");
    expect(calls).toBe(8);
  } finally {
    host.stop();
  }
});
