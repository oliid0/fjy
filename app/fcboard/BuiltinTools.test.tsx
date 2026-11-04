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
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.reset") }));
  expect(screen.getByRole("timer")).toHaveTextContent("00:00:10");
  await command("tools.timer", { action: "close" });
  expect(screen.queryByRole("dialog")).toBeNull();
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
  expect(curtain.style.backgroundImage).not.toBe(first);
  fireEvent.keyDown(
    screen.getByRole("button", { name: t("fcboard.curtain_left") }),
    { key: "ArrowRight" },
  );
  expect(curtain.style.left).toBe("20px");
  fireEvent.click(screen.getByRole("button", { name: t("buttons.close") }));
  expect(screen.queryByLabelText(t("fcboard.curtain"))).toBeNull();
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
  fireEvent.click(
    within(first).getByRole("button", { name: t("buttons.clear") }),
  );
  await command("tools.split", { open: false });
  expect(await command("tools.split", { count: 2 })).toMatchObject({
    panes: [{ strokes: 0 }, { strokes: 1 }, { strokes: 0 }, { strokes: 0 }],
  });
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
