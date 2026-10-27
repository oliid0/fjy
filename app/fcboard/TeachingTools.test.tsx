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
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.teaching_tools") }),
  );
  const calculator = screen.getByRole("button", {
    name: t("fcboard.open_name", { name: t("fcboard.calculator") }),
  });
  expect(
    screen.queryByRole("button", {
      name: t("fcboard.open_name", { name: t("fcboard.signal") }),
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
    screen.queryByRole("dialog", { name: t("fcboard.teaching_tools") }),
  ).not.toBeInTheDocument();
  await expect(
    classroomCommands.execute({
      name: "tools.factory",
      args: { tool: "signal" },
    }),
  ).rejects.toThrow(t("fcboard.this_tool_is_not_installed_on_this_display"));
});

it("does not advertise unavailable device actions to the AI", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  vi.mocked(Classroom.getFactoryTools).mockResolvedValue({ available: [] });
  render(<TeachingTools api={emptyApi()} />);
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.teaching_tools") }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("status")).not.toBeInTheDocument(),
  );
  expect(classroomCommands.has("tools.factory")).toBe(false);
  expect(
    screen.getByRole("button", {
      name: t("fcboard.insert_name", { name: t("fcboard.timer") }),
    }),
  ).toBeEnabled();
});

it("uses one internal transfer entry even when a factory transfer application is available", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  vi.mocked(Classroom.getFactoryTools).mockResolvedValue({
    available: ["transfer"],
  });
  const invoke = vi.fn();
  const release = classroomCommands.register("ui.invoke", "@internal", invoke);
  const view = render(<TeachingTools api={emptyApi()} />);
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.teaching_tools") }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("status")).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByRole("button", {
      name: t("fcboard.open_name", { name: t("fcboard.file_transfer") }),
    }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.file_transfer") }),
  );
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith({
      command: "files.open",
      origin: "tools",
    }),
  );
  expect(classroomCommands.has("tools.factory")).toBe(false);
  view.unmount();
  release();
});

it.each([
  ["ai_summary", "canvas.summary"],
  ["recording", "record.open"],
  ["file_transfer", "files.open"],
  ["ai_questions", "assistant.open"],
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
        screen.getByRole("button", { name: t("fcboard.teaching_tools") }),
      );
      if (label !== "file_transfer") {
        fireEvent.click(
          screen.getByRole("button", { name: t("fcboard.next_page") }),
        );
      }
      if (label === "ai_questions") {
        expect(
          screen.getAllByRole("button", { name: t("fcboard.ai_questions") }),
        ).toHaveLength(1);
        expect(
          screen.queryByRole("button", { name: t("fcboard.capture") }),
        ).toBeNull();
      }
      fireEvent.click(
        screen.getByRole("button", { name: t(`fcboard.${label}`) }),
      );
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith({ command, origin: "tools" }),
      );
      expect(
        screen.queryByRole("dialog", { name: t("fcboard.teaching_tools") }),
      ).not.toBeInTheDocument();
    } finally {
      view.unmount();
      release();
    }
  },
);

it("keeps original tools on the first page, exposes additions with dots, and toggles closed on another toolbar tap", () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
  render(<TeachingTools api={emptyApi()} />);
  const trigger = screen.getByRole("button", {
    name: t("fcboard.teaching_tools"),
  });
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
  expect(
    screen.getByRole("button", {
      name: t("fcboard.insert_name", { name: t("fcboard.ruler") }),
    }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: t("fcboard.ai_summary") }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.next_page") }));
  expect(
    screen.getByRole("button", { name: t("fcboard.ai_summary") }),
  ).toBeInTheDocument();
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
  expect(
    screen.queryByRole("dialog", { name: t("fcboard.teaching_tools") }),
  ).toBeNull();
  fireEvent.click(trigger);
  expect(
    screen.getByRole("button", { name: t("fcboard.previous_page") }),
  ).toHaveAttribute("aria-pressed", "true");
  fireEvent.pointerDown(document.body);
  expect(
    screen.queryByRole("dialog", { name: t("fcboard.teaching_tools") }),
  ).toBeNull();
});

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
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.teaching_tools") }),
  );
  expect(
    screen.getByRole("dialog", { name: t("fcboard.teaching_tools") }),
  ).toBeInTheDocument();
  act(() => {
    state.toolbarHidden = true;
    change();
  });
  expect(
    screen.queryByRole("dialog", { name: t("fcboard.teaching_tools") }),
  ).not.toBeInTheDocument();
  await act(async () => {
    await classroomCommands.execute({ name: "tools.open" });
  });
  expect(api.updateScene).toHaveBeenCalledWith({
    appState: { toolbarHidden: false },
  });
  expect(
    screen.getByRole("dialog", { name: t("fcboard.teaching_tools") }),
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
