import { t } from "@excalidraw/excalidraw/i18n";
import { Capacitor } from "@capacitor/core";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { render } from "./test/render";

import { TeachingTools } from "./TeachingTools";
import { classroomCommands } from "./commands";
import { readWidgets } from "./widgets";
import { Classroom } from "./native";

vi.mock("./native", () => ({
  Classroom: { getFactoryTools: vi.fn(), openFactoryTool: vi.fn() },
}));

afterEach(() => vi.restoreAllMocks());

const emptyApi = () =>
  ({
    getSceneElements: () => [],
    getAppState: () => ({
      selectedElementIds: {},
      scrollX: 0,
      scrollY: 0,
      width: 1600,
      height: 900,
      zoom: { value: 1 },
    }),
    onChange: () => () => {},
    setActiveTool: vi.fn(),
    updateScene: vi.fn(),
  } as unknown as ExcalidrawImperativeAPI);

vi.mock("@excalidraw/excalidraw", async (original) => ({
  ...(await original<typeof import("@excalidraw/excalidraw")>()),
  ToolbarExtras: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

it("uses the same native tool command for touch and AI, reports failure and restores the control", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  vi.mocked(Classroom.getFactoryTools).mockResolvedValue({
    available: ["calculator", "split"],
  });
  let rejectOpen: (reason: Error) => void;
  vi.mocked(Classroom.openFactoryTool)
    .mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectOpen = reject;
      }),
    )
    .mockResolvedValue(undefined);
  render(<TeachingTools api={emptyApi()} />);
  await waitFor(() =>
    expect(classroomCommands.has("tools.factory")).toBe(true),
  );
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.教学工具") }));
  const calculator = screen.getByRole("button", {
    name: t("fcboard.打开{{name}}", { name: t("fcboard.计算器") }),
  });
  expect(
    screen.queryByRole("button", {
      name: t("fcboard.打开{{name}}", { name: t("fcboard.信号源") }),
    }),
  ).not.toBeInTheDocument();
  fireEvent.click(calculator);
  expect(calculator).toBeDisabled();
  await act(async () => rejectOpen(new Error("系统拒绝启动")));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("系统拒绝启动"),
  );
  expect(calculator).toBeEnabled();
  await act(async () => {
    await classroomCommands.execute({
      name: "tools.factory",
      args: { tool: "calculator" },
    });
  });
  expect(Classroom.openFactoryTool).toHaveBeenNthCalledWith(1, {
    tool: "calculator",
  });
  expect(Classroom.openFactoryTool).toHaveBeenNthCalledWith(2, {
    tool: "calculator",
  });
  expect(
    screen.queryByRole("dialog", { name: t("fcboard.教学工具") }),
  ).not.toBeInTheDocument();
  await expect(
    classroomCommands.execute({
      name: "tools.factory",
      args: { tool: "signal" },
    }),
  ).rejects.toThrow(t("fcboard.当前设备没有这项大屏工具"));
});

it("does not advertise unavailable device actions to the AI", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  vi.mocked(Classroom.getFactoryTools).mockResolvedValue({ available: [] });
  render(<TeachingTools api={emptyApi()} />);
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.教学工具") }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      t("fcboard.当前设备未提供出厂工具，可继续使用白板教具。"),
    ),
  );
  expect(classroomCommands.has("tools.factory")).toBe(false);
  expect(
    screen.getByRole("button", {
      name: t("fcboard.插入{{name}}", { name: t("fcboard.计时器") }),
    }),
  ).toBeEnabled();
});

it("uses one native transfer entry when the factory transfer application is available", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  vi.mocked(Classroom.getFactoryTools).mockResolvedValue({
    available: ["transfer"],
  });
  render(<TeachingTools api={emptyApi()} />);
  await waitFor(() =>
    expect(classroomCommands.has("tools.factory")).toBe(true),
  );
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.教学工具") }));
  expect(
    screen.getByRole("button", {
      name: t("fcboard.打开{{name}}", { name: t("fcboard.快传") }),
    }),
  ).toBeEnabled();
  expect(screen.queryByRole("button", { name: t("fcboard.快传") })).toBeNull();
});

it.each([
  ["AI 总结", "canvas.summary"],
  ["课堂录制", "record.open"],
  ["快传", "files.open"],
  ["AI 问答", "assistant.open"],
] as const)(
  "runs %s from the toolbox through the existing UI command route",
  async (label, command) => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
    const invoke = vi.fn();
    const release = classroomCommands.register(
      "ui.invoke",
      "@internal",
      invoke,
    );
    const view = render(<TeachingTools api={emptyApi()} />);
    try {
      fireEvent.click(
        screen.getByRole("button", { name: t("fcboard.教学工具") }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: t(`fcboard.${label}`) }),
      );
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith({ command, origin: "tools" }),
      );
      expect(
        screen.queryByRole("dialog", { name: t("fcboard.教学工具") }),
      ).not.toBeInTheDocument();
    } finally {
      view.unmount();
      release();
    }
  },
);

it("closes the tool picker with the toolbar and allows the AI to show it again", async () => {
  const api = emptyApi();
  const state = { ...api.getAppState(), toolbarHidden: false };
  vi.spyOn(api, "getAppState").mockImplementation(() => state);
  let change: () => void = () => {};
  vi.spyOn(api, "onChange").mockImplementation((callback) => {
    change = () => callback([], state, {});
    return () => {};
  });
  render(<TeachingTools api={api} />);
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.教学工具") }));
  expect(
    screen.getByRole("dialog", { name: t("fcboard.教学工具") }),
  ).toBeInTheDocument();
  act(() => {
    state.toolbarHidden = true;
    change();
  });
  expect(
    screen.queryByRole("dialog", { name: t("fcboard.教学工具") }),
  ).not.toBeInTheDocument();
  await act(async () => {
    await classroomCommands.execute({ name: "tools.open" });
  });
  expect(api.updateScene).toHaveBeenCalledWith({
    appState: { toolbarHidden: false },
  });
  expect(
    screen.getByRole("dialog", { name: t("fcboard.教学工具") }),
  ).toBeInTheDocument();
});

it("executes one AI request that inserts, configures and starts a timer before React commits the selection", async () => {
  let scene: readonly ExcalidrawElement[] = [];
  const api = {
    getSceneElements: () => scene,
    getAppState: () => ({
      selectedElementIds: {},
      scrollX: 0,
      scrollY: 0,
      width: 1600,
      height: 900,
      zoom: { value: 1 },
    }),
    onChange: () => () => {},
    setActiveTool: vi.fn(),
    updateScene: (value: { elements?: readonly ExcalidrawElement[] }) => {
      if (value.elements) {
        scene = value.elements;
      }
    },
  } as unknown as ExcalidrawImperativeAPI;
  render(<TeachingTools api={api} />);
  await act(async () => {
    await classroomCommands.execute({
      name: "tools.insert",
      args: { kind: "timer" },
    });
    await classroomCommands.execute({
      name: "tools.configure",
      args: { duration: 300 },
    });
    await classroomCommands.execute({
      name: "tools.play",
      args: { enabled: true },
    });
  });
  const timer = readWidgets(api)[0];
  expect(timer.params.duration).toBe(300);
  expect(timer.params.running).toBe(true);
});
