import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { Classroom } from "./Classroom";

vi.mock("@excalidraw/excalidraw", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@excalidraw/excalidraw")>()),
  ToolbarExtras: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

describe("selection-driven classroom controls", () => {
  let scene: readonly ExcalidrawElement[];
  let api: ExcalidrawImperativeAPI;
  let selected: Record<string, boolean>;
  let change: Set<() => void>;
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
      }),
      getFiles: () => ({}),
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

  it("shows contextual actions only when existing content is selected", async () => {
    await act(async () => {
      render(<Classroom api={api} />);
    });
    expect(screen.queryByRole("button", { name: "绘制函数" })).toBeNull();
    expect(document.querySelector(".fc-dock")).toBeNull();
    await act(async () => {
      selectText("y=x+1");
      change.forEach((listener) => listener());
    });
    expect(
      screen.getByRole("button", { name: "绘制函数" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "选区 AI" }));
    fireEvent.click(screen.getByRole("button", { name: "插入立方体" }));
    expect(scene.filter((element) => element.type === "line")).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: "关闭工具浮层" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => {
      selected = {};
      change.forEach((listener) => listener());
    });
    expect(screen.queryByRole("button", { name: "计算选区" })).toBeNull();
  });

  it("calculates a selected equation without an extra input step", async () => {
    selectText("1+1=");
    await act(async () => {
      render(<Classroom api={api} />);
    });
    fireEvent.click(screen.getByRole("button", { name: "计算选区" }));
    await waitFor(() =>
      expect(scene.some((el) => el.type === "text" && el.text === "2")).toBe(
        true,
      ),
    );
    const result = scene.find((el) => el.type === "text" && el.text === "2")!;
    expect(result.x).toBeGreaterThan(scene[0].x);
    expect(result.customData?.fcAnswerSource).toBe(scene[0].id);
  });

  it("plots the selection and reopens the same graph's parameter controls", async () => {
    selectText("y=a*x+1");
    await act(async () => {
      render(<Classroom api={api} />);
    });
    fireEvent.click(screen.getByRole("button", { name: "绘制函数" }));
    await waitFor(() => expect(scene.length).toBeGreaterThan(5));
    const original = scene.filter((el) => el.customData?.fcPlot);
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
    fireEvent.click(screen.getByRole("button", { name: "调节函数" }));
    expect(screen.getByRole("slider", { name: "调节 a" })).toHaveValue("2");
  });
});
