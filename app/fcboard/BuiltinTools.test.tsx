import {
  act,
  fireEvent,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { Capacitor } from "@capacitor/core";
import { t } from "@fcboard/fcboard/i18n";

import { render } from "./test/render";
import { ToolTimer } from "./ToolTimer";
import { Curtain, moveCurtain } from "./Curtain";
import { SplitBoard } from "./SplitBoard";
import { Voting } from "./Voting";
import { ToolMedia } from "./ToolMedia";
import { Voting as voteBridge, Media } from "./builtinNative";
import { classroomCommands } from "./commands";
import * as boardFile from "./boardFile";

vi.mock("./builtinNative", () => ({
  Voting: { start: vi.fn(), read: vi.fn(), end: vi.fn(), clear: vi.fn() },
  Media: { open: vi.fn(), action: vi.fn() },
}));
vi.mock("../share/QRCode", () => ({
  QRCode: ({ value }: { value: string }) => (
    <span data-testid="vote-qr">{value}</span>
  ),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const command = async (name: string, args: Record<string, unknown> = {}) => {
  let result: unknown;
  await act(async () => {
    result = await classroomCommands.execute({ name, args });
  });
  return result;
};
it("counts actual elapsed time across suspension, pauses without drift and resets", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  render(<ToolTimer />);
  await command("tools.timer", {
    action: "configure",
    seconds: 10,
    muted: true,
  });
  await command("tools.timer", { action: "start" });
  vi.setSystemTime(106500);
  expect(await command("tools.timer", { action: "pause" })).toMatchObject({
    remaining: 3.5,
    running: false,
  });
  vi.setSystemTime(150000);
  expect(await command("tools.timer", { action: "read" })).toMatchObject({
    remaining: 3.5,
  });
  await command("tools.timer", { action: "start" });
  await act(async () => vi.advanceTimersByTime(4000));
  expect(screen.getByRole("timer")).toHaveTextContent("00:00:00");
  expect(await command("tools.timer", { action: "read" })).toMatchObject({
    remaining: 0,
    running: false,
  });
  await command("tools.timer", { action: "reset" });
  expect(screen.getByRole("timer")).toHaveTextContent("00:00:10");
  await command("tools.timer", { action: "close" });
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("matches the vendor timer's idle controls and restores them without pausing the countdown", async () => {
  vi.useFakeTimers();
  render(<ToolTimer />);
  await command("tools.timer", { action: "start", seconds: 60, muted: true });
  await act(async () => vi.advanceTimersByTime(5100));
  expect(
    screen.queryByRole("button", { name: t("fcboard.pause_tool") }),
  ).toBeNull();
  expect(screen.getByRole("timer")).toHaveTextContent("00:00:55");
  fireEvent.click(screen.getByRole("timer"));
  expect(
    screen.getByRole("button", { name: t("fcboard.pause_tool") }),
  ).toBeEnabled();
  expect(await command("tools.timer", { action: "read" })).toMatchObject({
    running: true,
  });
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.fullscreen") }),
  );
  await act(async () => vi.advanceTimersByTime(8000));
  expect(screen.getByRole("timer")).toHaveTextContent("00:00:47");
  expect(screen.queryByRole("button")).toBeNull();
  fireEvent.click(screen.getByRole("timer"));
  expect(
    screen.getByRole("button", { name: t("fcboard.pause_tool") }),
  ).toBeEnabled();
  expect(await command("tools.timer", { action: "read" })).toMatchObject({
    running: true,
  });
});
it("edits the original three wheels without committing until play, wraps values and disables zero time", async () => {
  render(<ToolTimer />);
  await command("tools.timer", {
    action: "configure",
    seconds: 60,
    muted: true,
  });
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.settings") }));
  expect(
    screen.queryByRole("button", { name: t("fcboard.fullscreen") }),
  ).toBeNull();
  const hours = screen.getByRole("spinbutton", { name: "HH" });
  const minutes = screen.getByRole("spinbutton", { name: "MM" });
  const seconds = screen.getByRole("spinbutton", { name: "SS" });
  fireEvent.keyDown(hours, { key: "End" });
  fireEvent.keyDown(hours, { key: "ArrowUp" });
  expect(hours).toHaveAttribute("aria-valuenow", "0");
  fireEvent.keyDown(minutes, { key: "Home" });
  fireEvent.wheel(seconds, { deltaY: -1 });
  expect(seconds).toHaveAttribute("aria-valuenow", "59");
  expect(await command("tools.timer", { action: "read" })).toMatchObject({
    duration: 60000,
    running: false,
  });
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.reset") }));
  expect(
    screen.getByRole("button", { name: t("fcboard.play_tool") }),
  ).toBeDisabled();
  fireEvent.keyDown(seconds, { key: "ArrowUp" });
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.play_tool") }));
  expect(await command("tools.timer", { action: "read" })).toMatchObject({
    duration: 1000,
    running: true,
  });
});
it("repeats the completed timer alarm every minute and cancels it when muted, reset or closed", async () => {
  vi.useFakeTimers();
  const tones: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }[] = [];
  const createOscillator = vi.fn(() => {
    const tone = {
      start: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(),
      connect: (gain: unknown) => gain,
      frequency: { value: 0 },
      onended: null,
    };
    tones.push(tone);
    return tone;
  });
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      currentTime = 0;
      destination = {};
      createOscillator = createOscillator;
      createGain = () => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
      });
      resume = () => Promise.resolve();
      close = () => Promise.resolve();
    },
  );
  render(<ToolTimer />);
  await command("tools.timer", { action: "configure", seconds: 1 });
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.play_tool") }));
  await act(async () => vi.advanceTimersByTime(1100));
  expect(createOscillator).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTime(60000));
  expect(createOscillator).toHaveBeenCalledTimes(2);
  await command("tools.timer", { action: "configure", muted: true });
  expect(tones.every((tone) => tone.stop.mock.calls.length === 2)).toBe(true);
  await act(async () => vi.advanceTimersByTime(60000));
  expect(createOscillator).toHaveBeenCalledTimes(2);
  await command("tools.timer", { action: "reset", muted: false });
  await act(async () => vi.advanceTimersByTime(60000));
  expect(createOscillator).toHaveBeenCalledTimes(2);
  await command("tools.timer", { action: "start" });
  await act(async () => vi.advanceTimersByTime(1100));
  expect(createOscillator).toHaveBeenCalledTimes(3);
  await command("tools.timer", { action: "close" });
  await act(async () => vi.advanceTimersByTime(60000));
  expect(createOscillator).toHaveBeenCalledTimes(3);
});

