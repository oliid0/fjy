import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { convertToFcboardElements } from "@fcboard/fcboard";
import { t } from "@fcboard/fcboard/i18n";

import type { AppState, FcboardImperativeAPI } from "@fcboard/fcboard/types";
import type { FcboardElement } from "@fcboard/element/types";

import { BoardSwitcher } from "./BoardSwitcher";
import { classroomCommands } from "./commands";
import { render } from "./test/render";

import type { ReactNode } from "react";

import type { Board, Workspace } from "./boards";

const persistence = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("@fcboard/fcboard", async (original) => ({
  ...(await original<typeof import("@fcboard/fcboard")>()),
  ToolbarExtras: ({ children }: { children: ReactNode }) => children,
  exportToBlob: vi
    .fn()
    .mockResolvedValue(new Blob(["preview"], { type: "image/png" })),
}));
vi.mock("./boards", async (original) => {
  const actual = await original<typeof import("./boards")>();
  return {
    ...actual,
    BoardBook: class extends actual.BoardBook {
      constructor(
        api: FcboardImperativeAPI,
        failure: (error: unknown) => void,
      ) {
        super(
          api,
          failure,
          () => persistence.load(),
          (workspace) => persistence.save(workspace),
        );
      }
    },
  };
});

const page = (id: string): Board => ({
  id,
  name: id,
  elements: convertToFcboardElements([
    { type: "text", text: id, x: 10, y: 10 },
  ]),
  files: {},
  view: {
    scrollX: 0,
    scrollY: 0,
    zoom: { value: 1 as Board["view"]["zoom"]["value"] },
    viewBackgroundColor: "#fff",
  },
  updated: 1,
});
const setup = async () => {
  const workspace: Workspace = {
    active: "first",
    boards: [page("first"), page("second"), page("third")],
  };
  persistence.load.mockReset().mockResolvedValue(workspace);
  persistence.save.mockReset().mockResolvedValue(undefined);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:thumbnail");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  let elements: readonly FcboardElement[] = workspace.boards[0].elements;
  let state = {
    ...workspace.boards[0].view,
    isLoading: false,
    toolbarHidden: false,
    width: 1280,
    height: 720,
    selectedElementIds: {},
    currentItemStrokeColor: "#000",
  } as AppState;
  const listeners = new Set<
    (elements: readonly FcboardElement[], state: AppState) => void
  >();
  const api = {
    getAppState: () => state,
    getSceneElements: () => elements,
    getFiles: () => ({}),
    setActiveTool: vi.fn((tool) => {
      state = { ...state, activeTool: { ...state.activeTool, ...tool } };
    }),
    resetScene: vi.fn(() => {
      elements = [];
    }),
    addFiles: vi.fn(),
    history: { clear: vi.fn() },
    updateScene: (value: {
      elements?: readonly FcboardElement[];
      appState?: Partial<AppState>;
    }) => {
      if (value.elements) {
        elements = value.elements;
      }
      if (value.appState) {
        state = { ...state, ...value.appState };
      }
      listeners.forEach((listener) => listener(elements, state));
    },
    onChange: (
      listener: (elements: readonly FcboardElement[], state: AppState) => void,
    ) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as FcboardImperativeAPI;
  const view = render(<BoardSwitcher api={api} />);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: t("fcboard.new_board") }),
    ).toBeEnabled(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.switch_board") }),
  );
  await screen.findByRole("dialog");
  return { api, view };
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("shows original edit controls only in selection mode, defaults to all pages and forwards only chosen IDs in page order", async () => {
  const save = vi.fn();
  const stop = classroomCommands.register("board.saveFile", "@test", save);
  const { view } = await setup();
  try {
    expect(
      screen.queryByRole("button", { name: t("fcboard.save_selected") }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: t("fcboard.share_selected") }),
    ).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.board_edit") }),
    );
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    screen.getAllByRole("checkbox").forEach((box) => expect(box).toBeChecked());
    expect(
      screen.queryByRole("button", {
        name: t("fcboard.board_drag_page", { page: 1 }),
      }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: t("labels.selectAll") }),
    );
    expect(
      screen.getByRole("button", { name: t("fcboard.save_selected") }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: t("labels.delete") }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: t("fcboard.board_select_page", { page: 3 }),
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: t("fcboard.board_select_page", { page: 1 }),
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.save_selected") }),
    );
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({ ids: ["first", "third"] }),
    );
    expect(save.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  } finally {
    view.unmount();
    stop();
  }
});

