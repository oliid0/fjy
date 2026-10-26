import { t } from "@excalidraw/excalidraw/i18n";

import type { ResourceControlState } from "@excalidraw/excalidraw/interactiveResourceControls";

import { runBoardCommands } from "./agent";
import { classroomCommands } from "./commands";
import * as ai from "./ai";
import { registerCanvasCommands } from "./canvasCommands";
import { sceneAPI } from "./test/scene";
import { resourceFrame } from "./test/resourceFrame";
import { interactiveResource } from "./test/interactiveResource";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  {
    style: false,
    presentation: undefined,
    expected: { sourceIds: ["question"], presentation: "handwritten" },
  },
  {
    style: false,
    presentation: "text",
    expected: { sourceIds: ["question"], presentation: "text" },
  },
  { style: true, presentation: undefined, expected: {} },
])(
  "preserves explicit text style after tools while ordinary answers retain their question anchor: %j",
  async ({ style, presentation, expected }) => {
    const write = vi.fn();
    const stops = [
      classroomCommands.register("canvas.text", "write", write),
      classroomCommands.register("canvas.style", "style", () => ({
        fontSize: 40,
        color: "#dc2626",
      })),
    ];
    const chat = vi.spyOn(ai, "chat").mockResolvedValue(
      JSON.stringify({
        action: "commands",
        commands: [
          {
            name: "canvas.text",
            args: {
              text: "Follow the requested style",
              ...(presentation ? { presentation } : {}),
            },
          },
        ],
      }),
    );
    try {
      await runBoardCommands(
        {
          action: "commands",
          continue: style,
          commands: style
            ? [
                {
                  name: "canvas.style",
                  args: { fontSize: 40, color: "#dc2626" },
                },
              ]
            : [
                {
                  name: "canvas.text",
                  args: {
                    text: "Follow the requested style",
                    ...(presentation ? { presentation } : {}),
                  },
                },
              ],
        },
        [],
        undefined,
        () => true,
        { textSourceIds: ["question"] },
      );
      expect(write).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledWith({
        text: "Follow the requested style",
        ...expected,
      });
      expect(chat).toHaveBeenCalledTimes(style ? 1 : 0);
    } finally {
      stops.forEach((stop) => stop());
    }
  },
);

it("ends a cancelled pending tool without waiting for a late third-party response or running later commands", async () => {
  let deliver!: (value: unknown) => void;
  const later = vi.fn();
  const stops = [
    classroomCommands.register(
      "test.pending",
      "pending",
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    ),
    classroomCommands.register("test.later", "later", later),
  ];
  const chat = vi.spyOn(ai, "chat");
  const controller = new AbortController();
  try {
    const finished = runBoardCommands(
      {
        action: "commands",
        continue: true,
        commands: [{ name: "test.pending" }, { name: "test.later" }],
      },
      [],
      controller.signal,
      () => true,
    );
    controller.abort();
    await expect(finished).resolves.toEqual({ action: "done" });
    deliver({ late: true });
    await Promise.resolve();
    expect(later).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  } finally {
    stops.forEach((stop) => stop());
  }
});

it("uses an inspected live control id and verifies its actual output before completing a demonstration", async () => {
  const api = sceneAPI();
  const stop = registerCanvasCommands(api);
  const { ids } = (await classroomCommands.execute({
    name: "canvas.resource",
    args: { resource: interactiveResource },
  })) as { ids: string[] };
  const resource = api.getSceneElements().find((item) => item.id === ids[0])!
    .customData!.fcInteractiveResource;
  const frame = resourceFrame({
    id: ids[0],
    surface: "whiteboard",
    html: resource.html,
  });
  frame.loaded();
  const controller = new AbortController();
  const chat = vi
    .spyOn(ai, "chat")
    .mockImplementationOnce(async (messages) => {
      const content = String(messages.at(-1)?.content);
      const { results } = JSON.parse(
        content.slice(content.indexOf("\n") + 1),
      ) as { results: { ok: boolean; result: ResourceControlState }[] };
      expect(results[0].ok).toBe(true);
      const state = results[0].result;
      expect(state.outputs).toEqual(["2 m/s²"]);
      const force = state.controls.find((item) => item.type === "range")!;
      return JSON.stringify({
        action: "commands",
        continue: true,
        commands: [
          {
            name: "resources.interact",
            args: {
              id: ids[0],
              version: state.version,
              control: force.id,
              action: "set",
              value: 10,
            },
          },
        ],
      });
    })
    .mockImplementationOnce(async (messages) => {
      expect(String(messages.at(-1)?.content)).toContain(
        '"outputs":["5 m/s²"]',
      );
      expect(
        frame.window.document.querySelector("#block")?.getAttribute("x"),
      ).toBe("150");
      return '{"action":"done"}';
    });
  try {
    await expect(
      runBoardCommands(
        {
          action: "commands",
          continue: true,
          commands: [{ name: "resources.inspect", args: { id: ids[0] } }],
        },
        [],
        controller.signal,
        () => true,
      ),
    ).resolves.toEqual({ action: "done" });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(frame.post).toHaveBeenCalledTimes(2);
  } finally {
    frame.dispose();
    stop();
  }
});

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
    ).rejects.toThrow(
      t(
        "fcboard.ai_requested_an_unavailable_action_please_rephrase_your_request",
      ),
    );
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
      t(
        "fcboard.observation_limit_reached_completed_work_is_preserved_describe_the_next_step_to_continue",
      ),
    );
    expect(chat).toHaveBeenCalledTimes(5);
    expect(chat.mock.calls[0][0][1].content).toContain("未找到控件");
  } finally {
    stop();
  }
});