it("moves curtain edges independently, clamps its center and exposes real original themes", async () => {
  const rect = { left: 100, top: 50, right: 700, bottom: 550 };
  expect(moveCurtain(rect, "left", 1000, 0, 900, 700)).toEqual({
    ...rect,
    left: 400,
  });
  expect(moveCurtain(rect, "move", 1000, -1000, 900, 700)).toEqual({
    left: 300,
    top: 0,
    right: 900,
    bottom: 500,
  });
  render(<Curtain />);
  await command("tools.curtain", { theme: 0, reset: true });
  const curtain = screen.getByLabelText(t("fcboard.curtain"));
  const first = curtain.style.backgroundImage;
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.curtain_theme") }),
  );
  expect(curtain.style.backgroundImage).toBe(first);
  const chooser = screen.getByRole("dialog", {
    name: t("fcboard.curtain_theme"),
  });
  fireEvent.click(within(chooser).getByRole("button", { name: "#0101df" }));
  expect(curtain.style.backgroundImage).toBe("none");
  expect(curtain.style.backgroundColor).toBe("rgb(1, 1, 223)");
  fireEvent.click(
    within(chooser).getByRole("tab", { name: t("fcboard.background") }),
  );
  fireEvent.click(
    within(chooser).getByRole("button", {
      name: `${t("fcboard.curtain_theme")} 2`,
    }),
  );
  expect(curtain.style.backgroundImage).not.toBe(first);
  expect(curtain.style.backgroundImage).not.toBe("none");
  expect(screen.getByRole("dialog", { name: t("fcboard.curtain_theme") })).toBe(
    chooser,
  );
  fireEvent.click(
    within(chooser).getByRole("button", { name: t("buttons.close") }),
  );
  fireEvent.keyDown(
    screen.getByRole("button", { name: t("fcboard.curtain_left") }),
    { key: "ArrowRight" },
  );
  expect(curtain.style.left).toBe("20px");
  fireEvent.click(screen.getByRole("button", { name: t("buttons.close") }));
  expect(screen.queryByLabelText(t("fcboard.curtain"))).toBeNull();
});
it("opens optional split settings explicitly, applies a confirmed layout/background, and leaves ink untouched on cancel", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  render(<SplitBoard />);
  expect(await command("tools.split", { configure: true })).toMatchObject({
    open: false,
    configuring: true,
  });
  expect(document.querySelectorAll(".fc-split-pane canvas")).toHaveLength(0);
  const title = `${t("fcboard.split_screen")} · ${t("fcboard.settings")}`;
  const settings = screen.getByRole("dialog", { name: title });
  fireEvent.click(within(settings).getByRole("radio", { name: "3" }));
  fireEvent.click(
    within(settings).getByRole("radio", {
      name: t("fcboard.split_background_1"),
    }),
  );
  expect(document.querySelectorAll(".fc-split-pane canvas")).toHaveLength(0);
  fireEvent.click(
    within(settings).getByRole("button", { name: t("buttons.confirm") }),
  );
  expect(document.querySelectorAll(".fc-split-pane canvas")).toHaveLength(3);
  expect(
    (document.querySelector(".fc-split-pane canvas") as HTMLElement).style
      .background,
  ).toBe("rgb(38, 55, 49)");
  await command("tools.split", { configure: true });
  const reopened = screen.getByRole("dialog", { name: title });
  fireEvent.click(within(reopened).getByRole("radio", { name: "2" }));
  fireEvent.click(
    within(reopened).getByRole("button", { name: t("buttons.cancel") }),
  );
  expect(document.querySelectorAll(".fc-split-pane canvas")).toHaveLength(3);
  await command("tools.split", { open: false });
  await command("tools.split", { configure: true });
  const initial = screen.getByRole("dialog", { name: title });
  fireEvent.click(
    within(initial).getByRole("button", { name: t("buttons.cancel") }),
  );
  expect(document.querySelectorAll(".fc-split-pane canvas")).toHaveLength(0);
});