it("keeps normal page switching in the open list and immediately persists independent handle sorting without resetting stroke undo", async () => {
  const { api, view } = await setup();
  try {
    fireEvent.click(
      screen.getByRole("button", {
        name: t("fcboard.switch_to_name", { name: "second" }),
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: t("fcboard.switch_to_name", { name: "second" }),
        }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
    expect(screen.getByRole("dialog")).toBeVisible();
    const resets = vi.mocked(api.resetScene).mock.calls.length;
    const history = vi.mocked(api.history.clear).mock.calls.length;
    fireEvent.keyDown(
      screen.getByRole("button", {
        name: t("fcboard.board_drag_page", { page: 2 }),
      }),
      { key: "ArrowUp" },
    );
    await waitFor(() =>
      expect(
        persistence.save.mock.lastCall?.[0].boards.map(
          (board: Board) => board.id,
        ),
      ).toEqual(["second", "first", "third"]),
    );
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "false"),
    );
    expect(
      within(screen.getByRole("list"))
        .getAllByRole("listitem")
        .map((item) => item.getAttribute("data-board-id")),
    ).toEqual(["second", "first", "third"]);
    expect(api.resetScene).toHaveBeenCalledTimes(resets);
    expect(api.history.clear).toHaveBeenCalledTimes(history);
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.switch_board") }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.switch_board") }),
    );
    expect(screen.getByRole("dialog")).toBeVisible();
  } finally {
    view.unmount();
  }
});

it("cancels pointer sorting without a write and commits a drop once while keeping full previews free of name text", async () => {
  const { api, view } = await setup();
  try {
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    vi.stubGlobal("PointerEvent", MouseEvent);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => items[2]),
    });
    const handle = screen.getByRole("button", {
      name: t("fcboard.board_drag_page", { page: 1 }),
    });
    fireEvent.pointerDown(handle, { button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(handle, { clientX: 20, clientY: 200 });
    expect(
      within(screen.getByRole("list")).getAllByRole("listitem").at(-1),
    ).toHaveAttribute("data-board-id", "first");
    fireEvent.pointerCancel(handle);
    expect(persistence.save).not.toHaveBeenCalled();
    expect(
      within(screen.getByRole("list")).getAllByRole("listitem")[0],
    ).toHaveAttribute("data-board-id", "first");
    fireEvent.pointerDown(handle, { button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(handle, { clientX: 20, clientY: 200 });
    fireEvent.pointerUp(handle);
    await waitFor(() =>
      expect(
        persistence.save.mock.lastCall?.[0].boards.map(
          (board: Board) => board.id,
        ),
      ).toEqual(["second", "third", "first"]),
    );
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "false"),
    );
    expect(api.history.clear).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("textbox")).toBeNull();
    const preview = screen.getByRole("button", {
      name: t("fcboard.switch_to_name", { name: "first" }),
    });
    expect(preview.querySelector(".fc-board-thumbnail")).toHaveStyle({
      aspectRatio: "1280 / 720",
    });
    expect(preview.textContent).toBe("03");
  } finally {
    view.unmount();
  }
});

it("deletes selected pages as a real batch, offers actual restoration and exits selection without modifying page order on cancel", async () => {
  const { view } = await setup();
  try {
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.board_edit") }),
    );
    fireEvent.click(screen.getByRole("button", { name: t("buttons.cancel") }));
    expect(persistence.save).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: t("fcboard.board_edit") }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: t("fcboard.board_select_page", { page: 1 }),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: t("labels.delete") }));
    await waitFor(() =>
      expect(
        within(screen.getByRole("list")).getAllByRole("listitem"),
      ).toHaveLength(1),
    );
    fireEvent.click(screen.getByRole("button", { name: t("buttons.undo") }));
    await waitFor(() =>
      expect(
        within(screen.getByRole("list")).getAllByRole("listitem"),
      ).toHaveLength(3),
    );
    expect(
      screen.queryByRole("button", { name: t("buttons.undo") }),
    ).toBeNull();
    expect(
      screen.getByRole("button", {
        name: t("fcboard.switch_to_name", { name: "first" }),
      }),
    ).toHaveAttribute("aria-pressed", "true");
  } finally {
    view.unmount();
  }
});

it("keeps the original list after persistence failure and cancels a pending destination switch when dismissed", async () => {
  const { api, view } = await setup();
  try {
    persistence.save.mockRejectedValueOnce(new Error("Disk full"));
    fireEvent.keyDown(
      screen.getByRole("button", {
        name: t("fcboard.board_drag_page", { page: 2 }),
      }),
      { key: "ArrowUp" },
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Disk full");
    expect(
      within(screen.getByRole("list")).getAllByRole("listitem")[0],
    ).toHaveAttribute("data-board-id", "first");
    let finish!: () => void;
    persistence.save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: t("fcboard.switch_to_name", { name: "second" }),
      }),
    );
    await waitFor(() => expect(finish).toBeDefined());
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => finish());
    expect(api.getSceneElements()[0].id).toBe(
      (await persistence.load.mock.results[0].value).boards[0].elements[0].id,
    );
    expect(api.history.clear).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  } finally {
    view.unmount();
  }
});
