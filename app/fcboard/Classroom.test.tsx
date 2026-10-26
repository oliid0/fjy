import { t } from "@excalidraw/excalidraw/i18n";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { pointFrom } from "@excalidraw/math";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import type {
  DataURL,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { render } from "./test/render";
import { writeQuestion } from "./test/question";

import { Classroom } from "./Classroom";
import { SelectionActions } from "./SelectionActions";
import * as ai from "./ai";
import * as ocr from "./ocr";
import * as speech from "./speech";
import * as localSpeech from "./localSpeech";
import * as cloudSpeech from "./cloudSpeech";
import { classroomCommands } from "./commands";
import { BoardRecorder, loadRecordings, saveRecordings } from "./recording";
import { currentSettings, defaults, saveSettings } from "./settings";
import { handwritingText } from "./handwriting";
import { insertionDefaults, renderInsertion } from "./insertObjects";
import { documentSourceSignature } from "./documents";
import { validateQuestionInk } from "./questionInk";

import { readWidgets } from "./widgets";
import { lessonSessions } from "./teaching";

import type { InkStroke } from "./documents";

vi.mock("@excalidraw/excalidraw", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@excalidraw/excalidraw")>()),
  ToolbarExtras: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("./BoardSwitcher", () => ({ BoardSwitcher: () => null }));

describe("selection-driven classroom controls", () => {
  let scene: readonly ExcalidrawElement[];
  let api: ExcalidrawImperativeAPI;
  let selected: Record<string, boolean>;
  let change: Set<() => void>;
  let cursorButton: "up" | "down";
  const selectText = (text: string) => {
    scene = convertToExcalidrawElements([
      { type: "text", x: 100, y: 100, text },
    ]);
    selected = { [scene[0].id]: true };
  };
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:recording");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    scene = [];
    selected = {};
    change = new Set();
    cursorButton = "up";
    localStorage.clear();
    sessionStorage.clear();
    saveSettings(
      {
        ...defaults,
        model: "mock-visual-model",
        apiKey: "mock-key",
        answerStyle: "text",
      },
      false,
    );
    api = {
      getSceneElements: () => scene,
      getAppState: () => ({
        scrollX: 0,
        scrollY: 0,
        width: 1600,
        height: 900,
        zoom: { value: 1 },
        selectedElementIds: selected,
        activeTool: { type: "selection" },
        cursorButton,
      }),
      getFiles: () => ({}),
      onPointerDown: () => () => {},
      onPointerUp: () => () => {},
      updateScene: vi.fn((update) => {
        if (update.elements) {
          scene = update.elements;
        }
        if (update.appState?.selectedElementIds) {
          selected = update.appState.selectedElementIds;
        }
        change.forEach((listener) => listener());
      }),
      onChange: (
        listener: Parameters<ExcalidrawImperativeAPI["onChange"]>[0],
      ) => {
        const notify = () => listener(scene, api.getAppState(), {});
        change.add(notify);
        return () => change.delete(notify);
      },
    } as unknown as ExcalidrawImperativeAPI;
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([false, true])(
    "uses one handwriting question route with whole=%s and reads the current surface only on submission",
    async (whole) => {
      selectText("selected note");
      const read = vi.spyOn(ai, "boardContext").mockResolvedValue({
        elements: scene,
        text: "Current visible notes",
        image: undefined,
      });
      vi.spyOn(ocr, "warmHandwriting").mockResolvedValue(undefined);
      vi.spyOn(ocr, "recognizeHandwriting").mockResolvedValue(
        "Describe the idea",
      );
      const chat = vi
        .spyOn(ai, "chat")
        .mockResolvedValue(
          JSON.stringify({ action: "text", text: "The current idea" }),
        );
      render(<Classroom api={api} />);
      await act(async () => {
        await classroomCommands.execute({
          name: "assistant.open",
          args: { whole },
        });
      });
      expect(
        screen.getByRole("dialog", { name: t("fcboard.handwritten_question") }),
      ).toBeVisible();
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(
        screen.queryByRole("dialog", { name: t("fcboard.ai_assistant") }),
      ).toBeNull();
      expect(read).not.toHaveBeenCalled();
      await act(async () => {
        await classroomCommands.execute({ name: "panel.close" });
      });
      expect(
        screen.queryByRole("dialog", {
          name: t("fcboard.handwritten_question"),
        }),
      ).toBeNull();
      await act(async () => {
        await classroomCommands.execute({
          name: "assistant.open",
          args: { whole },
        });
      });
      read.mockResolvedValue({
        elements: scene,
        text: "Notes changed while writing the question",
        image: undefined,
      });
      writeQuestion();
      fireEvent.click(
        screen.getByRole("button", { name: t("fcboard.send_question") }),
      );
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: t("fcboard.collapse_answer") }),
        ).toBeEnabled(),
      );
      expect(read).toHaveBeenCalledWith(api, whole);
      expect(JSON.stringify(chat.mock.calls[0][0])).toContain(
        "Notes changed while writing the question",
      );
      expect(scene.some((element) => element.customData?.fcGenerated)).toBe(
        true,
      );
      fireEvent.click(
        screen.getByRole("button", { name: t("fcboard.hide_question_input") }),
      );
      await act(async () => {
        await classroomCommands.execute({ name: "assistant.open" });
      });
      expect(screen.queryByRole("textbox")).toBeNull();
      read.mockClear();
      writeQuestion();
      fireEvent.click(
        screen.getByRole("button", { name: t("fcboard.send_question") }),
      );
      await waitFor(() => expect(read).toHaveBeenCalledWith(api, false));
    },
  );

  it("exposes one question command without the legacy capture and AI panel aliases", async () => {
    render(<Classroom api={api} />);
    expect(classroomCommands.has("assistant.open")).toBe(true);
    expect(classroomCommands.has("canvas.capture")).toBe(false);
    await expect(
      classroomCommands.execute({ name: "panel.open", args: { panel: "ai" } }),
    ).rejects.toThrow();
    expect(
      screen.queryByRole("dialog", { name: t("fcboard.handwritten_question") }),
    ).toBeNull();
  });

  it.each(["1+1=", "1+1"])(
    "answers a handwritten %s locally beside its ink while preserving the previous selection",
    async (expression) => {
      selectText("previous selection");
      const original = scene[0];
      vi.spyOn(ocr, "recognizeHandwriting").mockResolvedValue(expression);
      const chat = vi.spyOn(ai, "chat");
      render(<Classroom api={api} />);
      await act(async () => {
        await classroomCommands.execute({ name: "assistant.open" });
      });
      writeQuestion();
      fireEvent.click(
        screen.getByRole("button", { name: t("fcboard.send_question") }),
      );
      await waitFor(() =>
        expect(handwritingText(scene)).toContain(
          expression.endsWith("=") ? "2" : "= 2",
        ),
      );
      expect(chat).not.toHaveBeenCalled();
      expect(selected).toEqual({ [original.id]: true });
      const answer = scene.find((element) => element.customData?.fcWrittenText);
      expect(answer!.x).toBeGreaterThan(500);
      expect(answer!.y).toBeGreaterThanOrEqual(300);
      expect(scene.find((element) => element.id === original.id)).toBe(
        original,
      );
    },
  );

  it("summarizes the entire current board in a centered dialog and toggles summary full screen without writing the scene", async () => {
    selectText("selected topic");
    const read = vi.spyOn(ai, "boardContext").mockResolvedValue({
      elements: scene,
      text: "whole board",
      image: undefined,
    });
    vi.spyOn(ai, "chat").mockResolvedValue("完整白板总结");
    render(<Classroom api={api} />);
    await act(async () => {
      await classroomCommands.execute({ name: "canvas.summary" });
    });
    expect(read).toHaveBeenCalledWith(api, true);
    expect(
      screen.getByRole("dialog", { name: t("fcboard.ai_summary") }),
    ).toHaveAttribute("aria-modal", "true");
    expect(api.updateScene).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", {
        name: t("fcboard.view_summary_full_screen"),
      }),
    );
    expect(
      screen.getByRole("button", {
        name: t("fcboard.exit_full_screen_summary"),
      }),
    ).toHaveTextContent("完整白板总结");
    fireEvent.click(
      screen.getByRole("button", {
        name: t("fcboard.exit_full_screen_summary"),
      }),
    );
    expect(
      screen.queryByRole("button", {
        name: t("fcboard.exit_full_screen_summary"),
      }),
    ).toBeNull();
    expect(
      screen.getByRole("button", {
        name: t("fcboard.view_summary_full_screen"),
      }),
    ).toBeVisible();
  });

  it("discards a handwritten question's pending answer if its actual ink changes", async () => {
    vi.spyOn(ocr, "recognizeHandwriting").mockResolvedValue(
      "这个题目的答案是什么？",
    );
    vi.spyOn(ai, "boardContext").mockResolvedValue({
      elements: [],
      text: "question",
      image: undefined,
    });
    let finish!: (value: string) => void;
    const chat = vi
      .spyOn(ai, "chat")
      .mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    render(<Classroom api={api} />);
    await act(async () => {
      await classroomCommands.execute({ name: "assistant.open" });
    });
    writeQuestion();
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.send_question") }),
    );
    await waitFor(() => expect(chat).toHaveBeenCalledTimes(1));
    act(() => {
      scene = scene.map((element) => ({
        ...element,
        x: element.x + 10,
        version: element.version + 1,
      }));
      change.forEach((notify) => notify());
    });
    expect(chat.mock.calls[0][1]?.aborted).toBe(true);
    await act(async () =>
      finish(JSON.stringify({ action: "text", text: "stale answer" })),
    );
    expect(
      scene.some(
        (element) =>
          element.customData?.fcWrittenText || element.type === "text",
      ),
    ).toBe(false);
  });

  it.each([
    ["cube", "front", 11],
    ["cylinder", "side", 3],
  ] as const)(
    "colors, unfolds, copies and deletes the complete %s through one selection row",
    async (kind, face, nets) => {
      api.setActiveTool = vi.fn();
      vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
        x: 300,
        y: 350,
        left: 300,
        top: 350,
        right: 344,
        bottom: 392,
        width: 44,
        height: 42,
        toJSON: () => ({}),
      });
      render(<Classroom api={api} />);
      await act(async () => {
        await classroomCommands.execute({
          name: "tools.insert",
          args: { kind },
        });
      });
      const original = readWidgets(api)[0].id;
      const row = () =>
        within(
          screen.getByRole("toolbar", { name: t("fcboard.selection_actions") }),
        );
      expect(
        screen.queryByRole("slider", { name: t("fcboard.rotation") }),
      ).toBeNull();
      fireEvent.click(
        row().getByRole("button", { name: t("fcboard.face_colors") }),
      );
      fireEvent.click(screen.getByRole("button", { name: "#ef4444" }));
      await waitFor(() =>
        expect(readWidgets(api)[0].params.solid.colors[face]).toBe("#ef4444"),
      );
      fireEvent.keyDown(
        screen.getByRole("dialog", { name: t("fcboard.face_colors") }),
        { key: "Escape" },
      );
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: t("fcboard.face_colors") }),
        ).toBeNull(),
      );
      fireEvent.click(
        row().getByRole("button", { name: t("fcboard.unfold_shape") }),
      );
      await waitFor(() =>
        expect(readWidgets(api)[0].params.solid.unfold).toBe(1),
      );
      fireEvent.click(
        row().getByRole("button", { name: t("fcboard.unfolding_nets") }),
      );
      fireEvent.click(
        screen.getByRole("button", {
          name: t("fcboard.net_index", { index: nets }),
        }),
      );
      await waitFor(() =>
        expect(readWidgets(api)[0].params.solid.net).toBe(nets - 1),
      );
      expect(readWidgets(api)[0].params.solid.colors[face]).toBe("#ef4444");
      expect(screen.getAllByRole("button", { name: "AI" })).toHaveLength(1);
      fireEvent.click(row().getByRole("button", { name: t("labels.copy") }));
      await waitFor(() => expect(readWidgets(api)).toHaveLength(2));
      const clone = readWidgets(api).find((widget) => widget.id !== original)!;
      expect(clone.params.solid.colors[face]).toBe("#ef4444");
      fireEvent.click(row().getByRole("button", { name: t("labels.delete") }));
      await waitFor(() =>
        expect(readWidgets(api).map((widget) => widget.id)).toEqual([original]),
      );
      expect(
        scene.some((element) => element.customData?.fcWidget?.id === clone.id),
      ).toBe(false);
    },
  );

  it.each(["sphere", "cone", "frustum", "prism", "pyramid"] as const)(
    "keeps %s as one factory-colored object with only its compact shape actions",
    async (kind) => {
      api.setActiveTool = vi.fn();
      const state = api.getAppState;
      vi.spyOn(api, "getAppState").mockImplementation(() => ({
        ...state(),
        currentItemStrokeColor: "#dc2626",
      }));
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
        left: 100,
        top: 100,
        right: 140,
        bottom: 140,
        width: 40,
        height: 40,
        x: 100,
        y: 100,
        toJSON: () => ({}),
      });
      render(<Classroom api={api} />);
      await act(async () => {
        await classroomCommands.execute({
          name: "tools.insert",
          args: { kind },
        });
      });
      expect(scene.length).toBeGreaterThan(1);
      expect(scene.every((element) => element.strokeColor === "#dc2626")).toBe(
        true,
      );
      expect(new Set(scene.map((element) => element.groupIds[0])).size).toBe(1);
      const row = within(
        screen.getByRole("toolbar", { name: t("fcboard.selection_actions") }),
      );
      expect(
        row.queryByRole("button", { name: t("fcboard.unfold_shape") }),
      ).toBeNull();
      fireEvent.click(
        row.getByRole("button", { name: t("fcboard.shape_color") }),
      );
      fireEvent.click(
        within(
          screen.getByRole("dialog", { name: t("fcboard.shape_color") }),
        ).getByRole("button", { name: "#17243c" }),
      );
      await waitFor(() =>
        expect(
          scene.every((element) => element.strokeColor === "#17243c"),
        ).toBe(true),
      );
      expect(
        screen.queryByRole("button", { name: t("fcboard.close_tool_panel") }),
      ).toBeNull();
    },
  );

  it.each(["local", "cloud", "system"] as const)(
    "keeps %s voice listening across consecutive turns until explicitly stopped",
    async (provider) => {
      saveSettings({ ...defaults, speech: provider }, false);
      let deliver!: (text: string) => void;
      const stop = vi.fn();
      const cancel = vi.fn().mockResolvedValue(undefined);
      const local = (
        provider === "cloud"
          ? vi.spyOn(cloudSpeech, "startCloudSpeech")
          : vi.spyOn(localSpeech, "startLocalSpeech")
      ).mockImplementation(async (onLine) => {
        deliver = (text) => onLine({ time: 0, text });
        return { stop: vi.fn().mockResolvedValue(undefined), cancel };
      });
      const system = vi
        .spyOn(speech, "startSystemSpeech")
        .mockImplementation(async (onText) => {
          deliver = onText;
          return stop;
        });
      const cloud = vi.spyOn(ai, "chat");
      const view = render(<Classroom api={api} />);
      const clear = vi.fn();
      const release = classroomCommands.register(
        "canvas.clear",
        "@internal",
        clear,
      );
      vi.useFakeTimers();
      try {
        await act(async () => {
          await classroomCommands.execute({ name: "voice.toggle" });
        });
        act(() => deliver("清空"));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2000);
        });
        act(() => deliver("白板"));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2999);
        });
        expect(clear).not.toHaveBeenCalled();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1);
        });
        expect(clear).toHaveBeenCalledTimes(1);
        expect(stop).not.toHaveBeenCalled();
        expect(cancel).not.toHaveBeenCalled();
        act(() => deliver("清空白板"));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3000);
        });
        expect(clear).toHaveBeenCalledTimes(2);
        act(() => deliver("写一个1+1=2"));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3000);
        });
        expect(handwritingText(scene)).toContain("1+1=2");
        expect(scene.every((element) => element.type === "freedraw")).toBe(
          true,
        );
        await act(async () => {
          await classroomCommands.execute({ name: "voice.toggle" });
        });
        act(() => deliver("清空白板"));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3000);
        });
        expect(clear).toHaveBeenCalledTimes(2);
        expect(cloud).not.toHaveBeenCalled();
        if (provider !== "system") {
          expect(local).toHaveBeenCalledTimes(1);
          expect(cancel).toHaveBeenCalledTimes(1);
          expect(system).not.toHaveBeenCalled();
        } else {
          expect(system).toHaveBeenCalledWith(
            expect.any(Function),
            expect.any(Function),
            true,
          );
          expect(stop).toHaveBeenCalledTimes(1);
          expect(local).not.toHaveBeenCalled();
        }
      } finally {
        view.unmount();
        release();
        vi.useRealTimers();
      }
    },
  );

  it("keeps the assistant speaking until real audio ends and voice.speak completes only then", async () => {
    saveSettings(
      {
        ...currentSettings(),
        speech: "local",
        ttsEndpoint: "https://voice.example.test/speech",
      },
      false,
    );
    const capture = {
      stop: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(localSpeech, "startLocalSpeech").mockResolvedValue(capture);
    const players: {
      onended?: () => void;
      pause: () => void;
      play: () => Promise<void>;
    }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(["wav"], { type: "audio/wav" }),
      }),
    );
    vi.stubGlobal(
      "Audio",
      class {
        pause = vi.fn();
        play = vi.fn().mockResolvedValue(undefined);
        constructor() {
          players.push(this);
        }
      },
    );
    const view = render(<Classroom api={api} />);
    let finished = false;
    let task!: Promise<unknown>;
    try {
      await act(async () => {
        await classroomCommands.execute({ name: "voice.toggle" });
      });
      await act(async () => {
        task = classroomCommands
          .execute({ name: "voice.speak", args: { text: "Actual reply" } })
          .then(() => {
            finished = true;
          });
      });
      expect(players).toHaveLength(1);
      expect(finished).toBe(false);
      expect(view.container.querySelector(".fc-voice-orb")).toHaveAttribute(
        "data-state",
        "speaking",
      );
      await act(async () => {
        players[0].onended?.();
        await task;
      });
      expect(finished).toBe(true);
      expect(view.container.querySelector(".fc-voice-orb")).toHaveAttribute(
        "data-state",
        "listening",
      );
      await act(async () => {
        await classroomCommands.execute({ name: "voice.toggle" });
      });
      expect(capture.cancel).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it("interrupts an uncooperative model immediately, keeps listening, and lets the next spoken command write without an old answer", async () => {
    saveSettings({ ...currentSettings(), speech: "cloud" }, false);
    let deliver!: (text: string) => void;
    const capture = {
      stop: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(cloudSpeech, "startCloudSpeech").mockImplementation(
      async (onLine) => {
        deliver = (text) => onLine({ time: 0, text });
        return capture;
      },
    );
    vi.spyOn(ai, "boardContext").mockResolvedValue({
      elements: [],
      text: "",
      image: undefined,
    });
    let reply!: (value: string) => void;
    const chat = vi.spyOn(ai, "chat").mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          reply = resolve;
        }),
    );
    const view = render(<Classroom api={api} />);
    vi.useFakeTimers();
    try {
      await act(async () => {
        await classroomCommands.execute({ name: "voice.toggle" });
      });
      act(() => deliver("重力是什么？"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(chat).toHaveBeenCalledTimes(1);
      const signal = chat.mock.calls[0][1]!;
      expect(signal.aborted).toBe(false);
      expect(view.container.querySelector(".fc-voice-orb")).toHaveAttribute(
        "data-state",
        "thinking",
      );
      act(() => deliver("停止"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(signal.aborted).toBe(true);
      expect(capture.cancel).not.toHaveBeenCalled();
      expect(view.container.querySelector(".fc-voice-orb")).toHaveAttribute(
        "data-state",
        "listening",
      );
      act(() => deliver("写一个2"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(handwritingText(scene)).toEqual(["2"]);
      await act(async () => {
        reply(JSON.stringify({ action: "text", text: "Old answer" }));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(handwritingText(scene)).toEqual(["2"]);
      expect(chat).toHaveBeenCalledTimes(1);
      expect(classroomCommands.read("classroom")).toMatchObject({
        listening: true,
      });
      await act(async () => {
        await classroomCommands.execute({ name: "voice.toggle" });
      });
      expect(capture.cancel).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it("keeps a turn through same-page context updates and drops it when the actual page changes", async () => {
    saveSettings({ ...defaults, speech: "local" }, false);
    let deliver!: (text: string) => void;
    const cancel = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(localSpeech, "startLocalSpeech").mockImplementation(
      async (onLine) => {
        deliver = (text) => onLine({ time: 0, text });
        return { stop: vi.fn().mockResolvedValue(undefined), cancel };
      },
    );
    const view = render(<Classroom api={api} />);
    const clear = vi.fn();
    let page = 1;
    const release = [
      classroomCommands.register("canvas.clear", "@internal", clear),
      classroomCommands.context("document", () => ({
        id: "course",
        page,
        ink: [],
      })),
    ];
    vi.useFakeTimers();
    try {
      await act(async () => {
        await classroomCommands.execute({ name: "voice.toggle" });
      });
      act(() => deliver("清空白板"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      act(() => {
        release[1]();
        release[1] = classroomCommands.context("document", () => ({
          id: "course",
          page,
          ink: [],
          pen: { color: "#123456" },
        }));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(clear).toHaveBeenCalledTimes(1);
      act(() => deliver("清空白板"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      act(() => {
        page = 2;
        classroomCommands.changed("document");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(clear).toHaveBeenCalledTimes(1);
      act(() => deliver("清空白板"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(clear).toHaveBeenCalledTimes(2);
      expect(cancel).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      release.forEach((stop) => stop());
      vi.useRealTimers();
    }
  });

  it("cancels capture that becomes ready after the user stopped listening", async () => {
    saveSettings({ ...defaults, speech: "local" }, false);
    let ready!: (handle: localSpeech.LocalSpeechHandle) => void;
    const cancel = vi.fn().mockResolvedValue(undefined);
    const start = vi.spyOn(localSpeech, "startLocalSpeech").mockImplementation(
      () =>
        new Promise((resolve) => {
          ready = resolve;
        }),
    );
    const view = render(<Classroom api={api} />);
    let starting!: Promise<unknown>;
    await act(async () => {
      starting = classroomCommands.execute({ name: "voice.toggle" });
      await Promise.resolve();
    });
    expect(start).toHaveBeenCalledTimes(1);
    await act(async () => {
      await classroomCommands.execute({ name: "voice.toggle" });
    });
    await act(async () => {
      ready({ stop: vi.fn().mockResolvedValue(undefined), cancel });
      await starting;
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it.each(["local", "cloud"] as const)(
    "shares %s recording transcription across multiple commands without restarting or stopping the microphone",
    async (provider) => {
      saveSettings({ ...defaults, speech: provider }, false);
      vi.spyOn(BoardRecorder.prototype, "start").mockResolvedValue(undefined);
      const shared = {} as MediaStream;
      vi.spyOn(BoardRecorder.prototype, "audioStream", "get").mockReturnValue(
        shared,
      );
      let deliver!: (text: string) => void;
      let fail!: (message: string) => void;
      const stop = vi.fn().mockResolvedValue(undefined);
      const cancel = vi.fn().mockResolvedValue(undefined);
      const start = (
        provider === "cloud"
          ? vi.spyOn(cloudSpeech, "startCloudSpeech")
          : vi.spyOn(localSpeech, "startLocalSpeech")
      ).mockImplementation(async (onLine, onError) => {
        deliver = (text) => onLine({ time: 0, text });
        fail = onError;
        return { stop, cancel };
      });
      const view = render(<Classroom api={api} />);
      const clear = vi.fn();
      const release = classroomCommands.register(
        "canvas.clear",
        "@internal",
        clear,
      );
      await act(async () => {
        await classroomCommands.execute({
          name: "record.start",
          args: { mode: "audio" },
        });
      });
      vi.useFakeTimers();
      try {
        await act(async () => {
          await classroomCommands.execute({ name: "voice.toggle" });
        });
        const onTranscript = deliver;
        for (let index = 0; index < 2; index++) {
          act(() => onTranscript("清空白板"));
          await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
          });
        }
        expect(clear).toHaveBeenCalledTimes(2);
        await act(async () => {
          await classroomCommands.execute({ name: "voice.toggle" });
        });
        act(() => deliver("清空白板"));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3000);
        });
        expect(clear).toHaveBeenCalledTimes(2);
        expect(start).toHaveBeenCalledTimes(1);
        expect(start.mock.calls[0][2]).toBe(shared);
        expect(stop).not.toHaveBeenCalled();
        expect(cancel).not.toHaveBeenCalled();
        if (provider === "cloud") {
          const fallback = vi
            .spyOn(speech, "startSystemSpeech")
            .mockImplementation(async (onText) => {
              deliver = onText;
              return vi.fn();
            });
          await act(async () => {
            fail("provider disconnected");
            await Promise.resolve();
            await Promise.resolve();
          });
          expect(fallback).toHaveBeenCalledTimes(1);
          await act(async () => {
            await classroomCommands.execute({ name: "voice.toggle" });
          });
          act(() => deliver("清空白板"));
          await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
          });
          expect(clear).toHaveBeenCalledTimes(3);
        } else {
          act(() => fail("provider disconnected"));
          await act(async () => {
            await expect(
              classroomCommands.execute({ name: "voice.toggle" }),
            ).rejects.toThrow(
              t(
                "fcboard.live_transcription_is_disconnected_finish_recording_before_restarting_voice_commands",
              ),
            );
          });
        }
      } finally {
        view.unmount();
        release();
        vi.useRealTimers();
      }
    },
  );

  it.each(["question", "summary", "lesson"] as const)(
    "uses only the visible courseware for %s and never captures the hidden board",
    async (operation) => {
      selectText("hidden board secret");
      const capture = vi
        .spyOn(ai, "boardContext")
        .mockRejectedValue(new Error("hidden board capture"));
      const chat = vi.spyOn(ai, "chat").mockResolvedValue(
        operation === "lesson"
          ? JSON.stringify({
              title: "visible lesson",
              steps: [
                {
                  say: "",
                  commands: [
                    {
                      type: "draw_rectangle",
                      id: "visible",
                      x: 10,
                      y: 10,
                      width: 40,
                      height: 30,
                      duration: 0,
                    },
                  ],
                },
              ],
              quiz: [],
            })
          : operation === "question"
          ? JSON.stringify({ action: "text", text: "visible answer" })
          : "visible summary",
      );
      vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      const draw = vi.fn();
      const text = vi.fn();
      let visibleInk: InkStroke[] = [];
      const stops = [
        classroomCommands.context("document", () => ({
          id: "course",
          name: "visible.pdf",
          page: 2,
          ink: visibleInk,
          text: "visible courseware",
          viewport: { left: 0, top: 0, scroll: 0 },
        })),
        classroomCommands.context("document.layout", () => ({
          scale: 1,
          viewport: { left: 16, top: 16, right: 1200, bottom: 700 },
          obstacles: [],
        })),
        classroomCommands.register("document.strokes", "@internal", (args) => {
          visibleInk = validateQuestionInk(args.strokes).map((points) => ({
            id: crypto.randomUUID(),
            points,
            color: "#000000",
            width: 2,
          }));
          return { ids: visibleInk.map((stroke) => stroke.id) };
        }),
        classroomCommands.register("document.snapshot", "@internal", () => ({
          name: "visible.pdf",
          page: 2,
          text: "visible courseware",
          image: "data:image/png;base64,visible",
        })),
        classroomCommands.register("document.draw", "@internal", draw),
        classroomCommands.register("document.text", "@internal", text),
      ];
      const view = render(<Classroom api={api} />);
      try {
        if (operation === "question") {
          await act(async () => {
            await classroomCommands.execute({ name: "assistant.open" });
          });
          vi.spyOn(ocr, "recognizeHandwriting").mockResolvedValue(
            "给我一个学习建议",
          );
          writeQuestion();
          fireEvent.click(
            screen.getByRole("button", { name: t("fcboard.send_question") }),
          );
          await waitFor(() => expect(text).toHaveBeenCalled());
        } else {
          await act(async () => {
            await classroomCommands.execute(
              operation === "summary"
                ? { name: "canvas.summary" }
                : { name: "lesson.ask", args: { prompt: "讲解这张课件" } },
            );
          });
          if (operation === "summary") {
            expect(
              screen.getByRole("dialog", { name: t("fcboard.ai_summary") }),
            ).toHaveTextContent("visible summary");
            expect(text).not.toHaveBeenCalled();
          } else {
            await waitFor(() => expect(draw).toHaveBeenCalled());
          }
        }
        expect(capture).not.toHaveBeenCalled();
        expect(JSON.stringify(chat.mock.calls[0][0])).toContain(
          "visible courseware",
        );
        expect(JSON.stringify(chat.mock.calls[0][0])).not.toContain(
          "hidden board secret",
        );
        expect(api.updateScene).not.toHaveBeenCalled();
      } finally {
        view.unmount();
        stops.forEach((stop) => stop());
      }
    },
  );

  it("provides cancellable local mathematics to the agent without inserting an answer", async () => {
    const view = render(<Classroom api={api} />);
    try {
      await expect(
        classroomCommands.execute({
          name: "math.evaluate",
          args: { expression: "0.1+0.2" },
        }),
      ).resolves.toEqual({ expression: "0.1+0.2", answer: "0.3" });
      await expect(
        classroomCommands.execute({
          name: "math.evaluate",
          args: { expression: "import(1)" },
        }),
      ).rejects.toThrow();
      const cancel = new AbortController();
      cancel.abort();
      await expect(
        classroomCommands.execute({
          name: "math.evaluate",
          args: { expression: "1+1", signal: cancel.signal },
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(api.updateScene).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it("calculates explicit courseware math without capturing or recognizing handwriting", async () => {
    const recognize = vi.spyOn(ocr, "recognizeHandwriting");
    const capture = vi.spyOn(ai, "boardContext");
    const snapshot = vi.fn();
    const text = vi.fn();
    const stops = [
      classroomCommands.context("document", () => ({
        id: "course",
        page: 1,
        ink: [],
      })),
      classroomCommands.register("document.snapshot", "@internal", snapshot),
      classroomCommands.register("document.draw", "@internal", vi.fn()),
      classroomCommands.register("document.text", "@internal", text),
    ];
    const view = render(<Classroom api={api} />);
    try {
      await act(async () => {
        await expect(
          classroomCommands.execute({
            name: "math.calculate",
            args: { expression: "1+1=" },
          }),
        ).resolves.toEqual({ expression: "1+1", answer: "2" });
      });
      expect(text).toHaveBeenCalledWith({ text: "1+1 = 2" });
      expect(snapshot).not.toHaveBeenCalled();
      expect(recognize).not.toHaveBeenCalled();
      expect(capture).not.toHaveBeenCalled();
      expect(api.updateScene).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      stops.forEach((stop) => stop());
    }
  });

  it.each([false, true])(
    "uses selected raw courseware ink and rejects a changed source (%s)",
    async (changeSource) => {
      const stroke: InkStroke = {
        id: "equation",
        points: [
          [10, 40],
          [100, 40],
        ],
        width: 2,
        color: "#101010",
      };
      const document = {
        id: "course",
        page: 1,
        ink: [stroke],
        selection: [stroke.id],
        region: [
          [20, 20],
          [80, 60],
        ],
      };
      let finish!: (text: string) => void;
      const recognize = vi
        .spyOn(ocr, "recognizeHandwriting")
        .mockImplementation(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        );
      const snapshot = vi.fn();
      const text = vi.fn();
      const stops = [
        classroomCommands.context("document", () => document),
        classroomCommands.register("document.snapshot", "@internal", snapshot),
        classroomCommands.register("document.draw", "@internal", vi.fn()),
        classroomCommands.register("document.text", "@internal", text),
      ];
      const view = render(<Classroom api={api} />);
      try {
        let request!: Promise<unknown>;
        act(() => {
          request = classroomCommands.execute({ name: "math.calculate" });
        });
        expect(recognize).toHaveBeenCalledWith(
          expect.any(Function),
          expect.any(AbortSignal),
          expect.any(Function),
          "math",
          undefined,
          [
            [
              [20, 40],
              [80, 40],
            ],
          ],
        );
        if (changeSource) {
          document.selection = [];
        }
        await act(async () => {
          finish("1+1=");
          await expect(request).resolves.toEqual(
            changeSource
              ? { cancelled: true }
              : { expression: "1+1", answer: "2" },
          );
        });
        if (changeSource) {
          expect(text).not.toHaveBeenCalled();
        } else {
          expect(text).toHaveBeenCalledWith({
            text: "2",
            presentation: "match",
            placement: "inline",
            sourceIds: [stroke.id],
            sourceSignature: documentSourceSignature([stroke]),
            sourceLines: 1,
          });
        }
        expect(snapshot).not.toHaveBeenCalled();
        expect(api.updateScene).not.toHaveBeenCalled();
      } finally {
        view.unmount();
        stops.forEach((stop) => stop());
      }
    },
  );

  it("prepares a lesson using visible canvas tools and local math before drawing the validated lesson", async () => {
    const capture = vi
      .spyOn(ai, "boardContext")
      .mockRejectedValue(new Error("hidden board"));
    const chat = vi
      .spyOn(ai, "chat")
      .mockResolvedValueOnce(
        JSON.stringify({
          action: "commands",
          commands: [
            { name: "canvas.inspect" },
            { name: "math.evaluate", args: { expression: "0.1+0.2" } },
          ],
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          action: "lesson",
          lesson: {
            title: "小数加法",
            steps: [
              {
                say: "",
                tools: [
                  {
                    name: "math.evaluate",
                    args: { expression: "0.1+0.2" },
                    expect: [{ path: "answer", equals: "0.3" }],
                  },
                ],
                commands: [
                  {
                    type: "write_text",
                    id: "decimal",
                    text: "0.1+0.2=0.3",
                    x: 10,
                    y: 10,
                    duration: 0,
                  },
                ],
              },
            ],
            quiz: [],
          },
        }),
      )
      .mockResolvedValue('{"action":"keep"}');
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const draw = vi.fn();
    const stops = [
      classroomCommands.context("document", () => ({
        id: "course",
        name: "decimals.pdf",
        page: 2,
        ink: [],
        text: "小数加法",
      })),
      classroomCommands.context("document.layout", () => ({
        scale: 1,
        viewport: { left: 16, top: 16, right: 984, bottom: 584 },
      })),
      classroomCommands.register("document.snapshot", "@internal", () => ({
        name: "decimals.pdf",
        page: 2,
        text: "小数加法",
        image: "data:image/png;base64,visible",
      })),
      classroomCommands.register("document.draw", "@internal", draw),
    ];
    const view = render(<Classroom api={api} />);
    try {
      await act(async () => {
        await classroomCommands.execute({
          name: "lesson.ask",
          args: { prompt: "讲解小数加法，先核算0.1+0.2" },
        });
      });
      await waitFor(() => expect(draw).toHaveBeenCalled());
      expect(chat).toHaveBeenCalledTimes(3);
      const observed = String(chat.mock.calls[1][0].at(-1)?.content);
      expect(observed).toContain('"answer":"0.3"');
      expect(observed).toContain('"kind":"document"');
      expect(observed).toContain("课程JSON");
      expect(String(chat.mock.calls[2][0].at(-1)?.content)).toContain(
        '"answer":"0.3"',
      );
      expect(String(chat.mock.calls[0][0][0].content)).toContain(
        "Each step may also include tools",
      );
      expect(classroomCommands.read("teacher")).toMatchObject({
        toolResults: [
          { name: "math.evaluate", ok: true, result: { answer: "0.3" } },
        ],
      });
      const saved = (await lessonSessions()).find(
        (session) => session.lesson.title === "小数加法",
      )!;
      expect(saved.toolIndex).toBe(1);
      expect(saved.canvas.document).toEqual({ name: "decimals.pdf", page: 2 });
      expect(capture).not.toHaveBeenCalled();
      expect(api.updateScene).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      stops.forEach((stop) => stop());
    }
  });

  it("does not apply an older AI component response after a newer command", async () => {
    let finish!: (value: string) => void;
    vi.spyOn(ai, "chat").mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    render(<Classroom api={api} />);
    await act(async () => {
      await classroomCommands.execute({ name: "assistant.open" });
    });
    const recognize = vi
      .spyOn(ocr, "recognizeHandwriting")
      .mockResolvedValue("插入一个矩形");
    writeQuestion();
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.send_question") }),
    );
    await waitFor(() => expect(ai.chat).toHaveBeenCalledTimes(1));
    await act(async () => {
      await classroomCommands.execute({ name: "assistant.open" });
    });
    recognize.mockResolvedValue("清空当前白板");
    writeQuestion();
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.send_question") }),
    );
    await act(async () => {
      finish(
        JSON.stringify({
          action: "shapes",
          shapes: [{ type: "rectangle", x: 0, y: 0, width: 50, height: 50 }],
        }),
      );
    });
    expect(scene).toHaveLength(0);
  });

  it.each(["fourline", "mindmap"] as const)(
    "inserts %s and enables writing in visible courseware without touching the hidden board",
    async (kind) => {
      const tool = vi.fn();
      const insert = vi.fn();
      const release = [
        classroomCommands.register("document.draw", "@internal", () => {}),
        classroomCommands.register("document.insertion", "@internal", insert),
        classroomCommands.register("document.tool", "@internal", tool),
      ];
      try {
        render(<Classroom api={api} />);
        await act(async () => {
          await classroomCommands.execute({
            name: "insert.object",
            args: { kind },
          });
        });
        expect(insert).toHaveBeenCalledTimes(1);
        expect(tool).toHaveBeenCalledWith({ tool: "freedraw" });
        expect(api.updateScene).not.toHaveBeenCalled();
      } finally {
        release.forEach((dispose) => dispose());
      }
    },
  );

  it("handles consecutive recording commands without waiting for a new render", async () => {
    vi.spyOn(BoardRecorder.prototype, "start").mockResolvedValue(undefined);
    vi.spyOn(BoardRecorder.prototype, "stop").mockResolvedValue({
      blob: new Blob(["voice"], { type: "audio/webm" }),
      duration: 1,
    });
    render(<Classroom api={api} />);
    await act(async () => {
      await classroomCommands.execute({
        name: "record.start",
        args: { mode: "audio" },
      });
      await classroomCommands.execute({ name: "record.stop" });
    });
    expect(BoardRecorder.prototype.stop).toHaveBeenCalledTimes(1);
  });

  it("stops media promptly, drains final speech and persists the video, transcript and AI summary together", async () => {
    await saveRecordings([]);
    saveSettings(
      { ...defaults, apiKey: "test", speech: "local", autoSummary: true },
      false,
    );
    const order: string[] = [];
    vi.spyOn(BoardRecorder.prototype, "start").mockResolvedValue(undefined);
    vi.spyOn(BoardRecorder.prototype, "stop").mockImplementation(async () => {
      order.push("media");
      return {
        blob: new Blob(["video"], { type: "video/webm" }),
        duration: 12,
      };
    });
    vi.spyOn(localSpeech, "startLocalSpeech").mockImplementation(
      async (onLine) => ({
        stop: async () => {
          order.push("speech");
          onLine({ time: 10, text: "F=ma" });
        },
        cancel: vi.fn(),
      }),
    );
    const chat = vi
      .spyOn(ai, "chat")
      .mockResolvedValue("Force equals mass times acceleration.");
    const view = render(<Classroom api={api} />);
    try {
      await act(async () => {
        await classroomCommands.execute({
          name: "record.start",
          args: { mode: "screen" },
        });
        await classroomCommands.execute({ name: "record.stop" });
      });
      expect(order).toEqual(["media", "speech"]);
      const saved = await loadRecordings();
      expect(saved).toHaveLength(1);
      expect(saved[0].blob.size).toBe(5);
      expect(saved[0].transcript).toContainEqual(
        expect.objectContaining({ text: "F=ma" }),
      );
      expect(saved[0].summary).toBe("Force equals mass times acceleration.");
      expect(JSON.stringify(chat.mock.calls[0][0])).toContain("F=ma");
      expect(
        screen.getByRole("button", { name: t("buttons.saveAs") }),
      ).toBeEnabled();
    } finally {
      view.unmount();
      await saveRecordings([]);
    }
  });

  it("keeps recording behind the board with pause, resume, restore and stop in its floating controls", async () => {
    await saveRecordings([]);
    saveSettings({ ...defaults, speech: "local", autoSummary: false }, false);
    vi.spyOn(BoardRecorder.prototype, "start").mockResolvedValue(undefined);
    const pause = vi
      .spyOn(BoardRecorder.prototype, "pause")
      .mockImplementation(() => {});
    const resume = vi
      .spyOn(BoardRecorder.prototype, "resume")
      .mockImplementation(() => {});
    const stop = vi.spyOn(BoardRecorder.prototype, "stop").mockResolvedValue({
      blob: new Blob(["media"], { type: "audio/webm" }),
      duration: 2,
    });
    const drain = vi.fn().mockResolvedValue(undefined);
    const speech = vi.spyOn(localSpeech, "startLocalSpeech").mockResolvedValue({
      stop: drain,
      cancel: vi.fn().mockResolvedValue(undefined),
    });
    const view = render(<Classroom api={api} />);
    try {
      await act(async () => {
        await classroomCommands.execute({ name: "record.open" });
        await classroomCommands.execute({
          name: "record.start",
          args: { mode: "audio" },
        });
      });
      expect(
        screen.queryByRole("dialog", { name: t("fcboard.recording") }),
      ).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: t("fcboard.recording_pause") }),
      );
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: t("fcboard.recording_resume") }),
        ).toBeEnabled(),
      );
      expect(pause).toHaveBeenCalledTimes(1);
      expect(drain).toHaveBeenCalledTimes(1);
      fireEvent.click(
        screen.getByRole("button", { name: t("fcboard.recording_resume") }),
      );
      await waitFor(() => expect(speech).toHaveBeenCalledTimes(2));
      expect(resume).toHaveBeenCalledTimes(1);
      fireEvent.click(
        screen.getByRole("button", {
          name: t("fcboard.restore_recording_window"),
        }),
      );
      expect(
        screen.getByRole("dialog", { name: t("fcboard.recording") }),
      ).toBeVisible();
      expect(stop).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole("button", { name: t("fcboard.minimize_recording") }),
      );
      expect(
        screen.queryByRole("dialog", { name: t("fcboard.recording") }),
      ).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: t("fcboard.stop_recording") }),
      );
      await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(
          screen.getByRole("dialog", { name: t("fcboard.recording") }),
        ).toBeVisible(),
      );
    } finally {
      view.unmount();
      await saveRecordings([]);
    }
  });

  it("waits for a paused transcription tail when stopped, without losing the final line", async () => {
    await saveRecordings([]);
    saveSettings({ ...defaults, speech: "local", autoSummary: false }, false);
    vi.spyOn(BoardRecorder.prototype, "start").mockResolvedValue(undefined);
    vi.spyOn(BoardRecorder.prototype, "pause").mockImplementation(() => {});
    const stop = vi.spyOn(BoardRecorder.prototype, "stop").mockResolvedValue({
      blob: new Blob(["media"], { type: "audio/webm" }),
      duration: 2,
    });
    let finish!: () => void;
    vi.spyOn(localSpeech, "startLocalSpeech").mockImplementation(
      async (onLine) => ({
        stop: () =>
          new Promise<void>((resolve) => {
            finish = () => {
              onLine({ time: 1, text: "Final words before pause" });
              resolve();
            };
          }),
        cancel: vi.fn().mockResolvedValue(undefined),
      }),
    );
    const view = render(<Classroom api={api} />);
    try {
      await act(async () => {
        await classroomCommands.execute({
          name: "record.start",
          args: { mode: "audio" },
        });
      });
      fireEvent.click(
        screen.getByRole("button", { name: t("fcboard.recording_pause") }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: t("fcboard.stop_recording") }),
      );
      await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
      expect(await loadRecordings()).toHaveLength(0);
      await act(async () => finish());
      await waitFor(async () =>
        expect((await loadRecordings())[0]?.transcript).toContainEqual(
          expect.objectContaining({ text: "Final words before pause" }),
        ),
      );
      expect(stop).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
      await saveRecordings([]);
    }
  });

  it("tests unsaved configuration and displays the actual model reply", async () => {
    saveSettings({ ...defaults, apiKey: "test", model: "saved-model" }, false);
    vi.spyOn(ai, "boardContext").mockResolvedValue({
      elements: [],
      text: "",
      image: undefined,
    });
    vi.spyOn(ai, "chat").mockResolvedValue("连接成功");
    render(<Classroom api={api} />);
    await act(async () => {
      await classroomCommands.execute({
        name: "panel.open",
        args: { panel: "settings" },
      });
    });
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.models_and_connection") }),
    );
    fireEvent.change(
      screen.getByPlaceholderText(t("fcboard.enter_a_vision_model_id")),
      {
        target: { value: "unsaved-model" },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.test_current_settings") }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        t(
          "fcboard.connection_test_result_result_write_on_the_board_to_test_image_recognition",
          {
            result: "连接成功",
          },
        ),
      ),
    );
    expect(ai.chat).toHaveBeenCalledWith(
      expect.any(Array),
      undefined,
      expect.objectContaining({ model: "unsaved-model" }),
    );
    expect(currentSettings().model).toBe("saved-model");
  });

  it("keeps ordinary selections on the canvas without additional AI controls", async () => {
    selectText("课堂笔记");
    render(<Classroom api={api} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    expect(scene).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector(".fc-dock, .fc-toolbar-context")).toBeNull();
    for (const name of [
      "计算选区",
      "绘制函数",
      "调节函数",
      "选区 AI",
      "总结选区",
    ]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });
  it("preserves handwriting selection without cloud calls or error popups before AI is configured", async () => {
    saveSettings({ ...defaults, autoMath: false }, false);
    const ink = API.createElement({
      type: "freedraw",
      x: 100,
      y: 100,
      points: [pointFrom(0, 0), pointFrom(40, 30)],
    });
    scene = [ink];
    selected = { [ink.id]: true };
    const chat = vi.spyOn(ai, "chat");
    render(<Classroom api={api} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    expect(chat).not.toHaveBeenCalled();
    expect(scene).toEqual([ink]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("never sends handwriting requests on selection or idle even with old autoMath settings", async () => {
    saveSettings(
      { ...defaults, autoMath: true, apiKey: "test", model: "test" },
      false,
    );
    const ink = API.createElement({
      type: "freedraw",
      x: 100,
      y: 100,
      points: [pointFrom(0, 0), pointFrom(40, 30)],
    });
    scene = [ink];
    selected = { [ink.id]: true };
    const chat = vi.spyOn(ai, "chat");
    const recognize = vi.spyOn(ocr, "recognizeHandwriting");
    render(<Classroom api={api} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2100));
    });
    expect(chat).not.toHaveBeenCalled();
    expect(recognize).not.toHaveBeenCalled();
    expect(
      screen.getByRole("toolbar", { name: t("fcboard.selection_actions") }),
    ).toBeVisible();
    expect(screen.getAllByRole("button", { name: "AI" })).toHaveLength(1);
    for (const label of ["calculate", "image", "questions"]) {
      expect(
        screen.queryByRole("button", {
          name: t(`fcboard.${label}` as "fcboard.calculate"),
        }),
      ).toBeNull();
    }
    expect(scene).toEqual([ink]);
  });

  it("reuses selected handwriting OCR through the single AI action", async () => {
    const ink = API.createElement({
      type: "freedraw",
      x: 100,
      y: 100,
      points: [pointFrom(0, 0), pointFrom(40, 30)],
    });
    scene = [ink];
    selected = { [ink.id]: true };
    vi.spyOn(ai, "boardContext").mockResolvedValue({
      elements: [ink],
      text: "",
      image: "data:image/png;base64,test" as DataURL,
    });
    const recognize = vi
      .spyOn(ocr, "recognizeHandwriting")
      .mockResolvedValue("1+1=");
    const chat = vi.spyOn(ai, "chat").mockResolvedValue("两个一相加等于二。");
    render(<Classroom api={api} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    await waitFor(() =>
      expect(scene.some((el) => el.type === "text" && el.text === "2")).toBe(
        true,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "AI" })).toBeEnabled(),
    );
    expect(recognize).toHaveBeenCalledTimes(1);
    expect(chat).not.toHaveBeenCalled();
  });

  it("crops and answers beside the gesture rather than the full bounds of a long stroke", async () => {
    const ink = API.createElement({
      type: "freedraw",
      x: 0,
      y: 100,
      width: 1000,
      height: 0,
      points: [pointFrom(0, 0), pointFrom(1000, 0)],
    });
    scene = [ink];
    selected = { [ink.id]: true };
    const original = api.getAppState;
    const region = { left: 200, top: 80, right: 320, bottom: 140 };
    vi.spyOn(api, "getAppState").mockImplementation(() => ({
      ...original(),
      activeTool: { ...original().activeTool, type: "lasso", customType: null },
      whiteboardSelection: { bounds: region, elementIds: [ink.id] },
    }));
    const capture = vi.spyOn(ai, "boardContext").mockResolvedValue({
      elements: [ink],
      text: "",
      image: "data:image/png;base64,test" as DataURL,
    });
    vi.spyOn(ocr, "recognizeHandwriting").mockImplementation(async (image) => {
      if (typeof image === "function") {
        await image();
      }
      return "1+1=";
    });
    render(<Classroom api={api} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    await waitFor(() =>
      expect(scene.some((el) => el.type === "text" && el.text === "2")).toBe(
        true,
      ),
    );
    expect(capture).toHaveBeenCalledWith(api, false, [ink], region);
    const answer = scene.find((el) => el.type === "text" && el.text === "2")!;
    expect(answer.x).toBeGreaterThan(region.right);
    expect(answer.x).toBeLessThan(region.right + 24);
    expect(answer.x).toBeLessThan(ink.width);
  });

  it("recognizes the visible part of a text object instead of reading its complete text", async () => {
    selectText("1+1=     9+9=");
    const source = scene[0];
    const region = {
      left: source.x,
      top: source.y - 4,
      right: source.x + 60,
      bottom: source.y + source.height + 4,
    };
    const original = api.getAppState;
    vi.spyOn(api, "getAppState").mockImplementation(() => ({
      ...original(),
      activeTool: { ...original().activeTool, type: "lasso", customType: null },
      whiteboardSelection: { bounds: region, elementIds: [source.id] },
    }));
    vi.spyOn(ai, "boardContext").mockResolvedValue({
      elements: [source],
      text: "",
      image: "data:image/png;base64,crop" as DataURL,
    });
    const recognize = vi
      .spyOn(ocr, "recognizeHandwriting")
      .mockResolvedValue("1+1=");
    render(<Classroom api={api} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    await waitFor(() =>
      expect(
        scene.some(
          (element) => element.type === "text" && element.text === "2",
        ),
      ).toBe(true),
    );
    expect(recognize).toHaveBeenCalledTimes(1);
  });

  it("crops the current document viewport after scrolling and includes page content behind text annotations", async () => {
    const doc = {
      name: "lesson.pdf",
      page: 1,
      ink: [
        {
          id: "note",
          points: [[100, 150]],
          text: "9+9=",
          width: 2,
          color: "#fff",
        },
      ],
      selection: ["note"],
      region: [
        [80, 130],
        [220, 210],
      ],
      viewport: { left: 0, top: 0, width: 1000, height: 500, scroll: 0 },
    };
    const release = classroomCommands.context("document", () => doc);
    const snapshot = classroomCommands.register(
      "document.snapshot",
      "@internal",
      () => ({ image: "data:image/png;base64,page" }),
    );
    const write = vi.fn();
    const releaseWrite = classroomCommands.register(
      "canvas.text",
      "@internal",
      write,
    );
    const crop = vi
      .spyOn(ai, "cropImage")
      .mockResolvedValue("data:image/png;base64,crop" as DataURL);
    const recognize = vi
      .spyOn(ocr, "recognizeHandwriting")
      .mockImplementation(async (image) => {
        if (typeof image === "function") {
          await image();
        }
        return "1+1=";
      });
    const rendered = render(
      <SelectionActions api={api} onPlot={vi.fn()} onRequest={vi.fn()} />,
    );
    try {
      act(() => {
        doc.viewport.scroll = 100;
        classroomCommands.changed("document");
      });
      fireEvent.click(screen.getByRole("button", { name: "AI" }));
      await waitFor(() =>
        expect(write).toHaveBeenCalledWith(
          expect.objectContaining({ text: "2" }),
        ),
      );
      expect(crop).toHaveBeenCalledWith(
        "data:image/png;base64,page",
        { left: 0.08, right: 0.22, top: 0.06, bottom: 0.22 },
        expect.any(AbortSignal),
      );
      expect(recognize).toHaveBeenCalledTimes(1);
    } finally {
      rendered.unmount();
      releaseWrite();
      snapshot();
      release();
    }
  });

  it("keeps a casually circled table free of automatic object-property popups", async () => {
    await renderInsertion(api, insertionDefaults("table", { x: 100, y: 100 }));
    const original = api.getAppState;
    vi.spyOn(api, "getAppState").mockImplementation(() => ({
      ...original(),
      activeTool: { ...original().activeTool, type: "lasso", customType: null },
      whiteboardSelection: {
        bounds: { left: 80, top: 80, right: 480, bottom: 300 },
        elementIds: Object.keys(selected),
      },
    }));
    const recognize = vi.spyOn(ocr, "recognizeHandwriting");
    render(<Classroom api={api} />);
    expect(
      screen.getByRole("toolbar", { name: t("fcboard.selection_actions") }),
    ).toBeVisible();
    expect(
      screen.queryByRole("dialog", { name: t("fcboard.table") }),
    ).toBeNull();
    expect(recognize).not.toHaveBeenCalled();
  });

  it("answers selected geometry in one visual request without discarding the diagram through OCR", async () => {
    scene = convertToExcalidrawElements([
      { type: "rectangle", x: 100, y: 100, width: 120, height: 80 },
      { type: "text", x: 100, y: 210, text: "解释这个图形" },
    ]);
    selected = Object.fromEntries(scene.map((element) => [element.id, true]));
    vi.spyOn(ai, "boardContext").mockResolvedValue({
      elements: scene,
      text: "解释这个图形",
      image: "data:image/png;base64,diagram" as DataURL,
    });
    const recognize = vi.spyOn(ocr, "recognizeHandwriting");
    const chat = vi
      .spyOn(ai, "chat")
      .mockResolvedValue("这是一个长方形，对边相等。");
    render(<Classroom api={api} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    await waitFor(() =>
      expect(
        scene.some(
          (element) =>
            element.type === "text" && element.text.includes("对边相等"),
        ),
      ).toBe(true),
    );
    expect(recognize).not.toHaveBeenCalled();
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0][0][0].content).toEqual(
      expect.arrayContaining([
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,diagram" },
        },
      ]),
    );
  });

  it("calculates a selected equation without an extra input step", async () => {
    selectText("1+1=");
    await act(async () => {
      render(<Classroom api={api} />);
    });
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    await waitFor(() =>
      expect(scene.some((el) => el.type === "text" && el.text === "2")).toBe(
        true,
      ),
    );
    const result = scene.find((el) => el.type === "text" && el.text === "2")!;
    expect(result.x).toBeGreaterThan(scene[0].x);
    expect(result.customData?.fcSelectionSource).toBe(
      `${scene[0].id}:${scene[0].version}`,
    );
    expect(
      result.type === "text" && scene[0].type === "text" && result.fontSize,
    ).toBe(scene[0].type === "text" && scene[0].fontSize);
    await act(async () => {
      selected = {};
      change.forEach((listener) => listener());
      selected = { [scene[0].id]: true };
      change.forEach((listener) => listener());
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    expect(
      scene.filter((el) => el.type === "text" && el.text === "2"),
    ).toHaveLength(1);
  });

  it("keeps a selected foreign word in ordinary AI question flow", async () => {
    selectText("bonjour");
    const chat = vi.spyOn(ai, "chat").mockResolvedValue("A French greeting.");
    render(<Classroom api={api} />);
    expect(chat).not.toHaveBeenCalled();
    expect(classroomCommands.has("language.explain")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    await waitFor(() => expect(scene).toHaveLength(2));
    expect(scene[0].type === "text" && scene[0].text).toBe("bonjour");
    expect(scene[1].type === "text" && scene[1].text).toBe(
      "A French greeting.",
    );
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("answers a selected question using editable canvas text without an AI panel", async () => {
    selectText("牛顿第一定律是什么？");
    vi.spyOn(ai, "boardContext").mockResolvedValue({
      elements: scene,
      text: "牛顿第一定律是什么？",
      image: undefined,
    });
    vi.spyOn(ai, "chat").mockResolvedValue(
      "合外力为零时，物体保持静止或匀速直线运动。",
    );
    render(<Classroom api={api} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    await waitFor(() =>
      expect(scene.filter((element) => element.type === "text")).toHaveLength(
        2,
      ),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "AI 教师" })).toBeNull();
    expect(scene[1].type === "text" && scene[1].text).toContain("合外力");
    await act(async () => {
      selected = {};
      change.forEach((listener) => listener());
      selected = { [scene[0].id]: true };
      change.forEach((listener) => listener());
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    expect(ai.chat).toHaveBeenCalledTimes(1);
  });

  it("does not write a selected question's late answer after the selection changes", async () => {
    selectText("这一步为什么成立？");
    vi.spyOn(ai, "boardContext").mockResolvedValue({
      elements: scene,
      text: "这一步为什么成立？",
      image: undefined,
    });
    let finish!: (result: string) => void;
    vi.spyOn(ai, "chat").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<Classroom api={api} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    await waitFor(() => expect(ai.chat).toHaveBeenCalledTimes(1));
    await act(async () => {
      selected = {};
      change.forEach((listener) => listener());
      finish("过期回答");
    });
    expect(scene).toHaveLength(1);
  });

  it("waits for pointer release before interpreting a selection", async () => {
    selectText("3*7");
    cursorButton = "down";
    render(<Classroom api={api} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    expect(scene).toHaveLength(1);
    await act(async () => {
      cursorButton = "up";
      change.forEach((listener) => listener());
    });
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    await waitFor(() =>
      expect(scene.some((el) => el.type === "text" && el.text === "21")).toBe(
        true,
      ),
    );
  });

  it("recognizes only the selected handwriting and discards a stale AI response", async () => {
    const ink = API.createElement({
      type: "freedraw",
      x: 100,
      y: 100,
      points: [pointFrom(0, 0), pointFrom(40, 30)],
    });
    scene = [ink];
    selected = { [ink.id]: true };
    saveSettings({ ...currentSettings(), answerStyle: "handwritten" }, false);
    const capture = vi.spyOn(ai, "boardContext").mockResolvedValue({
      elements: [ink],
      text: "",
      image: "data:image/png;base64,selected" as DataURL,
    });
    let finish!: (value: string) => void;
    const chat = vi
      .spyOn(ocr, "recognizeHandwriting")
      .mockImplementation(async (image) => {
        if (typeof image === "function") {
          await image();
        }
        return new Promise((resolve) => {
          finish = resolve;
        });
      });
    render(<Classroom api={api} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    await waitFor(() => expect(chat).toHaveBeenCalledTimes(1));
    expect(capture).toHaveBeenCalledWith(api, false, [ink], undefined);
    const signal = chat.mock.calls[0][1]!;
    await act(async () => {
      selected = {};
      change.forEach((listener) => listener());
      finish("8*8");
    });
    expect(signal.aborted).toBe(true);
    expect(scene).toHaveLength(1);
    chat.mockResolvedValue("8*8");
    await act(async () => {
      selected = { [ink.id]: true };
      change.forEach((listener) => listener());
    });
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    await waitFor(() => expect(handwritingText(scene)).toContain("64"));
    expect(
      scene
        .filter(
          (element) =>
            element.customData?.fcSelectionSource ===
            `${ink.id}:${ink.version}`,
        )
        .every((element) => element.type === "freedraw"),
    ).toBe(true);
  });

  it("starts a drawn lesson through the same AI action for selected handwriting", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const ink = API.createElement({
      type: "freedraw",
      x: 100,
      y: 100,
      points: [pointFrom(0, 0), pointFrom(100, 30)],
    });
    scene = [ink];
    selected = { [ink.id]: true };
    localStorage.setItem(
      "fcboard-teaching",
      JSON.stringify({ lens: "captions", speed: 1 }),
    );
    vi.spyOn(ocr, "recognizeHandwriting").mockResolvedValue("讲解牛顿定律");
    vi.spyOn(ai, "boardContext").mockResolvedValue({
      elements: scene,
      text: "讲解牛顿定律",
      image: undefined,
    });
    const chat = vi.spyOn(ai, "chat").mockResolvedValue(
      JSON.stringify({
        title: "牛顿定律",
        quiz: [],
        steps: [
          {
            say: "",
            commands: [
              {
                type: "write_text",
                id: "law",
                text: "合外力为零时，保持静止或匀速直线运动。",
                x: 0,
                y: 0,
                duration: 0,
              },
              {
                type: "draw_arrow",
                id: "force",
                x: 0,
                y: 100,
                width: 120,
                height: 0,
                duration: 0,
              },
            ],
          },
        ],
      }),
    );
    render(<Classroom api={api} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    await waitFor(() =>
      expect(
        scene.some((el) => el.type === "arrow" && el.customData?.fcLessonId),
      ).toBe(true),
    );
    expect(
      scene.some((el) => el.type === "text" && el.text.includes("合外力")),
    ).toBe(true);
    expect(scene.find((el) => el.id === ink.id)).toBe(ink);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(String(chat.mock.calls[1][0].at(-1)?.content)).toContain(ink.id);
    expect(
      screen.queryByRole("textbox", { name: t("fcboard.ask_the_ai_teacher") }),
    ).toBeNull();
  });

  it("preserves the factory search action beside the single AI entry", async () => {
    const ink = API.createElement({
      type: "freedraw",
      x: 100,
      y: 100,
      points: [pointFrom(0, 0), pointFrom(40, 30)],
    });
    scene = [ink];
    selected = { [ink.id]: true };
    const recognize = vi
      .spyOn(ocr, "recognizeHandwriting")
      .mockResolvedValue("Newton laws");
    const open = vi.fn();
    const stop = classroomCommands.register("web.open", "@internal", open);
    const view = render(
      <SelectionActions api={api} onPlot={vi.fn()} onRequest={vi.fn()} />,
    );
    try {
      expect(screen.getAllByRole("button", { name: "AI" })).toHaveLength(1);
      fireEvent.click(
        screen.getByRole("button", { name: t("fcboard.search") }),
      );
      await waitFor(() =>
        expect(open).toHaveBeenCalledWith({
          url: "https://www.google.com/search?q=Newton%20laws",
        }),
      );
      expect(recognize).toHaveBeenCalledTimes(1);
      expect(scene).toEqual([ink]);
    } finally {
      view.unmount();
      stop();
    }
  });

  it("plots the selection and reopens the same graph's parameter controls", async () => {
    selectText("y=a*x+1");
    await act(async () => {
      render(<Classroom api={api} />);
    });
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    await waitFor(() => expect(scene.length).toBeGreaterThan(5));
    const original = scene.filter((el) => el.customData?.fcPlot);
    const axes = original.filter((el) => el.type === "arrow");
    expect(
      axes[0].type === "arrow" &&
        axes[0].points.every((point) => point[1] === 0),
    ).toBe(true);
    expect(
      axes[1].type === "arrow" &&
        axes[1].points.every((point) => point[0] === 0),
    ).toBe(true);
    fireEvent.change(
      screen.getByRole("slider", {
        name: t("fcboard.adjust_key", { key: "a" }),
      }),
      {
        target: { value: "2" },
      },
    );
    expect(scene.filter((el) => el.customData?.fcPlot)).toHaveLength(
      original.length,
    );
    expect(scene.some((el) => original.some((old) => old.id === el.id))).toBe(
      false,
    );
    const selection = vi.mocked(api.updateScene).mock.calls.at(-1)![0]
      .appState!;
    const group = scene.find((element) => element.customData?.fcPlot)!
      .groupIds[0];
    expect(selection.selectedGroupIds).toEqual({ [group]: true });
    expect(selection.editingGroupId).toBeNull();
    expect(selection.selectedLinearElement).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.close_tool_panel") }),
    );
    await act(async () => {
      selected = {};
      change.forEach((listener) => listener());
      selected = { [scene.find((el) => el.customData?.fcPlot)!.id]: true };
      change.forEach((listener) => listener());
    });
    expect(
      screen.getByRole("slider", {
        name: t("fcboard.adjust_key", { key: "a" }),
      }),
    ).toHaveValue("2");
  });

  it("uses the same projection for the 3D surface and its x/y/z axes", async () => {
    selectText("z=sin(x)*cos(y)");
    await act(async () => {
      render(<Classroom api={api} />);
    });
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    await waitFor(() =>
      expect(scene.filter((el) => el.type === "arrow")).toHaveLength(3),
    );
    const axes = scene.filter((el) => el.type === "arrow");
    // The element converter moves arrow endpoints by 0.5px to avoid binding overlaps.
    const expected = [
      [315, 135],
      [0, -450],
      [-315, 135],
    ];
    axes.forEach((axis, index) => {
      if (axis.type !== "arrow") {
        throw new Error("Expected coordinate axis");
      }
      expect(
        Math.abs(axis.points[1][0] - expected[index][0]),
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(axis.points[1][1] - expected[index][1]),
      ).toBeLessThanOrEqual(1);
    });
  });
});
