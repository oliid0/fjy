import { t } from "@excalidraw/excalidraw/i18n";

import { runBoardCommands } from "./agent";
import { classroomCommands } from "./commands";
import * as ai from "./ai";
import { registerCanvasCommands } from "./canvasCommands";
import { sceneAPI } from "./test/scene";

afterEach(() => vi.restoreAllMocks());

it("recovers from a stale real canvas target using the returned error and latest objects", async () => {
  const api = sceneAPI();
  const id = api.getSceneElements()[0].id;
  const stop = registerCanvasCommands(api);
  const chat = vi
    .spyOn(ai, "chat")
    .mockImplementationOnce(async (messages) => {
      const result = String(messages.at(-1)?.content);
      expect(result).toContain('"ok":false');
      expect(result).toContain("missing");
      expect(result).toContain(id);
      expect(api.updateScene).not.toHaveBeenCalled();
      return JSON.stringify({
        action: "commands",
        commands: [{ name: "canvas.erase", args: { ids: [id] } }],
        continue: true,
      });
    })
    .mockResolvedValueOnce('{"action":"done"}');
  try {
    await expect(
      runBoardCommands(
        {
          action: "commands",
          commands: [{ name: "canvas.erase", args: { ids: [id, "missing"] } }],
          continue: true,
        },
        [],
        undefined,
        () => true,
      ),
    ).resolves.toEqual({ action: "done" });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(String(chat.mock.calls[1][0].at(-1)?.content)).toContain(
      `"ids":["${id}"]`,
    );
    expect(api.getSceneElements()).toEqual([]);
  } finally {
    stop();
  }
});

it("returns real preparation results before requesting a lesson rather than reporting a generic done", async () => {
  const read = vi.fn(() => ({ answer: "0.3" }));
  const stop = classroomCommands.register("test.evaluate", "evaluate", read);
  const lesson = {
    action: "lesson",
    lesson: { title: "decimals", steps: [], quiz: [] },
  };
  const chat = vi.spyOn(ai, "chat").mockResolvedValue(JSON.stringify(lesson));
  try {
    expect(
      await runBoardCommands(
        { action: "commands", commands: [{ name: "test.evaluate" }] },
        [],
        undefined,
        () => true,
        { completion: "Return a lesson from the verified results." },
      ),
    ).toEqual(lesson);
    expect(read).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0][0].at(-1)?.content).toContain("0.3");
    expect(chat.mock.calls[0][0].at(-1)?.content).toContain("Return a lesson");
  } finally {
    stop();
  }
});

it("rejects a recursive teaching batch before any of its tools run", async () => {
  const read = vi.fn();
  const teach = vi.fn();
  const stops = [
    classroomCommands.register("test.read", "read", read),
    classroomCommands.register("lesson.ask", "teach", teach),
  ];
  try {
    await expect(
      runBoardCommands(
        {
          action: "commands",
          commands: [{ name: "test.read" }, { name: "lesson.ask" }],
        },
        [],
        undefined,
        () => true,
        { completion: "Return a lesson.", exclude: ["lesson.ask"] },
      ),
    ).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    expect(teach).not.toHaveBeenCalled();
  } finally {
    stops.forEach((stop) => stop());
  }
});

it("observes real control results before choosing the next tool", async () => {
  const read = vi.fn(() => ({
    controls: [{ selector: "[data-fc-control=3]", label: "质量", value: "1" }],
  }));
  const set = vi.fn(() => ({ value: "2" }));
  const stops = [
    classroomCommands.register("test.read", "read", read),
    classroomCommands.register("test.set", "set", set),
  ];
  const chat = vi
    .spyOn(ai, "chat")
    .mockResolvedValueOnce(
      JSON.stringify({
        action: "commands",
        commands: [
          {
            name: "test.set",
            args: { selector: "[data-fc-control=3]", value: "2" },
          },
        ],
        continue: true,
      }),
    )
    .mockResolvedValueOnce('{"action":"done"}');
  try {
    expect(
      await runBoardCommands(
        {
          action: "commands",
          commands: [{ name: "test.read" }],
          continue: true,
        },
        [],
        undefined,
        () => true,
      ),
    ).toEqual({ action: "done" });
    expect(chat.mock.calls[0][0][1].content).toContain("质量");
    expect(set).toHaveBeenCalledWith({
      selector: "[data-fc-control=3]",
      value: "2",
    });
    expect(chat.mock.calls[1][0].at(-1)?.content).toContain('"value":"2"');
  } finally {
    stops.forEach((stop) => stop());
  }
});

it("validates the whole batch before editing and keeps legacy single-batch requests local", async () => {
  const edit = vi.fn();
  const stop = classroomCommands.register("test.edit", "edit", edit);
  const chat = vi.spyOn(ai, "chat");
  try {
    await expect(
      runBoardCommands(
        {
          action: "commands",
          commands: [{ name: "test.edit" }, { name: "missing" }],
        },
        [],
        undefined,
        () => true,
      ),
    ).rejects.toThrow(t("fcboard.AI 请求了当前不可用的操作，请重新描述"));
    expect(edit).not.toHaveBeenCalled();
    await runBoardCommands(
      { action: "commands", commands: [{ name: "test.edit" }] },
      [],
      undefined,
      () => true,
    );
    expect(edit).toHaveBeenCalledTimes(1);
    expect(chat).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});

it("stops later operations when the current selection or board is invalidated", async () => {
  let valid = true;
  const later = vi.fn();
  const stops = [
    classroomCommands.register("test.invalidate", "change", () => {
      valid = false;
    }),
    classroomCommands.register("test.later", "later", later),
  ];
  try {
    await runBoardCommands(
      {
        action: "commands",
        commands: [{ name: "test.invalidate" }, { name: "test.later" }],
      },
      [],
      undefined,
      () => valid,
    );
    expect(later).not.toHaveBeenCalled();
  } finally {
    stops.forEach((stop) => stop());
  }
});

it("returns a tool failure to the model for correction and bounds repeated observation", async () => {
  const stop = classroomCommands.register("test.fail", "fail", () => {
    throw new Error("未找到控件");
  });
  const action = {
    action: "commands",
    commands: [{ name: "test.fail" }],
    continue: true,
  };
  const chat = vi.spyOn(ai, "chat").mockResolvedValue(JSON.stringify(action));
  try {
    await expect(
      runBoardCommands(action, [], undefined, () => true),
    ).rejects.toThrow(
      t("fcboard.连续观察达到上限，已完成的内容已保留，可继续描述下一步"),
    );
    expect(chat).toHaveBeenCalledTimes(5);
    expect(chat.mock.calls[0][0][1].content).toContain("未找到控件");
  } finally {
    stop();
  }
});
