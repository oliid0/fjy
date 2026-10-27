import { waitFor } from "@testing-library/react";

import type { ResourceControlState } from "@excalidraw/excalidraw/interactiveResourceControls";

import { TeachingEngine, lessonSessions, saveLessonSession } from "./teaching";
import { validateLesson } from "./lesson";
import { classroomCommands } from "./commands";
import { registerCanvasCommands } from "./canvasCommands";
import * as narration from "./narration";
import { sceneAPI } from "./test/scene";
import { resourceFrame } from "./test/resourceFrame";
import { interactiveResource } from "./test/interactiveResource";
import { observeLesson } from "./lessonObserver";
import { registerUICommands } from "./uiControls";
import * as ai from "./ai";

import type { LessonObserver } from "./lessonContinuation";
import type { Lesson } from "./lesson";

const playback = (observer?: LessonObserver) => {
  vi.spyOn(window, "matchMedia").mockImplementation((media) => ({
    matches: false,
    media,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  const speak = vi.fn(async (_text: string) => {});
  vi.spyOn(narration, "createNarrator").mockReturnValue({
    speak,
    finished: Promise.resolve(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(async () => {}),
  });
  const api = sceneAPI();
  const stop = registerCanvasCommands(api);
  const engine = new TeachingEngine(api, observer);
  return {
    api,
    engine,
    speak,
    stop: () => {
      engine.cancel();
      stop();
    },
  };
};
const strokes = [
  [
    [100, 180],
    [180, 180],
  ],
];
const experiment = async (host: ReturnType<typeof playback>) => {
  const { ids } = (await classroomCommands.execute({
    name: "canvas.resource",
    args: { resource: interactiveResource },
  })) as { ids: string[] };
  const resource = host.api
    .getSceneElements()
    .find((element) => element.id === ids[0])!.customData!
    .fcInteractiveResource;
  const frame = resourceFrame({
    id: ids[0],
    surface: "whiteboard",
    html: resource.html,
  });
  return { id: ids[0], frame };
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("repairs an outdated experiment check from real controls before speaking, without repeating the completed mutation", async () => {
  const host = playback(observeLesson);
  const { id, frame } = await experiment(host);
  frame.loaded();
  const observed = (await classroomCommands.execute({
    name: "resources.inspect",
    args: { id },
  })) as ResourceControlState;
  const force = observed.controls.find((control) => control.type === "range")!;
  let changed = false;
  const stop = host.engine.subscribe((state) => {
    if (!changed && state.toolIndex === 1) {
      changed = true;
      const input = frame.window.document.querySelector("input")!;
      input.value = "12";
      input.dispatchEvent(new frame.window.Event("input", { bubbles: true }));
    }
  });
  const execute = vi.spyOn(classroomCommands, "execute");
  const model = vi.spyOn(ai, "chat").mockImplementation(async (messages) => {
    const context = JSON.parse(String(messages.at(-1)?.content));
    expect(context.resources[0].state.outputs).toEqual(["6 m/s²"]);
    if (!context.error) {
      return '{"action":"keep"}';
    }
    expect(context.completedTools).toHaveLength(1);
    expect(context.results.at(-1)).toMatchObject({
      ok: false,
      result: { outputs: ["6 m/s²"] },
    });
    return JSON.stringify({
      action: "lesson",
      lesson: {
        steps: [
          {
            say: "At twelve newtons the acceleration is six.",
            tools: [
              {
                name: "resources.inspect",
                args: { id },
                expect: [{ path: "outputs.0", equals: "6 m/s²" }],
              },
            ],
            commands: [
              {
                type: "write_text",
                id: "acceleration",
                text: "a=6",
                duration: 0,
              },
            ],
          },
        ],
        quiz: [],
      },
    });
  });
  try {
    await host.engine.start(
      validateLesson({
        title: "Newton",
        instruction: "Explain Newton's second law",
        steps: [
          {
            say: "Outdated five.",
            tools: [
              {
                name: "resources.interact",
                args: {
                  id,
                  version: observed.version,
                  control: force.id,
                  action: "set",
                  value: 10,
                },
              },
              {
                name: "resources.inspect",
                args: { id },
                expect: [{ path: "outputs.0", equals: "5 m/s²" }],
              },
            ],
            commands: [
              {
                type: "write_text",
                id: "acceleration",
                text: "a=5",
                duration: 0,
              },
            ],
          },
        ],
        quiz: [],
      }),
    );
    expect(model).toHaveBeenCalledTimes(2);
    expect(
      execute.mock.calls.filter(
        ([command]) => command.name === "resources.interact",
      ),
    ).toHaveLength(1);
    expect(host.speak).toHaveBeenCalledWith(
      "At twelve newtons the acceleration is six.",
      expect.anything(),
    );
    expect(host.speak).not.toHaveBeenCalledWith(
      "Outdated five.",
      expect.anything(),
    );
    expect(host.engine.state).toMatchObject({
      mode: "complete",
      toolIndex: 2,
      toolError: "",
    });
    expect(
      host.api
        .getSceneElements()
        .some((item) => item.customData?.fcWrittenText === "a=6"),
    ).toBe(true);
    expect(frame.window.document.querySelector("input")?.value).toBe("12");
  } finally {
    stop();
    frame.dispose();
    host.stop();
  }
});

it("refreshes an experiment changed while the model was thinking instead of narrating its old measurement", async () => {
  const host = playback(observeLesson);
  const { frame } = await experiment(host);
  frame.loaded();
  let finish!: (response: string) => void;
  const model = vi
    .spyOn(ai, "chat")
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockImplementationOnce(async (messages) => {
      expect(
        JSON.parse(String(messages.at(-1)?.content)).resources[0].state.outputs,
      ).toEqual(["6 m/s²"]);
      return JSON.stringify({
        action: "lesson",
        lesson: {
          steps: [{ say: "The observed acceleration is six.", commands: [] }],
          quiz: [],
        },
      });
    });
  const finished = host.engine.start(
    validateLesson({
      steps: [{ say: "Old measurement two.", commands: [] }],
      quiz: [],
    }),
  );
  try {
    await waitFor(() => expect(model).toHaveBeenCalledTimes(1));
    const input = frame.window.document.querySelector("input")!;
    input.value = "12";
    input.dispatchEvent(new frame.window.Event("input", { bubbles: true }));
    finish('{"action":"keep"}');
    await finished;
    expect(model).toHaveBeenCalledTimes(2);
    expect(host.speak).toHaveBeenCalledWith(
      "The observed acceleration is six.",
      expect.anything(),
    );
    expect(host.speak).not.toHaveBeenCalledWith(
      "Old measurement two.",
      expect.anything(),
    );
  } finally {
    frame.dispose();
    host.stop();
    await finished.catch(() => {});
  }
});

it.each(["pause", "cancel"])(
  "releases a pending uncooperative observation on %s and discards its late plan",
  async (action) => {
    let deliver!: (lesson: Lesson) => void;
    const observer = vi
      .fn<LessonObserver>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            deliver = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const host = playback(observer);
    const finished = host.engine.start(
      validateLesson({
        steps: [{ say: "Current lesson.", commands: [] }],
        quiz: [],
      }),
    );
    const ended = finished.catch((failure) => failure);
    try {
      await waitFor(() => expect(observer).toHaveBeenCalledTimes(1));
      if (action === "pause") {
        host.engine.pause();
        host.engine.resume();
      } else {
        host.engine.cancel();
      }
      expect(observer.mock.calls[0][1].aborted).toBe(true);
      const result = await ended;
      if (action === "pause") {
        expect(observer).toHaveBeenCalledTimes(2);
        expect(host.engine.state.mode).toBe("complete");
      } else {
        expect(result).toMatchObject({ name: "AbortError" });
        expect(host.speak).not.toHaveBeenCalled();
      }
      deliver(
        validateLesson({
          steps: [
            {
              say: "Late response.",
              commands: [
                { type: "write_text", text: "late", id: "late", duration: 0 },
              ],
            },
          ],
          quiz: [],
        }),
      );
      await Promise.resolve();
      expect(
        host.api
          .getSceneElements()
          .some((item) => item.customData?.fcWrittenText === "late"),
      ).toBe(false);
    } finally {
      host.stop();
      await ended;
    }
  },
);

it("rejects a model mutation in the observation read loop before it changes a live experiment", async () => {
  const host = playback();
  const { id, frame } = await experiment(host);
  frame.loaded();
  const state = (await classroomCommands.execute({
    name: "resources.inspect",
    args: { id },
  })) as ResourceControlState;
  const force = state.controls.find((control) => control.type === "range")!;
  vi.spyOn(ai, "chat").mockResolvedValue(
    JSON.stringify({
      action: "commands",
      commands: [
        {
          name: "resources.interact",
          args: {
            id,
            version: state.version,
            control: force.id,
            action: "set",
            value: 18,
          },
        },
      ],
      continue: true,
    }),
  );
  const execute = vi.spyOn(classroomCommands, "execute");
  try {
    await expect(
      observeLesson(
        {
          lesson: validateLesson({ steps: [{ commands: [] }], quiz: [] }),
          step: 0,
          toolIndex: 0,
          results: [],
          correct: 0,
          attempts: 0,
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(
      execute.mock.calls.some(
        ([command]) => command.name === "resources.interact",
      ),
    ).toBe(false);
    expect(frame.window.document.querySelector("input")?.value).toBe("4");
  } finally {
    frame.dispose();
    host.stop();
  }
});

it.each(["web.action", "signal.action"])(
  "does not allow %s mutations during the read-only lesson planning pass",
  async (name) => {
    const host = playback();
    const mutate = vi.fn();
    const release = classroomCommands.register(name, "control", mutate);
    vi.spyOn(ai, "chat").mockResolvedValue(
      JSON.stringify({
        action: "commands",
        commands: [{ name, args: { action: "close" } }],
      }),
    );
    try {
      await expect(
        observeLesson(
          {
            lesson: validateLesson({ steps: [{ commands: [] }], quiz: [] }),
            step: 0,
            toolIndex: 0,
            results: [],
            correct: 0,
            attempts: 0,
          },
          new AbortController().signal,
        ),
      ).rejects.toThrow();
      expect(mutate).not.toHaveBeenCalled();
    } finally {
      release();
      host.stop();
    }
  },
);

it("observes the real UI and rejects a plan when its controls change while the model is responding", async () => {
  const host = playback();
  let value = "hard";
  const release = classroomCommands.register(
    "ui.inspect",
    "inspect UI",
    () => ({ version: value, controls: [{ id: "pen", value }] }),
  );
  vi.spyOn(ai, "chat").mockImplementation(async (messages) => {
    expect(
      JSON.parse(String(messages.at(-1)?.content)).ui.controls[0].value,
    ).toBe("hard");
    value = "brush";
    return '{"action":"keep"}';
  });
  try {
    await expect(
      observeLesson(
        {
          lesson: validateLesson({ steps: [{ commands: [] }], quiz: [] }),
          step: 0,
          toolIndex: 0,
          results: [],
          correct: 0,
          attempts: 0,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  } finally {
    release();
    host.stop();
  }
});

it.each([
  "layout",
  "value",
  "disabled",
  "visibility",
  "identity",
  "outputs",
  "scope",
  "semantic version",
])(
  "treats UI %s changes according to their effect on the observed lesson",
  async (change) => {
    const host = playback();
    const ui = {
      version: "semantic:1",
      scope: "visible-board",
      controls: [
        {
          id: "pen",
          value: "hard",
          disabled: false,
          rect: { x: 10, y: 20, width: 50, height: 30 },
        },
      ],
      outputs: ["ready"],
    };
    const release = classroomCommands.register("ui.inspect", "inspect UI", () =>
      structuredClone(ui),
    );
    vi.spyOn(ai, "chat").mockImplementation(async () => {
      if (change === "layout") {
        ui.controls[0].rect.x += 100;
      }
      if (change === "value") {
        ui.controls[0].value = "brush";
      }
      if (change === "disabled") {
        ui.controls[0].disabled = true;
      }
      if (change === "visibility") {
        ui.controls = [];
      }
      if (change === "identity") {
        ui.controls[0].id = "replacement";
      }
      if (change === "outputs") {
        ui.outputs = ["changed"];
      }
      if (change === "scope") {
        ui.scope = "other-board";
      }
      if (change === "semantic version") {
        ui.version = "semantic:2";
      }
      return '{"action":"keep"}';
    });
    try {
      const observe = observeLesson(
        {
          lesson: validateLesson({ steps: [{ commands: [] }], quiz: [] }),
          step: 0,
          toolIndex: 0,
          results: [],
          correct: 0,
          attempts: 0,
        },
        new AbortController().signal,
      );
      if (change === "layout") {
        await expect(observe).resolves.toBeUndefined();
      } else {
        await expect(observe).rejects.toMatchObject({ name: "AbortError" });
      }
    } finally {
      release();
      host.stop();
    }
  },
);

it("continues both experiment steps when app controls move during observation without retrying or replaying the setter", async () => {
  const host = playback(observeLesson);
  const { id, frame } = await experiment(host);
  frame.loaded();
  const state = (await classroomCommands.execute({
    name: "resources.inspect",
    args: { id },
  })) as ResourceControlState;
  const force = state.controls.find((control) => control.type === "range")!;
  const root = document.createElement("div");
  const button = document.createElement("button");
  button.textContent = "Open app controls";
  root.append(button);
  document.body.append(root);
  let left = 20;
  vi.spyOn(button, "getBoundingClientRect").mockImplementation(() => ({
    x: left,
    y: 20,
    left,
    top: 20,
    right: left + 120,
    bottom: 56,
    width: 120,
    height: 36,
    toJSON: () => ({}),
  }));
  const stopUI = registerUICommands(host.api, () => root);
  const execute = vi.spyOn(classroomCommands, "execute");
  const chat = vi.spyOn(ai, "chat").mockImplementation(async (messages) => {
    const observation = JSON.parse(String(messages.at(-1)?.content));
    expect(observation.resources[0].state.outputs).toEqual([
      observation.completedSteps.length === 0 ? "2 m/s²" : "5 m/s²",
    ]);
    left += 30;
    return '{"action":"keep"}';
  });
  try {
    await host.engine.start(
      validateLesson({
        title: "Newton's second law",
        steps: [
          {
            say: "First observe four newtons.",
            commands: [],
            tools: [
              {
                name: "resources.inspect",
                args: { id },
                expect: [{ path: "outputs.0", equals: "2 m/s²" }],
              },
            ],
          },
          {
            say: "Ten newtons produce five meters per second squared.",
            commands: [],
            tools: [
              {
                name: "resources.interact",
                args: {
                  id,
                  version: state.version,
                  control: force.id,
                  action: "set",
                  value: 10,
                },
              },
              {
                name: "resources.inspect",
                args: { id },
                expect: [{ path: "outputs.0", equals: "5 m/s²" }],
              },
            ],
          },
        ],
        quiz: [],
      }),
    );
    expect(host.engine.state.mode).toBe("complete");
    expect(chat).toHaveBeenCalledTimes(2);
    expect(host.speak).toHaveBeenCalledWith("First observe four newtons.", {
      rate: 1,
      onBoundary: expect.any(Function),
    });
    expect(host.speak).toHaveBeenCalledWith(
      "Ten newtons produce five meters per second squared.",
      { rate: 1, onBoundary: expect.any(Function) },
    );
    expect(
      execute.mock.calls.filter(
        ([command]) => command.name === "resources.interact",
      ),
    ).toHaveLength(1);
    expect(frame.window.document.querySelector("output")?.textContent).toBe(
      "5 m/s²",
    );
  } finally {
    stopUI();
    root.remove();
    frame.dispose();
    host.stop();
  }
});

it("changes the live experiment and verifies its output before narration, then writes through the existing lesson renderer", async () => {
  const host = playback();
  const { id, frame } = await experiment(host);
  frame.loaded();
  try {
    const observed = (await classroomCommands.execute({
      name: "resources.inspect",
      args: { id },
    })) as ResourceControlState;
    const force = observed.controls.find(
      (control) => control.type === "range",
    )!;
    host.speak.mockImplementation(async () => {
      expect(frame.window.document.querySelector("output")?.textContent).toBe(
        "5 m/s²",
      );
      expect(
        frame.window.document.querySelector("#block")?.getAttribute("x"),
      ).toBe("150");
      expect(host.engine.state.toolResults.map((tool) => tool.ok)).toEqual([
        true,
        true,
      ]);
    });
    await host.engine.start(
      validateLesson({
        steps: [
          {
            say: "At ten newtons, acceleration is five metres per second squared.",
            tools: [
              {
                name: "resources.interact",
                args: {
                  id,
                  version: observed.version,
                  control: force.id,
                  action: "set",
                  value: 10,
                },
              },
              {
                name: "resources.inspect",
                args: { id },
                expect: [{ path: "outputs.0", equals: "5 m/s²" }],
              },
            ],
            commands: [
              {
                type: "write_text",
                id: "acceleration",
                text: "a = 5 m/s²",
                duration: 0,
              },
            ],
          },
        ],
        quiz: [],
      }),
    );
    expect(host.engine.state.mode).toBe("complete");
    expect(host.speak).toHaveBeenCalledTimes(1);
    expect(
      host.api
        .getSceneElements()
        .some(
          (element) => element.type === "text" && element.text === "a = 5 m/s²",
        ),
    ).toBe(true);
    expect(
      host.api
        .getSceneElements()
        .filter((element) => element.type === "iframe"),
    ).toHaveLength(1);
  } finally {
    frame.dispose();
    host.stop();
  }
});

it("pauses on a measured mismatch before speech/drawing and retries only the inspection after correction", async () => {
  const host = playback();
  const { id, frame } = await experiment(host);
  frame.loaded();
  const finished = host.engine.start(
    validateLesson({
      steps: [
        {
          say: "The measured acceleration is five.",
          tools: [
            { name: "canvas.ink", args: { strokes } },
            {
              name: "resources.inspect",
              args: { id },
              expect: [{ path: "outputs.0", equals: "5 m/s²" }],
            },
          ],
          commands: [{ type: "write_text", text: "Verified", duration: 0 }],
        },
      ],
    }),
  );
  try {
    await waitFor(() => expect(host.engine.state.mode).toBe("paused"));
    expect(host.engine.state.caption).toBe("");
    expect(host.engine.state.toolError).toBeTruthy();
    expect(host.engine.state.toolResults[1]).toMatchObject({
      ok: false,
      result: { outputs: ["2 m/s²"] },
      error: "LESSON_RESULT_MISMATCH: outputs.0",
    });
    expect(host.speak).not.toHaveBeenCalled();
    expect(
      host.api
        .getSceneElements()
        .filter((element) => element.type === "freedraw"),
    ).toHaveLength(1);
    expect(
      host.api
        .getSceneElements()
        .some(
          (element) => element.type === "text" && element.text === "Verified",
        ),
    ).toBe(false);
    const input = frame.window.document.querySelector("input")!;
    input.value = "10";
    input.dispatchEvent(new frame.window.Event("input", { bubbles: true }));
    host.engine.resume();
    await finished;
    expect(host.engine.state.mode).toBe("complete");
    expect(host.engine.state.toolError).toBe("");
    expect(host.speak).toHaveBeenCalledTimes(1);
    expect(
      host.api
        .getSceneElements()
        .filter(
          (element) =>
            element.type === "freedraw" && !element.customData?.fcLessonId,
        ),
    ).toHaveLength(1);
  } finally {
    frame.dispose();
    host.stop();
    await finished.catch(() => {});
  }
});

it("can pause an iframe load without a late action and resume that unfinished tool", async () => {
  const host = playback();
  const { id, frame } = await experiment(host);
  const finished = host.engine.start(
    validateLesson({
      steps: [
        {
          say: "Ready.",
          commands: [],
          tools: [{ name: "resources.inspect", args: { id } }],
        },
      ],
    }),
  );
  try {
    await waitFor(() =>
      expect(host.engine.state.tool?.name).toBe("resources.inspect"),
    );
    host.engine.pause();
    frame.loaded();
    await Promise.resolve();
    expect(frame.post).not.toHaveBeenCalled();
    expect(host.speak).not.toHaveBeenCalled();
    host.engine.resume();
    await finished;
    expect(host.engine.state.mode).toBe("complete");
    expect(frame.post).toHaveBeenCalledTimes(1);
  } finally {
    frame.dispose();
    host.stop();
    await finished.catch(() => {});
  }
});

it("cancels a pending tool promptly and never continues its later writes", async () => {
  const host = playback();
  const { id, frame } = await experiment(host);
  const finished = host.engine
    .start(
      validateLesson({
        steps: [
          {
            say: "Should never play.",
            commands: [],
            tools: [
              { name: "resources.inspect", args: { id } },
              { name: "canvas.ink", args: { strokes } },
            ],
          },
        ],
      }),
    )
    .catch((error) => error);
  try {
    await waitFor(() => expect(host.engine.state.tool).toBeDefined());
    host.engine.cancel();
    expect(await finished).toMatchObject({ name: "AbortError" });
    frame.loaded();
    expect(frame.post).not.toHaveBeenCalled();
    expect(host.speak).not.toHaveBeenCalled();
    expect(
      host.api
        .getSceneElements()
        .some((element) => element.type === "freedraw"),
    ).toBe(false);
    expect(host.engine.state.mode).toBe("idle");
  } finally {
    frame.dispose();
    host.stop();
  }
});

it("preserves completed actions across a failed tool and explicit retry", async () => {
  const host = playback();
  const prepare = vi
    .fn()
    .mockRejectedValueOnce(new Error("temporary failure"))
    .mockResolvedValue({ ready: true });
  const release = classroomCommands.register(
    "test.prepare",
    "prepare",
    prepare,
  );
  const finished = host.engine.start(
    validateLesson({
      steps: [
        {
          say: "Prepared.",
          commands: [],
          tools: [
            { name: "canvas.ink", args: { strokes } },
            { name: "test.prepare" },
          ],
        },
      ],
    }),
  );
  try {
    await waitFor(() => expect(host.engine.state.mode).toBe("paused"));
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(host.speak).not.toHaveBeenCalled();
    host.engine.resume();
    await finished;
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(
      host.api
        .getSceneElements()
        .filter((element) => element.type === "freedraw"),
    ).toHaveLength(1);
    expect(host.engine.state.toolResults.map((item) => item.ok)).toEqual([
      true,
      true,
    ]);
  } finally {
    release();
    host.stop();
    await finished.catch(() => {});
  }
});

it("waits for an already dispatched non-cancellable tool on pause and never replays it", async () => {
  const host = playback();
  let deliver!: (value: unknown) => void;
  const pending = vi.fn(
    () =>
      new Promise((resolve) => {
        deliver = resolve;
      }),
  );
  const release = classroomCommands.register(
    "test.pending",
    "pending",
    pending,
  );
  const finished = host.engine.start(
    validateLesson({
      steps: [
        { say: "Ready.", commands: [], tools: [{ name: "test.pending" }] },
      ],
    }),
  );
  try {
    await waitFor(() => expect(deliver).toBeDefined());
    host.engine.pause();
    deliver({ ready: true });
    await Promise.resolve();
    expect(host.engine.state.mode).toBe("paused");
    expect(host.speak).not.toHaveBeenCalled();
    host.engine.resume();
    await finished;
    expect(pending).toHaveBeenCalledTimes(1);
    expect(host.speak).toHaveBeenCalledTimes(1);
  } finally {
    release();
    host.stop();
    await finished.catch(() => {});
  }
});

it("cancels an old question's pending tool when a new question replaces it", async () => {
  const host = playback();
  const main = host.engine
    .start(
      validateLesson({ steps: [{ say: "", commands: [{ type: "wait" }] }] }),
    )
    .catch((error) => error);
  let deliver!: (result: unknown) => void;
  const release = classroomCommands.register(
    "test.pending",
    "pending",
    () =>
      new Promise((resolve) => {
        deliver = resolve;
      }),
  );
  try {
    await waitFor(() => expect(host.engine.state.mode).toBe("paused"));
    const old = host.engine
      .branch(
        validateLesson({
          steps: [
            {
              say: "Old question.",
              commands: [],
              tools: [
                { name: "test.pending" },
                { name: "canvas.ink", args: { strokes } },
              ],
            },
          ],
        }),
      )
      .catch((error) => error);
    await waitFor(() => expect(deliver).toBeDefined());
    await host.engine.branch(
      validateLesson({
        steps: [
          {
            say: "New question.",
            commands: [],
            tools: [{ name: "canvas.ink", args: { strokes } }],
          },
        ],
      }),
    );
    expect(await old).toMatchObject({ name: "AbortError" });
    deliver({ ready: true });
    await Promise.resolve();
    expect(host.speak.mock.calls.map(([text]) => text)).toEqual([
      "New question.",
    ]);
    expect(
      host.api
        .getSceneElements()
        .filter((element) => element.type === "freedraw"),
    ).toHaveLength(1);
    host.engine.resume();
    await main;
    expect(host.engine.state.mode).toBe("complete");
  } finally {
    release();
    host.stop();
    await main;
  }
});

it("rejects a same-name document replacement before drawing or speaking on its new layer", async () => {
  const host = playback();
  let documentId = "course-one";
  let deliver!: (result: unknown) => void;
  const draw = vi.fn();
  const releases = [
    classroomCommands.context("document", () => ({
      id: documentId,
      name: "lesson.pdf",
      page: 1,
      ink: [],
    })),
    classroomCommands.register("document.draw", "@internal", draw),
    classroomCommands.register(
      "test.pending",
      "pending",
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    ),
  ];
  const finished = host.engine
    .start(
      validateLesson({
        steps: [
          {
            say: "Old document.",
            commands: [{ type: "write_text", text: "Old", duration: 0 }],
            tools: [{ name: "test.pending" }],
          },
        ],
      }),
    )
    .catch((error) => error);
  try {
    await waitFor(() => expect(deliver).toBeDefined());
    documentId = "course-two";
    deliver({ ready: true });
    expect(await finished).toMatchObject({ name: "AbortError" });
    expect(host.speak).not.toHaveBeenCalled();
    expect(draw).not.toHaveBeenCalled();
    expect(host.engine.state.mode).toBe("idle");
    expect(host.api.updateScene).not.toHaveBeenCalled();
  } finally {
    releases.forEach((release) => release());
    host.stop();
  }
});

it("rejects unavailable/internal tools in a later step before any earlier edit", async () => {
  const host = playback();
  const internal = vi.fn();
  const release = classroomCommands.register(
    "test.internal",
    "@internal",
    internal,
  );
  try {
    await expect(
      host.engine.start(
        validateLesson({
          steps: [
            {
              say: "",
              commands: [],
              tools: [{ name: "canvas.ink", args: { strokes } }],
            },
            { say: "", commands: [], tools: [{ name: "test.internal" }] },
          ],
        }),
      ),
    ).rejects.toThrow();
    expect(host.api.updateScene).not.toHaveBeenCalled();
    expect(internal).not.toHaveBeenCalled();
  } finally {
    release();
    host.stop();
  }
});

it("persists the completed tool cursor and reopens without duplicating an inserted stroke", async () => {
  const host = playback();
  let ready = false;
  const read = vi.fn(() => ({ ready }));
  const release = classroomCommands.register(
    "resources.list",
    "read readiness",
    read,
  );
  const lesson = validateLesson({
    steps: [
      {
        say: "Ready.",
        commands: [],
        tools: [
          { name: "canvas.ink", args: { strokes } },
          { name: "resources.list", expect: [{ path: "ready", equals: true }] },
        ],
      },
    ],
  });
  const first = host.engine.start(lesson).catch((error) => error);
  try {
    await waitFor(() => expect(host.engine.state.mode).toBe("paused"));
    expect(host.engine.state.toolIndex).toBe(1);
    await saveLessonSession({
      id: "tool-cursor",
      board: "",
      lesson,
      step: 0,
      toolIndex: host.engine.state.toolIndex,
      correct: 0,
      attempts: 0,
      updated: Date.now(),
      canvas: host.engine.canvas!,
    });
    host.engine.cancel();
    expect(await first).toMatchObject({ name: "AbortError" });
    const saved = (await lessonSessions()).find(
      (session) => session.id === "tool-cursor",
    )!;
    expect(saved.toolIndex).toBe(1);
    ready = true;
    await host.engine.start(saved.lesson, saved.step, saved.canvas, saved);
    expect(host.engine.state.mode).toBe("complete");
    expect(host.engine.state.toolIndex).toBe(2);
    expect(
      host.api
        .getSceneElements()
        .filter((element) => element.type === "freedraw"),
    ).toHaveLength(1);
    expect(read).toHaveBeenCalledTimes(2);
    // Even a saved completed cursor must recheck its postcondition before repeating speech.
    ready = false;
    host.speak.mockClear();
    const reopened = host.engine
      .start(saved.lesson, saved.step, saved.canvas, { ...saved, toolIndex: 2 })
      .catch((error) => error);
    await waitFor(() => expect(host.engine.state.mode).toBe("paused"));
    expect(host.speak).not.toHaveBeenCalled();
    expect(
      host.api
        .getSceneElements()
        .filter((element) => element.type === "freedraw"),
    ).toHaveLength(1);
    host.engine.cancel();
    expect(await reopened).toMatchObject({ name: "AbortError" });
  } finally {
    release();
    host.stop();
    await first;
  }
});

it("does not narrate an old empty-tool question when immediately replaced", async () => {
  const host = playback();
  const main = host.engine
    .start(
      validateLesson({ steps: [{ say: "", commands: [{ type: "wait" }] }] }),
    )
    .catch((error) => error);
  try {
    await waitFor(() => expect(host.engine.state.mode).toBe("paused"));
    const old = host.engine
      .branch(
        validateLesson({ steps: [{ say: "Old question.", commands: [] }] }),
      )
      .catch((error) => error);
    await host.engine.branch(
      validateLesson({ steps: [{ say: "New question.", commands: [] }] }),
    );
    await old;
    expect(host.speak.mock.calls.map(([text]) => text)).toEqual([
      "New question.",
    ]);
  } finally {
    host.stop();
    await main;
  }
});

it("serializes progress saves and lets a new reader observe every queued cursor", async () => {
  const lesson = validateLesson({
    steps: [
      {
        say: "",
        commands: [],
        tools: Array.from({ length: 3 }, () => ({ name: "canvas.inspect" })),
      },
    ],
  });
  const base = {
    lesson,
    board: "",
    step: 0,
    correct: 0,
    attempts: 0,
    updated: Date.now(),
    canvas: { id: "canvas", origin: { x: 0, y: 0 } },
  };
  const first = saveLessonSession({ ...base, id: "queued-one", toolIndex: 1 });
  const second = saveLessonSession({ ...base, id: "queued-two", toolIndex: 2 });
  const third = saveLessonSession({ ...base, id: "queued-one", toolIndex: 3 });
  const sessions = await lessonSessions();
  expect(
    sessions.find((session) => session.id === "queued-one")?.toolIndex,
  ).toBe(3);
  expect(
    sessions.find((session) => session.id === "queued-two")?.toolIndex,
  ).toBe(2);
  await Promise.all([first, second, third]);
});

it("pauses a full board before narration and retries layout after space is made", async () => {
  const host = playback();
  const { convertToExcalidrawElements } = await import(
    "@excalidraw/excalidraw"
  );
  const obstacle = convertToExcalidrawElements([
    { type: "rectangle", x: 0, y: 0, width: 1600, height: 900 },
  ])[0];
  host.api.updateScene({
    elements: [...host.api.getSceneElements(), obstacle],
  });
  const finished = host.engine
    .start(
      validateLesson({
        steps: [
          {
            say: "Now there is room.",
            commands: [{ type: "write_text", text: "F=ma", duration: 0 }],
          },
        ],
      }),
    )
    .catch((error) => error);
  try {
    await waitFor(() => expect(host.engine.state.mode).toBe("paused"));
    expect(host.speak).not.toHaveBeenCalled();
    expect(
      host.api
        .getSceneElements()
        .filter((element) => element.customData?.fcLessonId),
    ).toHaveLength(0);
    host.api.updateScene({
      elements: host.api
        .getSceneElements()
        .filter((element) => element.id !== obstacle.id),
    });
    host.engine.resume();
    await finished;
    expect(host.speak).toHaveBeenCalledTimes(1);
    expect(host.engine.state.mode).toBe("complete");
  } finally {
    host.stop();
    await finished;
  }
});
