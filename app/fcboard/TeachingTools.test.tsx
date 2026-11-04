import { t } from "@fcboard/fcboard/i18n";
import { getDefaultAppState } from "@fcboard/fcboard/appState";
import { Capacitor } from "@capacitor/core";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";

import type { FcboardElement } from "@fcboard/element/types";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { render } from "./test/render";

import { TeachingTools } from "./TeachingTools";
import { classroomCommands } from "./commands";
import { readWidgets } from "./widgets";

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

vi.mock("@fcboard/fcboard", async (original) => ({
  ...(await original<typeof import("@fcboard/fcboard")>()),
  ToolbarExtras: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

it("opens the built-in calculator without any installed OEM app and rejects unknown tools", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  render(<TeachingTools api={emptyApi()} />);
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.teaching_tools") }),
  );
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
    screen.queryByRole("dialog", { name: t("fcboard.teaching_tools") }),
  ).not.toBeInTheDocument();
  await expect(
    classroomCommands.execute({
      name: "tools.factory",
      args: { tool: "signal" },
    }),
  ).rejects.toThrow(t("fcboard.this_tool_is_not_installed_on_this_display"));
});

it("restores the actual tool button after an opening failure", async () => {
  render(<TeachingTools api={emptyApi()} />);
  const release = classroomCommands.register(
    "tools.curtain",
    "@internal",
    () => {
      throw new Error("幕布打开失败");
    },
  );
  try {
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.teaching_tools") }),
    );
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
  "swipes tool pages in %s without activating tools, wrapping, or consuming the next tap",
  async (direction) => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
    const invoke = vi.fn();
    const release = classroomCommands.register(
      "ui.invoke",
      "@internal",
      invoke,
    );
    render(<TeachingTools api={emptyApi()} />);
    try {
      fireEvent.click(
        screen.getByRole("button", { name: t("fcboard.teaching_tools") }),
      );
      const panel = screen.getByRole("dialog", {
        name: t("fcboard.teaching_tools"),
      });
      panel.style.direction = direction;
      const previous = () =>
        screen.getByRole("button", { name: t("fcboard.previous_page") });
      const next = () =>
        screen.getByRole("button", { name: t("fcboard.next_page") });
      const pointer = (
        type: string,
        x: number,
        y: number,
        id = 1,
        primary = true,
      ) =>
        fireEvent(
          panel,
          Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
            pointerId: id,
            isPrimary: primary,
            pointerType: "touch",
            button: 0,
            clientX: x,
            clientY: y,
          }),
        );
      const end = direction === "ltr" ? 120 : 280;
      pointer("pointerdown", 200, 150);
      pointer("pointermove", 205, 151);
      pointer("pointerup", 205, 151);
      expect(previous()).toHaveAttribute("aria-pressed", "true");
      pointer("pointerdown", 200, 150);
      pointer("pointermove", 205, 210);
      pointer("pointerup", 205, 210);
      expect(previous()).toHaveAttribute("aria-pressed", "true");
      pointer("pointerdown", 200, 150);
      pointer("pointermove", end, 153);
      pointer("pointercancel", end, 153);
      expect(previous()).toHaveAttribute("aria-pressed", "true");
      pointer("pointerdown", 200, 150);
      pointer("pointerdown", 190, 150, 2, false);
      pointer("pointermove", end, 153);
      pointer("pointerup", end, 153);
      expect(previous()).toHaveAttribute("aria-pressed", "true");
      pointer("pointerdown", 200, 150);
      pointer("pointermove", end, 153);
      pointer("pointerup", end, 153);
      expect(next()).toHaveAttribute("aria-pressed", "true");
      expect(
        screen.getByRole("button", { name: t("fcboard.recording") }),
      ).toBeVisible();
      pointer("pointerdown", 200, 150);
      pointer("pointermove", end, 153);
      pointer("pointerup", end, 153);
      expect(next()).toHaveAttribute("aria-pressed", "true");
      pointer("pointerdown", end, 150);
      pointer("pointermove", 200, 153);
      pointer("pointerup", 200, 153);
      expect(previous()).toHaveAttribute("aria-pressed", "true");
      expect(invoke).not.toHaveBeenCalled();
      const transfer = screen.getByRole("button", {
        name: t("fcboard.file_transfer"),
      });
      pointer("pointerdown", 200, 150);
      pointer("pointerup", 200, 150);
      fireEvent.click(transfer, { detail: 1 });
      await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
      expect(invoke).toHaveBeenCalledWith(
        expect.objectContaining({ command: "files.open", origin: "tools" }),
      );
    } finally {
      release();
    }
  },
);

it("keeps every built-in tool available without OEM packages and places curtain after timer", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  render(<TeachingTools api={emptyApi()} />);
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.teaching_tools") }),
  );
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
  expect(
    screen.getByRole("button", {
      name: t("fcboard.open_name", { name: t("fcboard.timer") }),
    }),
  ).toHaveStyle({ order: "9" });
  expect(
    screen.getByRole("button", {
      name: t("fcboard.open_name", { name: t("fcboard.curtain") }),
    }),
  ).toHaveStyle({ order: "10" });
});

it("uses one internal transfer entry even when a factory transfer application is available", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
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
