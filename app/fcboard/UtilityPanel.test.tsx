import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { Capacitor } from "@capacitor/core";

import { UtilityPanel } from "./UtilityPanel";
import { render } from "./test/render";
import { classroomCommands } from "./commands";

const native = vi.hoisted(() => ({
  startPoll: vi.fn(),
  pollStatus: vi.fn(),
  stopPoll: vi.fn().mockResolvedValue({}),
  splitScreen: vi.fn(),
  openBundledCalculator: vi.fn(),
  bundledCalculatorAction: vi.fn(),
  addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
  registerPlugin: () => native,
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
});

it("opens the embedded original calculator and routes discovered buttons through the native handler without opening a replacement panel", async () => {
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
  const state = {
    open: true,
    supported: true,
    embedded: true,
    version: "original:1",
    expression: "0",
    result: "0",
    controls: [{ id: "btn_num1", label: "1", enabled: true }],
  };
  native.openBundledCalculator.mockResolvedValue(state);
  native.bundledCalculatorAction.mockResolvedValue({
    ...state,
    version: "original:2",
    expression: "1",
  });
  const view = render(<UtilityPanel />);
  try {
    await act(async () => {
      expect(
        await classroomCommands.execute({ name: "tools.calculator" }),
      ).toEqual(state);
    });
    expect(
      screen.queryByRole("textbox", { name: "计算器算式" }),
    ).not.toBeInTheDocument();
    expect(classroomCommands.read("calculator")).toEqual(state);
    await act(async () => {
      await classroomCommands.execute({
        name: "calculator.press",
        args: { version: state.version, controls: ["btn_num1"] },
      });
    });
    expect(native.bundledCalculatorAction).toHaveBeenCalledWith({
      action: "press",
      version: state.version,
      controls: ["btn_num1"],
    });
    expect(classroomCommands.read("calculator")).toMatchObject({
      expression: "1",
      version: "original:2",
    });
  } finally {
    view.unmount();
  }
});

it("calculates locally through the real calculator without model settings", async () => {
  const view = render(<UtilityPanel />);
  try {
    await act(async () => {
      await classroomCommands.execute({ name: "tools.calculator" });
    });
    fireEvent.change(screen.getByRole("textbox", { name: "计算器算式" }), {
      target: { value: "0.1+0.2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "计算" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("0.3"),
    );
  } finally {
    view.unmount();
  }
});

it("starts a LAN poll and freezes its real reported counts when ended", async () => {
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
  const poll = {
    question: "是否理解？",
    options: ["赞成", "反对"],
    counts: [2, 1],
    total: 3,
    closed: false,
  };
  native.startPoll.mockResolvedValue({
    urls: ["http://192.168.1.2:1234/poll/"],
  });
  native.pollStatus.mockImplementation(async (args) => ({
    ...poll,
    closed: !!args?.close,
  }));
  const view = render(<UtilityPanel />);
  try {
    await act(async () => {
      await classroomCommands.execute({ name: "tools.vote" });
    });
    fireEvent.change(screen.getByRole("textbox", { name: "投票问题" }), {
      target: { value: poll.question },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始投票" }));
    await waitFor(() => expect(screen.getByText(/已投 3 人/)).toBeVisible());
    expect(native.startPoll).toHaveBeenCalledWith({
      question: poll.question,
      options: poll.options,
    });
    expect(
      screen
        .getAllByRole("progressbar")
        .map((item) => item.getAttribute("value")),
    ).toEqual(["2", "1"]);
    fireEvent.click(screen.getByRole("button", { name: "结束投票" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "结束投票" })).toBeDisabled(),
    );
    expect(native.pollStatus).toHaveBeenCalledWith({ close: true });
  } finally {
    view.unmount();
  }
});