it("keeps independent split-pane ink through layout changes and erases only the chosen pane", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  render(<SplitBoard />);
  await command("tools.split", { count: 2 });
  const canvas = () =>
    document.querySelectorAll<HTMLCanvasElement>(".fc-split-pane canvas");
  const pointer = (node: Element, type: string, id: number, x: number) =>
    fireEvent(
      node,
      Object.assign(new Event(type, { bubbles: true }), {
        pointerId: id,
        clientX: x,
        clientY: 20,
        button: 0,
        pointerType: "pen",
      }),
    );
  for (let i = 0; i < 2; i++) {
    vi.spyOn(canvas()[i], "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 300,
      height: 500,
    } as DOMRect);
    pointer(canvas()[i], "pointerdown", i + 1, 20);
    pointer(canvas()[i], "pointermove", i + 1, 70);
    pointer(canvas()[i], "pointerup", i + 1, 70);
  }
  expect(await command("tools.split", { count: 4 })).toMatchObject({
    panes: [{ strokes: 1 }, { strokes: 1 }, { strokes: 0 }, { strokes: 0 }],
  });
  expect(canvas()).toHaveLength(4);
  const first = screen.getByLabelText(t("fcboard.split_pane", { number: 1 }));
  const context = canvas()[0].getContext("2d")!;
  fireEvent.click(
    within(first).getByRole("button", { name: t("fcboard.split_red") }),
  );
  pointer(canvas()[0], "pointerdown", 5, 30);
  pointer(canvas()[0], "pointermove", 5, 100);
  pointer(canvas()[0], "pointerup", 5, 100);
  expect(context.strokeStyle).toBe("#ff0000");
  expect(context.lineWidth).toBe(2.01 * (window.devicePixelRatio || 1));
  fireEvent(
    canvas()[0],
    Object.assign(new Event("pointerdown", { bubbles: true }), {
      pointerId: 6,
      clientX: 40,
      clientY: 20,
      button: 0,
      pointerType: "touch",
      width: 180,
      height: 180,
    }),
  );
  pointer(canvas()[0], "pointerup", 6, 40);
  expect(context.globalCompositeOperation).toBe("destination-out");
  expect(context.lineCap).toBe("square");
  expect(context.lineWidth).toBe(180 * (window.devicePixelRatio || 1));

  fireEvent.keyDown(first, { key: "Delete" });
  await command("tools.split", { open: false });
  expect(await command("tools.split", { count: 2 })).toMatchObject({
    panes: [{ strokes: 0 }, { strokes: 1 }, { strokes: 0 }, { strokes: 0 }],
  });
});
it("uses the original edge exit controls and exports all actual panes through the existing destination picker without losing drawings on cancel or failure", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(
    HTMLCanvasElement.prototype,
    "getBoundingClientRect",
  ).mockReturnValue({ width: 300, height: 500, left: 0, top: 0 } as DOMRect);
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
  const encodedSizes: { width: number; height: number }[] = [];
  const encode = vi
    .spyOn(HTMLCanvasElement.prototype, "toBlob")
    .mockImplementation(function (this: HTMLCanvasElement, callback) {
      encodedSizes.push({ width: this.width, height: this.height });
      callback(blob);
    });
  const save = vi
    .spyOn(boardFile, "savePageFiles")
    .mockResolvedValueOnce(false)
    .mockRejectedValueOnce(new Error("disk full"))
    .mockResolvedValueOnce(true);
  render(<SplitBoard />);
  await command("tools.split", { count: 2 });
  const board = screen.getByRole("dialog", { name: t("fcboard.split_screen") });
  expect(board.querySelector("header")).toBeNull();
  expect(
    within(board).getAllByRole("button", { name: t("buttons.close") }),
  ).toHaveLength(1);
  expect(
    within(board).getAllByRole("button", {
      name: t("fcboard.split_small_eraser"),
    }),
  ).toHaveLength(2);
  const panes = Array.from(board.querySelectorAll("canvas"));
  for (const [type, x] of [
    ["pointerdown", 20],
    ["pointerup", 80],
  ] as const) {
    fireEvent(
      panes[0],
      Object.assign(new Event(type, { bubbles: true }), {
        pointerId: 1,
        clientX: x,
        clientY: 20,
        button: 0,
        pointerType: "pen",
      }),
    );
  }
  fireEvent.click(
    within(board).getAllByRole("button", { name: t("buttons.close") })[0],
  );
  const prompt = screen.getByRole("dialog", {
    name: t("fcboard.split_exit_prompt"),
  });
  const button = () =>
    within(prompt).getByRole("button", { name: t("buttons.save") });
  fireEvent.click(button());
  await waitFor(() => expect(button()).toBeEnabled());
  expect(save).toHaveBeenCalledWith(
    [{ page: 1, blob }],
    t("fcboard.split_screen"),
    "jpg",
    expect.any(AbortSignal),
  );
  expect(encode).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 1);
  const canvas = encode.mock.contexts[0] as HTMLCanvasElement;
  expect(encodedSizes[0]).toEqual({
    width: 600 * (window.devicePixelRatio || 1),
    height: 500 * (window.devicePixelRatio || 1),
  });
  expect(canvas.width).toBe(1);
  expect(canvas.height).toBe(1);
  expect(canvas.getContext("2d")!.drawImage).toHaveBeenCalledWith(
    panes[0],
    0,
    0,
  );
  expect(canvas.getContext("2d")!.drawImage).toHaveBeenCalledWith(
    panes[1],
    panes[0].width,
    0,
  );
  fireEvent.click(button());
  expect(await within(prompt).findByRole("alert")).toHaveTextContent(
    "disk full",
  );
  expect(board.querySelectorAll("canvas")).toHaveLength(2);
  fireEvent.click(button());
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: t("fcboard.split_exit_prompt") }),
    ).toBeNull(),
  );
  expect(await command("tools.split", { count: 2 })).toMatchObject({
    panes: [{ strokes: 1 }, { strokes: 0 }, { strokes: 0 }, { strokes: 0 }],
  });
  fireEvent.click(
    within(board).getAllByRole("button", { name: t("buttons.close") })[0],
  );
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.exit_without_saving") }),
  );
  expect(
    screen.queryByRole("dialog", { name: t("fcboard.split_screen") }),
  ).toBeNull();
});

