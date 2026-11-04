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

it("returns preparation immediately and keeps its actual parent ownership across lesson navigation", async () => {
  const host = setup();
  let finish!: () => void;
  let signal!: AbortSignal;
  const parent = new AbortController();
  const lesson = classroomCommands.register("lesson.ask", "Teach", (args) => {
    signal = args.signal as AbortSignal;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  try {
    const task = await start("讲解", {
      signal: parent.signal,
      command: { name: "lesson.ask", args: { prompt: "讲解" } },
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
    const task = await start("核实资料", { role: "research" });
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
