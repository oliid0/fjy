import { t } from "@excalidraw/excalidraw/i18n";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { pointFrom } from "@excalidraw/math";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import type {
  DataURL,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { render } from "./test/render";

import { Classroom } from "./Classroom";
import { SelectionActions } from "./SelectionActions";
import * as ai from "./ai";
import * as ocr from "./ocr";
import { classroomCommands } from "./commands";
import { BoardRecorder } from "./recording";
import { currentSettings, defaults, saveSettings } from "./settings";
import { handwritingText } from "./handwriting";
import { insertionDefaults, renderInsertion } from "./insertObjects";

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
    fireEvent.change(
      screen.getByRole("textbox", { name: t("fcboard.向 AI 教师提问") }),
      {
        target: { value: "插入一个矩形" },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.发送问题") }),
    );
    await waitFor(() => expect(ai.chat).toHaveBeenCalledTimes(1));
    await act(async () => {
      await classroomCommands.execute({ name: "assistant.open" });
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: t("fcboard.向 AI 教师提问") }),
      {
        target: { value: "清空当前白板" },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.发送问题") }),
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
      screen.getByRole("button", { name: t("fcboard.模型与连接") }),
    );
    fireEvent.change(
      screen.getByPlaceholderText(t("fcboard.填写支持视觉的模型 ID")),
      {
        target: { value: "unsaved-model" },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.测试当前配置") }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        t("fcboard.连接测试返回：{{result}}；在白板书写后可测试截图识别", {
          result: "连接成功",
        }),
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
      screen.getByRole("toolbar", { name: t("fcboard.选区操作") }),
    ).toBeVisible();
    expect(screen.getAllByRole("button", { name: "AI" })).toHaveLength(1);
    for (const label of ["计算", "图像", "问答"]) {
      expect(
        screen.queryByRole("button", {
          name: t(`fcboard.${label}` as "fcboard.计算"),
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
        { left: 0.068, right: 0.232, top: 0.036, bottom: 0.244 },
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
      screen.getByRole("toolbar", { name: t("fcboard.选区操作") }),
    ).toBeVisible();
    expect(
      screen.queryByRole("dialog", { name: t("fcboard.表格") }),
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

  it("explains a selected foreign word on the canvas with one explicit request", async () => {
    selectText("bonjour");
    const chat = vi.spyOn(ai, "chat").mockResolvedValue(
      JSON.stringify({
        language: "fr",
        term: "bonjour",
        pronunciation: "/bɔ̃.ʒuʁ/",
        syllables: "bon·jour",
        meanings: [{ partOfSpeech: "interjection", definition: "hello" }],
        usage: "A daytime greeting.",
        grammar: "bon + jour",
        examples: [{ text: "Bonjour, Marie !", translation: "Hello, Marie!" }],
      }),
    );
    render(<Classroom api={api} />);
    expect(chat).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    await waitFor(() => expect(scene).toHaveLength(2));
    expect(scene[0].type === "text" && scene[0].text).toBe("bonjour");
    expect(scene[1].type === "text" && scene[1].text).toContain("bon·jour");
    expect(scene[1].type === "text" && scene[1].text).toContain("interjection");
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
    expect(chat).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("textbox", { name: t("fcboard.向 AI 教师提问") }),
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
      fireEvent.click(screen.getByRole("button", { name: t("fcboard.搜索") }));
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
        name: t("fcboard.调节 {{key}}", { key: "a" }),
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
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.关闭工具浮层") }),
    );
    await act(async () => {
      selected = {};
      change.forEach((listener) => listener());
      selected = { [scene.find((el) => el.customData?.fcPlot)!.id]: true };
      change.forEach((listener) => listener());
    });
    expect(
      screen.getByRole("slider", {
        name: t("fcboard.调节 {{key}}", { key: "a" }),
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
