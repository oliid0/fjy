import { waitFor } from "@testing-library/react";

import { registerBoardAgents } from "./boardAgents";
import { registerCanvasCommands } from "./canvasCommands";
import { classroomCommands, executeBoardCommand } from "./commands";
import { validateLesson } from "./lesson";
import * as narration from "./narration";
import { TeachingEngine } from "./teaching";
import { interactiveResource } from "./test/interactiveResource";
import { sceneAPI } from "./test/scene";

import type { BoardTask } from "./boardAgents";

const setup = () => {
  let begin!: () => void;
  const speak = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          begin = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  vi.spyOn(narration, "createNarrator").mockReturnValue({
    speak,
    finished: Promise.resolve(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(async () => {}),
  });
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: false,
  } as MediaQueryList);
  const api = sceneAPI();
  const canvas = registerCanvasCommands(api);
  const agents = registerBoardAgents();
  const pending: {
    prompt: string;
    signal: AbortSignal;
    resolve: (value: { id: string; title: string }) => void;
  }[] = [];
  const prepare = classroomCommands.register(
    "resources.prepare",
    "Prepare an actual asset without inserting",
    (args) =>
      new Promise((resolve) => {
        pending.push({
          prompt: String(args.prompt),
          signal: args.signal as AbortSignal,
          resolve,
        });
      }),
  );
  const use = classroomCommands.register(
    "resources.use",
    "Insert prepared resource",
    async (args) => {
      const task = (await executeBoardCommand(
        { name: "agent.wait", args: { id: args.taskId } },
        args.signal as AbortSignal,
      )) as BoardTask;
      const asset = task.result as { id: string; title: string };
      return executeBoardCommand(
        {
          name: "canvas.resource",
          args: { resource: { ...interactiveResource, ...asset } },
        },
        args.signal as AbortSignal,
      );
    },
  );
  const generate = vi.fn();
  const direct = classroomCommands.register(
    "resources.generate",
    "Generate at the current step",
    generate,
  );
  const engine = new TeachingEngine(api);
  return {
    api,
    engine,
    pending,
    generate,
    speak,
    begin: () => begin(),
    stop: () => {
      engine.cancel();
      direct();
      use();
      prepare();
      agents();
      canvas();
    },
  };
};
const plan = (prompt = "牛顿第一定律惯性演示") =>
  validateLesson({
    title: "Newton",
    steps: [
      { say: "先观察运动与力的关系。", commands: [] },
      {
        say: "这是惯性演示。",
        commands: [],
        tools: [{ name: "resources.generate", args: { prompt } }],
      },
      {
        say: "这是加速度演示。",
        commands: [],
        tools: [
          { name: "resources.generate", args: { prompt: "F=ma 加速度动画" } },
        ],
      },
    ],
    quiz: [],
  });
afterEach(() => vi.restoreAllMocks());

it("prepares two future resources concurrently while speaking, and inserts each real iframe only at its teaching step", async () => {
  const host = setup();
  const task = host.engine.start(plan());
  try {
    await waitFor(() => expect(host.pending).toHaveLength(2));
    expect(host.speak).toHaveBeenCalledWith(
      "先观察运动与力的关系。",
      expect.anything(),
    );
    expect(
      host.api.getSceneElements().some((element) => element.type === "iframe"),
    ).toBe(false);
    host.pending.forEach((request, index) =>
      request.resolve({
        id: `generated:prepared-${index}`,
        title: request.prompt,
      }),
    );
    await waitFor(() =>
      expect(
        (classroomCommands.read("agents") as BoardTask[]).every(
          (item) => item.state === "completed",
        ),
      ).toBe(true),
    );
    expect(
      host.api.getSceneElements().some((element) => element.type === "iframe"),
    ).toBe(false);
    host.begin();
    await task;
    expect(host.generate).not.toHaveBeenCalled();
    const frames = host.api
      .getSceneElements()
      .filter((element) => element.type === "iframe");
    expect(frames).toHaveLength(2);
    expect(
      frames.map((element) => element.customData?.fcInteractiveResource?.title),
    ).toEqual(["牛顿第一定律惯性演示", "F=ma 加速度动画"]);
    expect(host.engine.state.mode).toBe("complete");
  } finally {
    host.begin();
    host.stop();
    await task.catch(() => {});
  }
});

it("cancels only its own prefetched resources when the lesson stops and never inserts late results", async () => {
  const host = setup();
  const task = host.engine.start(plan());
  try {
    await waitFor(() => expect(host.pending).toHaveLength(2));
    host.engine.cancel();
    expect(host.pending.every((request) => request.signal.aborted)).toBe(true);
    host.pending.forEach((request) =>
      request.resolve({ id: "generated:late", title: "late" }),
    );
    host.begin();
    await expect(task).rejects.toMatchObject({ name: "AbortError" });
    expect(
      host.api.getSceneElements().some((element) => element.type === "iframe"),
    ).toBe(false);
  } finally {
    host.begin();
    host.stop();
    await task.catch(() => {});
  }
});

it("keeps board-dependent resource generation at its actual step", async () => {
  const host = setup();
  const lesson = plan("根据当前白板生成惯性演示");
  lesson.steps.pop();
  const task = host.engine.start(lesson);
  try {
    await waitFor(() => expect(host.speak).toHaveBeenCalled());
    expect(host.pending).toHaveLength(0);
    expect(host.generate).not.toHaveBeenCalled();
    host.begin();
    await task;
    expect(host.generate).toHaveBeenCalledTimes(1);
  } finally {
    host.begin();
    host.stop();
    await task.catch(() => {});
  }
});

it("keeps pure resource preparation running across the lesson's own page change", async () => {
  const host = setup();
  let active = "page-one";
  const boards = classroomCommands.context("boards", () => ({ active }));
  const next = classroomCommands.register(
    "board.new",
    "Create page",
    (args) => {
      active = "page-two";
      host.api.updateScene({ elements: [] });
      classroomCommands.invalidate(args.signal as AbortSignal);
      return { active };
    },
  );
  const lesson = plan();
  lesson.steps[0].tools = [{ name: "board.new" }];
  const task = host.engine.start(lesson);
  try {
    await waitFor(() => expect(host.speak).toHaveBeenCalled());
    expect(active).toBe("page-two");
    expect(host.pending).toHaveLength(2);
    expect(host.pending.every((request) => !request.signal.aborted)).toBe(true);
    host.pending.forEach((request, index) =>
      request.resolve({
        id: `generated:next-page-${index}`,
        title: request.prompt,
      }),
    );
    host.begin();
    await task;
    expect(
      host.api
        .getSceneElements()
        .filter((element) => element.type === "iframe"),
    ).toHaveLength(2);
    expect(host.generate).not.toHaveBeenCalled();
  } finally {
    host.begin();
    host.stop();
    next();
    boards();
    await task.catch(() => {});
  }
});
