import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { Classroom } from "./Classroom";

describe("classroom whiteboard integration", () => {
  let scene: readonly ExcalidrawElement[];
  let api: ExcalidrawImperativeAPI;
  beforeEach(() => {
    scene = [];
    api = {
      getSceneElements: () => scene,
      getAppState: () => ({
        scrollX: 0,
        scrollY: 0,
        width: 1600,
        height: 900,
        zoom: { value: 1 },
        selectedElementIds: {},
      }),
      getFiles: () => ({}),
      updateScene: vi.fn((update) => {
        if (update.elements) {
          scene = update.elements;
        }
      }),
      onChange: () => () => {},
    } as unknown as ExcalidrawImperativeAPI;
  });
  it("inserts a standard editable cube and closes the floating controls", async () => {
    await act(async () => {
      render(<Classroom api={api} />);
    });
    fireEvent.click(screen.getByRole("button", { name: "AI 助教" }));
    fireEvent.click(screen.getByRole("button", { name: "插入立方体" }));
    expect(scene).toHaveLength(12);
    expect(
      scene.every(
        (element) => element.type === "line" && element.roughness === 0,
      ),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "关闭工具浮层" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("calculates and inserts a real text element on the canvas", async () => {
    await act(async () => {
      render(<Classroom api={api} />);
    });
    fireEvent.click(screen.getByRole("button", { name: "数学计算" }));
    fireEvent.change(screen.getByLabelText("数学表达式"), {
      target: { value: "1+1=" },
    });
    fireEvent.click(screen.getByRole("button", { name: "计算并写入白板" }));
    await waitFor(() =>
      expect(scene.some((el) => el.type === "text" && el.text === "2")).toBe(
        true,
      ),
    );
  });
  it("changes an existing plot when its parameter changes", async () => {
    await act(async () => {
      render(<Classroom api={api} />);
    });
    fireEvent.click(screen.getByRole("button", { name: "函数实验室" }));
    fireEvent.change(screen.getByLabelText("函数表达式"), {
      target: { value: "a*x+1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "插入函数图像" }));
    await waitFor(() => expect(scene.length).toBeGreaterThan(5));
    const original = scene;
    fireEvent.change(screen.getByRole("slider", { name: "调节 a" }), {
      target: { value: "2" },
    });
    expect(scene.length).toBe(original.length);
    expect(scene.some((el) => original.some((old) => old.id === el.id))).toBe(
      false,
    );
  });
});
