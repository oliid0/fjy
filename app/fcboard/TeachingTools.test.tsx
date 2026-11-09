import { t } from "@fcboard/fcboard/i18n";
import { getDefaultAppState } from "@fcboard/fcboard/appState";
import { Capacitor } from "@capacitor/core";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";

import { render as renderEditor } from "@fcboard/fcboard/tests/test-utils";

import { Fcboard } from "@fcboard/fcboard";

import type { FcboardElement } from "@fcboard/element/types";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { TeachingTools } from "./TeachingTools";
import { classroomCommands } from "./commands";
import { readWidgets } from "./widgets";

const render = (children: React.ReactElement) =>
  renderEditor(
    <Fcboard UIOptions={{ unifiedToolbar: true }}>{children}</Fcboard>,
  );

afterEach(() => vi.restoreAllMocks());

const emptyApi = () =>
  ({
    getSceneElements: () => [],
    getAppState: () => ({
      ...getDefaultAppState(),
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
  } as unknown as FcboardImperativeAPI);

it("opens the built-in calculator without any installed OEM app and rejects unknown tools", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  await render(<TeachingTools api={emptyApi()} />);
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.toolbox") }));
  fireEvent.click(
    screen.getByRole("button", {
      name: t("fcboard.open_name", { name: t("fcboard.calculator") }),
    }),
  );
  await waitFor(() =>
    expect(screen.getByTitle(t("fcboard.calculator"))).toBeInTheDocument(),
  );
  expect(screen.getByTitle(t("fcboard.calculator"))).toHaveAttribute(
    "sandbox",
    "allow-scripts",
  );
  expect(
    screen.queryByRole("dialog", { name: t("fcboard.toolbox") }),
  ).not.toBeInTheDocument();
  await expect(
    classroomCommands.execute({
      name: "tools.factory",
      args: { tool: "signal" },
    }),
  ).rejects.toThrow(t("fcboard.this_tool_is_not_installed_on_this_display"));
});

it("restores the actual tool button after an opening failure", async () => {
  await render(<TeachingTools api={emptyApi()} />);
  const release = classroomCommands.register(
    "tools.curtain",
    "@internal",
    () => {
      throw new Error("幕布打开失败");
    },
  );
  try {
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.toolbox") }));
    const button = screen.getByRole("button", {
      name: t("fcboard.open_name", { name: t("fcboard.curtain") }),
    });
    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("幕布打开失败"),
    );
    expect(button).toBeEnabled();
  } finally {
    release();
  }
});

it.each(["ltr", "rtl"])(
  "exposes all tools together in %s without paging",
  async (direction) => {
    await render(<TeachingTools api={emptyApi()} />);
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.toolbox") }));
    const panel = screen.getByRole("dialog", { name: t("fcboard.toolbox") });
    panel.style.direction = direction;
    for (const label of [
      "recording",
      "ai_summary",
      "voice_commands",
      "file_transfer",
    ] as const) {
      expect(
        screen.getByRole("button", { name: t(`fcboard.${label}`) }),
      ).toBeVisible();
    }
    expect(
      screen.queryByRole("button", { name: t("fcboard.next_page") }),
    ).toBeNull();
  },
);

it("keeps every built-in tool available without OEM packages and places curtain after timer", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  await render(<TeachingTools api={emptyApi()} />);
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.toolbox") }));
  expect(classroomCommands.has("tools.factory")).toBe(true);
  for (const label of [
    "split_screen",
    "vote",
    "calculator",
    "spotlight",
    "timer",
    "curtain",
  ] as const) {
    expect(
      screen.getByRole("button", {
        name: t("fcboard.open_name", { name: t(`fcboard.${label}`) }),
      }),
    ).toBeEnabled();
  }
  const timer = screen.getByRole("button", {
    name: t("fcboard.open_name", { name: t("fcboard.timer") }),
  });
  const curtain = screen.getByRole("button", {
    name: t("fcboard.open_name", { name: t("fcboard.curtain") }),
  });
  expect(
    timer.compareDocumentPosition(curtain) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("uses one internal transfer entry even when a factory transfer application is available", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  const invoke = vi.fn();
  const release = classroomCommands.register("ui.invoke", "@internal", invoke);
  const view = await render(<TeachingTools api={emptyApi()} />);
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.toolbox") }));
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
  expect(classroomCommands.has("tools.factory")).toBe(true);
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
    const view = await render(<TeachingTools api={emptyApi()} />);
    try {
      fireEvent.click(
        screen.getByRole("button", { name: t("fcboard.toolbox") }),
      );
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
        screen.queryByRole("dialog", { name: t("fcboard.toolbox") }),
      ).not.toBeInTheDocument();
    } finally {
      view.unmount();
      release();
    }
  },
);

it("shows all tools together and toggles the unified toolbox closed", async () => {
  await render(<TeachingTools api={emptyApi()} />);
  const trigger = screen.getByRole("button", { name: t("fcboard.toolbox") });
  fireEvent.click(trigger);
  expect(
    screen.getByRole("button", {
      name: t("fcboard.insert_name", { name: t("fcboard.ruler") }),
    }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: t("fcboard.ai_summary") }),
  ).toBeVisible();
  fireEvent.click(trigger);
  expect(
    screen.queryByRole("dialog", { name: t("fcboard.toolbox") }),
  ).toBeNull();
  fireEvent.click(trigger);
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  fireEvent.click(document.body);
  expect(
    screen.queryByRole("dialog", { name: t("fcboard.toolbox") }),
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
  await render(<TeachingTools api={api} />);
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.toolbox") }));
  expect(
    screen.getByRole("dialog", { name: t("fcboard.toolbox") }),
  ).toBeInTheDocument();
  act(() => {
    state.toolbarHidden = true;
    change();
  });
  expect(
    screen.queryByRole("dialog", { name: t("fcboard.toolbox") }),
  ).not.toBeInTheDocument();
  await act(async () => {
    await classroomCommands.execute({ name: "tools.open" });
  });
  expect(api.updateScene).toHaveBeenCalledWith({
    appState: { toolbarHidden: false },
  });
  expect(
    screen.getByRole("dialog", { name: t("fcboard.toolbox") }),
  ).toBeInTheDocument();
});

it("executes one AI request that inserts, configures and starts a timer before React commits the selection", async () => {
  let scene: readonly FcboardElement[] = [];
  const api = {
    getSceneElements: () => scene,
    getAppState: () => ({
      ...getDefaultAppState(),
      selectedElementIds: {},
      scrollX: 0,
      scrollY: 0,
      width: 1600,
      height: 900,
      zoom: { value: 1 },
    }),
    onChange: () => () => {},
    setActiveTool: vi.fn(),
    updateScene: (value: { elements?: readonly FcboardElement[] }) => {
      if (value.elements) {
        scene = value.elements;
      }
    },
  } as unknown as FcboardImperativeAPI;
  await render(<TeachingTools api={api} />);
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