it("starts a real native voting session, displays its LAN QR/results, and ends with results retained", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  const session = {
    active: true as const,
    topic: "惯性与质量",
    options: ["有关", "无关"],
    multiple: false,
    accepting: true,
    participants: 2,
    counts: [1, 1],
    urls: ["http://192.168.0.7:4567/session"],
  };
  vi.mocked(voteBridge.read).mockResolvedValue({ active: false });
  vi.mocked(voteBridge.start).mockResolvedValue(session);
  vi.mocked(voteBridge.end).mockResolvedValue({ ...session, accepting: false });
  render(<Voting />);
  await command("tools.vote");
  fireEvent.change(
    screen.getByRole("textbox", { name: t("fcboard.vote_topic") }),
    { target: { value: session.topic } },
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: t("fcboard.vote_options") }),
    { target: { value: "有关\n无关" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.vote_start") }),
  );
  await waitFor(() =>
    expect(screen.getByTestId("vote-qr")).toHaveTextContent(session.urls[0]),
  );
  expect(voteBridge.start).toHaveBeenCalledWith({
    topic: session.topic,
    options: session.options,
    multiple: false,
  });
  expect(
    screen.getAllByRole("progressbar").map((bar) => bar.getAttribute("value")),
  ).toEqual(["1", "1"]);
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.vote_end") }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      t("fcboard.vote_ended"),
    ),
  );
  expect(screen.getAllByRole("progressbar")).toHaveLength(2);
  expect(voteBridge.end).toHaveBeenCalledTimes(1);
});
it("does not let a late voting poll replace a newly started session with old results", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  let finishOld!: (value: { active: false }) => void;
  vi.mocked(voteBridge.read)
    .mockReset()
    .mockResolvedValueOnce({ active: false })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
  const session = {
    active: true as const,
    topic: "新投票",
    options: ["是", "否"],
    multiple: false,
    accepting: true,
    participants: 0,
    counts: [0, 0],
    urls: ["http://192.168.0.7:4567/session"],
  };
  vi.mocked(voteBridge.start).mockResolvedValue(session);
  render(<Voting />);
  await command("tools.vote");
  await command("tools.vote", {
    action: "start",
    topic: session.topic,
    options: session.options,
  });
  expect(screen.getByRole("heading", { name: session.topic })).toBeVisible();
  await act(async () => {
    finishOld({ active: false });
  });
  expect(screen.getByRole("heading", { name: session.topic })).toBeVisible();
  expect(screen.getByTestId("vote-qr")).toHaveTextContent(session.urls[0]);
});

it("routes media to the internal Android picker and real player controls", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  vi.mocked(Media.open).mockResolvedValue({ open: true });
  vi.mocked(Media.action).mockResolvedValue({
    open: true,
    playing: false,
    position: 12,
  });
  render(<ToolMedia />);
  expect(await command("tools.media")).toEqual({ open: true });
  expect(Media.open).toHaveBeenCalledWith({
    labels: { title: t("fcboard.media"), close: t("buttons.close") },
  });
  expect(
    await command("media.control", { action: "seek", seconds: 12 }),
  ).toMatchObject({ position: 12 });
  expect(Media.action).toHaveBeenCalledWith({ action: "seek", seconds: 12 });
});
