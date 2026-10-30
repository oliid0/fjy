import { act, screen, waitFor } from "@testing-library/react";
import { Fcboard } from "@fcboard/fcboard";

import { t } from "@fcboard/fcboard/i18n";

import { render as renderEditor } from "@fcboard/fcboard/tests/test-utils";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { render } from "./test/render";
import { PageNavigation } from "./PageNavigation";
import { classroomCommands } from "./commands";

const press = (key: string, target: EventTarget = window, options = {}) => {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};
afterEach(() => {
  vi.useRealTimers();
});

it("routes physical page keys through real board switching without panning the editor canvas", async () => {
  let active = "first";
  const context = classroomCommands.context("boards", () => ({
    active,
    boards: [{ id: "first" }, { id: "second" }],
  }));
  const change = vi.fn((args) => {
    active = args.id;
  });
  const stop = classroomCommands.register("board.switch", "@internal", change);
  let api!: FcboardImperativeAPI;
  const editor = await renderEditor(
    <Fcboard
      handleKeyboardGlobally
      onMount={({ excalidrawAPI }) => {
        api = excalidrawAPI;
      }}
    />,
  );
  const navigation = render(<PageNavigation />);
  try {
    const scroll = [api.getAppState().scrollX, api.getAppState().scrollY];
    expect(press("PageDown").defaultPrevented).toBe(true);
    await waitFor(() => expect(active).toBe("second"));
    await act(async () => {});
    press("PageUp");
    await waitFor(() => expect(active).toBe("first"));
    expect(change).toHaveBeenCalledTimes(2);
    expect([api.getAppState().scrollX, api.getAppState().scrollY]).toEqual(
      scroll,
    );
  } finally {
    navigation.unmount();
    editor.unmount();
    stop();
    context();
  }
});

it("keeps page keys inside inputs, candidate menus and dialogs, and leaves modified shortcuts available", async () => {
  let api!: FcboardImperativeAPI;
  const editor = await renderEditor(
    <Fcboard
      handleKeyboardGlobally
      onMount={({ excalidrawAPI }) => {
        api = excalidrawAPI;
      }}
    />,
  );
  const context = classroomCommands.context("boards", () => ({
    active: "first",
    boards: [{ id: "first" }, { id: "second" }],
  }));
  const change = vi.fn();
  const stop = classroomCommands.register("board.switch", "@internal", change);
  const navigation = render(
    <>
      <PageNavigation />
      <input aria-label="输入" />
      <div role="dialog">
        <button>对话框操作</button>
      </div>
    </>,
  );
  try {
    const scroll = [api.getAppState().scrollX, api.getAppState().scrollY];
    expect(
      press("PageDown", screen.getByRole("textbox")).defaultPrevented,
    ).toBe(false);
    expect(
      press("PageDown", screen.getByRole("button", { name: "对话框操作" }))
        .defaultPrevented,
    ).toBe(false);
    expect([api.getAppState().scrollX, api.getAppState().scrollY]).toEqual(
      scroll,
    );
    expect(press("PageDown", window, { shiftKey: true }).defaultPrevented).toBe(
      false,
    );
    expect(change).not.toHaveBeenCalled();
  } finally {
    navigation.unmount();
    editor.unmount();
    stop();
    context();
  }
});

it("uses the document's existing next / previous actions, including slide animation progression", async () => {
  const context = classroomCommands.context("document", () => ({
    id: "lesson",
    page: 1,
  }));
  const next = vi.fn();
  const previous = vi.fn();
  const board = vi.fn();
  const stops = [
    classroomCommands.register("document.next", "@internal", next),
    classroomCommands.register("document.previous", "@internal", previous),
    classroomCommands.register("board.switch", "@internal", board),
  ];
  const navigation = render(<PageNavigation />);
  try {
    press("PageDown");
    await waitFor(() => expect(next).toHaveBeenCalledTimes(1));
    await act(async () => {});
    press("PageUp");
    await waitFor(() => expect(previous).toHaveBeenCalledTimes(1));
    expect(board).not.toHaveBeenCalled();
  } finally {
    navigation.unmount();
    stops.forEach((stop) => stop());
    context();
  }
});

it("reports original first / last page boundaries and repeats the transient message without wrapping", async () => {
  const context = classroomCommands.context("boards", () => ({
    active: "only",
    boards: [{ id: "only" }],
  }));
  const change = vi.fn();
  const stop = classroomCommands.register("board.switch", "@internal", change);
  const navigation = render(<PageNavigation />);
  try {
    vi.useFakeTimers();
    press("PageUp");
    expect(screen.getByRole("status")).toHaveTextContent(
      t("fcboard.first_page_reached"),
    );
    act(() => vi.advanceTimersByTime(4500));
    expect(screen.queryByRole("status")).toBeNull();
    press("PageUp");
    expect(screen.getByRole("status")).toHaveTextContent(
      t("fcboard.first_page_reached"),
    );
    press("PageDown");
    expect(screen.getByRole("status")).toHaveTextContent(
      t("fcboard.last_page_reached"),
    );
    expect(change).not.toHaveBeenCalled();
  } finally {
    navigation.unmount();
    stop();
    context();
  }
});

it("waits for an in-flight page change and shows an actual write error instead of advancing", async () => {
  const context = classroomCommands.context("boards", () => ({
    active: "first",
    boards: [{ id: "first" }, { id: "second" }],
  }));
  let fail!: (error: Error) => void;
  const change = vi.fn(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  const stop = classroomCommands.register("board.switch", "@internal", change);
  const navigation = render(<PageNavigation />);
  try {
    press("PageDown");
    press("PageDown");
    expect(change).toHaveBeenCalledTimes(1);
    act(() => fail(new Error("Storage full")));
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage full");
    expect(classroomCommands.read("boards")).toMatchObject({ active: "first" });
  } finally {
    navigation.unmount();
    stop();
    context();
  }
});
