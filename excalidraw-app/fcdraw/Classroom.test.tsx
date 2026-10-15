import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import type {
  DataURL,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { Classroom } from "./Classroom";
import * as ai from "./ai";

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
    api = {
      getSceneElements: () => scene,
      getAppState: () => ({
        scrollX: 0,
        scrollY: 0,
        width: 1600,
        height: 900,
        zoom: { value: 1 },
        selectedElementIds: selected,
        cursorButton,
      }),
      getFiles: () => ({}),
      onPointerDown: () => () => {},
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

  it("calculates a selected equation without an extra input step", async () => {
    selectText("1+1=");
    await act(async () => {
      render(<Classroom api={api} />);
    });
    await waitFor(() =>
      expect(scene.some((el) => el.type === "text" && el.text === "2")).toBe(
        true,
      ),
    );
    const result = scene.find((el) => el.type === "text" && el.text === "2")!;
    expect(result.x).toBeGreaterThan(scene[0].x);
    expect(result.customData?.fcAnswerSource).toBe(scene[0].id);
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
    await waitFor(() =>
      expect(scene.some((el) => el.type === "text" && el.text === "21")).toBe(
        true,
      ),
    );
  });

  it("recognizes only the selected handwriting and discards a stale AI response", async () => {
    const ink = API.createElement({ type: "freedraw", x: 100, y: 100 });
    scene = [ink];
    selected = { [ink.id]: true };
    const capture = vi.spyOn(ai, "boardContext").mockResolvedValue({
      elements: [ink],
      text: "",
      image: "data:image/png;base64,selected" as DataURL,
    });
    let finish!: (value: string) => void;
    const chat = vi.spyOn(ai, "chat").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<Classroom api={api} />);
    await waitFor(() => expect(chat).toHaveBeenCalledTimes(1));
    expect(capture).toHaveBeenCalledWith(api, false, [ink]);
    const signal = chat.mock.calls[0][1]!;
    await act(async () => {
      selected = {};
      change.forEach((listener) => listener());
      finish('{"action":"calculate","expression":"8*8"}');
    });
    expect(signal.aborted).toBe(true);
    expect(scene).toHaveLength(1);
    chat.mockResolvedValue('{"action":"calculate","expression":"8*8"}');
    await act(async () => {
      selected = { [ink.id]: true };
      change.forEach((listener) => listener());
    });
    await waitFor(() =>
      expect(scene.some((el) => el.type === "text" && el.text === "64")).toBe(
        true,
      ),
    );
  });

  it("plots the selection and reopens the same graph's parameter controls", async () => {
    selectText("y=a*x+1");
    await act(async () => {
      render(<Classroom api={api} />);
    });
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
    fireEvent.change(screen.getByRole("slider", { name: "调节 a" }), {
      target: { value: "2" },
    });
    expect(scene.filter((el) => el.customData?.fcPlot)).toHaveLength(
      original.length,
    );
    expect(scene.some((el) => original.some((old) => old.id === el.id))).toBe(
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: "关闭工具浮层" }));
    await act(async () => {
      selected = {};
      change.forEach((listener) => listener());
      selected = { [scene.find((el) => el.customData?.fcPlot)!.id]: true };
      change.forEach((listener) => listener());
    });
    expect(screen.getByRole("slider", { name: "调节 a" })).toHaveValue("2");
  });

  it("uses the same projection for the 3D surface and its x/y/z axes", async () => {
    selectText("z=sin(x)*cos(y)");
    await act(async () => {
      render(<Classroom api={api} />);
    });
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
