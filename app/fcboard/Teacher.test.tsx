import { act, waitFor } from "@testing-library/react";
import { getDefaultAppState } from "@fcboard/fcboard/appState";
import { convertToFcboardElements } from "@fcboard/fcboard";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { Teacher } from "./Teacher";
import { render } from "./test/render";
import { classroomCommands } from "./commands";
import { TeachingEngine } from "./teaching";
import * as ai from "./ai";
import { defaults, saveSettings } from "./settings";

vi.mock("./materials", () => ({ searchMaterials: async () => [] }));
vi.mock("./lessonObserver", () => ({ observeLesson: async () => undefined }));

const lesson = (
  tools: { name: string; args?: Record<string, unknown> }[] = [],
) => ({
  action: "lesson",
  lesson: {
    title: "visible lesson",
    steps: [{ say: "", tools, commands: [] }],
    quiz: [],
  },
});
const setup = () => {
  let pointer = () => {};
  const api = {
    id: "teacher-owner",
    getAppState: () => ({ ...getDefaultAppState(), width: 1600, height: 900 }),
    getSceneElements: () => [],
    getFiles: () => ({}),
    updateScene: vi.fn(),
    onPointerDown: (listener: () => void) => {
      pointer = listener;
      return () => {
        pointer = () => {};
      };
    },
  } as unknown as FcboardImperativeAPI;
  localStorage.setItem(
    "fcboard-teaching",
    JSON.stringify({ lens: "captions" }),
  );
  vi.spyOn(ai, "boardContext").mockResolvedValue({
    elements: [],
    text: "question",
    image: undefined,
  });
  const chat = vi.spyOn(ai, "chat");
  const view = render(<Teacher api={api} onCommand={vi.fn()} />);
  return { api, chat, view, pointer: () => pointer() };
};

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem("fcboard-teaching");
  saveSettings(defaults, false);
});

it.each([false, true])(
  "respects selected lesson screenshot attachment setting=%s",
  async (selectionImages) => {
    saveSettings({ ...defaults, selectionImages }, false);
    const { api, chat, view } = setup();
    const source = convertToFcboardElements([
      { type: "text", text: "selected question", x: 100, y: 100 },
    ]);
    vi.spyOn(api, "getSceneElements").mockReturnValue(source);
    vi.mocked(ai.boardContext).mockResolvedValue({
      elements: source,
      text: "selected question",
      image: "data:image/png;base64,selected",
    });
    chat.mockResolvedValue(JSON.stringify(lesson()));
    try {
      await act(async () => {
        await classroomCommands.execute({
          name: "lesson.teach",
          args: { prompt: "teach selected", sourceIds: [source[0].id] },
        });
      });
      const content = chat.mock.calls[0][0][1].content;
      expect(ai.boardContext).toHaveBeenCalledWith(
        api,
        false,
        source,
        undefined,
        selectionImages,
      );
      expect(Array.isArray(content)).toBe(selectionImages);
      expect(
        JSON.stringify(content).includes("data:image/png;base64,selected"),
      ).toBe(selectionImages);
    } finally {
      view.unmount();
    }
  },
);

it("keeps only its own synthetic pointer interaction from pausing a lesson", async () => {
  const { chat, view, pointer } = setup();
  chat.mockResolvedValue(JSON.stringify(lesson([{ name: "ui.interact" }])));
  const pause = vi.spyOn(TeachingEngine.prototype, "pause");
  let tested = false;
  const stop = classroomCommands.register("ui.interact", "interact", (args) => {
    if (tested) {
      return;
    }
    tested = true;
    const calls = pause.mock.calls.length;
    const owner = args.signal as AbortSignal;
    classroomCommands.withInteraction(owner, pointer);
    expect(pause).toHaveBeenCalledTimes(calls);
    classroomCommands.withInteraction(new AbortController().signal, pointer);
    expect(pause).toHaveBeenCalledTimes(calls + 1);
    void classroomCommands.execute({ name: "lesson.resume" });
    pointer();
    expect(pause).toHaveBeenCalledTimes(calls + 2);
    void classroomCommands.execute({ name: "lesson.resume" });
    expect(owner.aborted).toBe(true);
  });
  try {
    await act(async () => {
      await classroomCommands.execute({
        name: "lesson.teach",
        args: { prompt: "teach" },
      });
    });
    await waitFor(() =>
      expect(classroomCommands.read("teacher")).toMatchObject({
        mode: "complete",
      }),
    );
  } finally {
    view.unmount();
    stop();
  }
});

it("continues teacher preparation across its planned transition, while a manual transition cancels the next request", async () => {
  const { chat, view } = setup();
  const owners: AbortSignal[] = [];
  const stop = classroomCommands.register("files.open", "open", (args) => {
    const owner = args.signal as AbortSignal;
    owners.push(owner);
    classroomCommands.invalidate(owner);
    expect(owner.aborted).toBe(false);
  });
  chat
    .mockResolvedValueOnce(
      JSON.stringify({
        action: "commands",
        commands: [{ name: "files.open", args: { name: "lesson.pdf" } }],
        continue: true,
      }),
    )
    .mockResolvedValueOnce(JSON.stringify(lesson()));
  try {
    await act(async () => {
      await classroomCommands.execute({
        name: "lesson.teach",
        args: { prompt: "open then teach" },
      });
    });
    await waitFor(() =>
      expect(classroomCommands.read("teacher")).toMatchObject({
        mode: "complete",
      }),
    );
    expect(owners).toHaveLength(1);
    expect(chat).toHaveBeenCalledTimes(2);
    let finish!: (value: string) => void;
    chat.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    let pending!: Promise<unknown>;
    act(() => {
      pending = classroomCommands.execute({
        name: "lesson.teach",
        args: { prompt: "wait" },
      });
    });
    await waitFor(() => expect(chat).toHaveBeenCalledTimes(3));
    const current = chat.mock.calls[2][1]!;
    act(() => classroomCommands.invalidate());
    expect(current.aborted).toBe(true);
    await act(async () => {
      finish(JSON.stringify(lesson()));
      await pending;
    });
    expect(classroomCommands.read("teacher")).toMatchObject({ mode: "idle" });
  } finally {
    view.unmount();
    stop();
  }
});
